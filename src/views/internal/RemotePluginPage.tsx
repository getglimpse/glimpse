import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import {
  AlertCircle,
  CloudDownload,
  Download,
  ExternalLink,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { openerApi } from "@/api/opener";
import {
  getRemotePluginInstallErrorMessage,
  isRegistryEntryApiSupported,
  OFFICIAL_PLUGIN_REGISTRY_URL,
  validatePluginRegistry,
} from "@/features/plugins/remotePluginRegistry";
import {
  getPluginDiscoveryErrors,
  getPlugins,
  installPluginFromUrl,
  loadPlugins,
  setPluginEnabled,
  setPluginTrusted,
  subscribeToPluginChanges,
  uninstallPlugin,
} from "@/features/plugins/pluginRegistry";
import { useI18nContext } from "@/i18n/I18nProvider";
import type { TranslationFunctions } from "@/i18n/i18n-types";
import type { PluginRegistryEntry, PluginRegistryItem } from "@/types";

const remotePluginMatchesSearch = (
  plugin: PluginRegistryEntry,
  normalizedQuery: string,
) =>
  [
    plugin.name,
    plugin.id,
    plugin.version,
    `v${plugin.version}`,
    plugin.description ?? "",
    plugin.author ?? "",
    plugin.category ?? "",
    plugin.releaseDate ?? "",
    plugin.readmeUrl ?? "",
    plugin.sourceUrl ?? "",
    plugin.repositoryUrl ?? "",
    plugin.homepageUrl ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);

const REMOTE_PLUGIN_README_MAX_LENGTH = 100_000;

type RemotePluginInstallState = "downloading" | "installing" | "failed";
type RemotePluginInstallKind =
  | "not-installed"
  | "installed"
  | "update-available"
  | "unsupported";
type RemotePluginManagementState = "enabling" | "disabling" | "uninstalling";

const compareVersionTriplets = (left: string, right: string): number => {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));

  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
};

const getRemotePluginInstallKind = (
  entry: PluginRegistryEntry,
  installedPlugin: PluginRegistryItem | undefined,
): RemotePluginInstallKind => {
  if (!isRegistryEntryApiSupported(entry)) {
    return "unsupported";
  }

  if (!installedPlugin) {
    return "not-installed";
  }

  if (compareVersionTriplets(entry.version, installedPlugin.version) > 0) {
    return "update-available";
  }

  return "installed";
};

const sha256DigestPattern = /^[a-f0-9]{64}$/i;

const isRemoteManagedInstalledPlugin = (
  entry: PluginRegistryEntry,
  installedPlugin: PluginRegistryItem,
) => {
  const provenance = installedPlugin.trustStatus?.provenance;

  if (
    !provenance ||
    provenance.installSource !== "remote" ||
    provenance.registryUrl !== OFFICIAL_PLUGIN_REGISTRY_URL
  ) {
    return false;
  }

  const registrySha256 = provenance.registrySha256?.toLowerCase();
  const installedPackageSha256 =
    provenance.installedPackageSha256?.toLowerCase();

  if (
    !registrySha256 ||
    !installedPackageSha256 ||
    !sha256DigestPattern.test(registrySha256) ||
    registrySha256 !== installedPackageSha256 ||
    !isOfficialPluginDownloadUrlForVersion(
      provenance.downloadUrl,
      entry.id,
      installedPlugin.version,
    )
  ) {
    return false;
  }

  if (installedPlugin.version !== entry.version) {
    return true;
  }

  return (
    provenance.downloadUrl === entry.downloadUrl &&
    registrySha256 === entry.sha256.toLowerCase()
  );
};

const isOfficialPluginDownloadUrlForVersion = (
  downloadUrl: string | null | undefined,
  pluginId: string,
  version: string,
) => {
  if (!downloadUrl) {
    return false;
  }

  try {
    const url = new URL(downloadUrl);

    if (!isGitHubUrl(url)) {
      return false;
    }

    const [owner, repo, releases, download, tag, fileName] = url.pathname
      .split("/")
      .filter(Boolean);

    return (
      owner === "getglimpse" &&
      repo === "plugins" &&
      releases === "releases" &&
      download === "download" &&
      tag === `${pluginId}-v${version}` &&
      fileName === `${pluginId}-${version}.glimpse-plugin.zip`
    );
  } catch {
    return false;
  }
};

export const RemotePluginPage = () => {
  const { LL, locale } = useI18nContext();
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [plugins, setPlugins] = useState<PluginRegistryItem[]>(() =>
    getPlugins(),
  );
  const [discoveryErrors, setDiscoveryErrors] = useState(() =>
    getPluginDiscoveryErrors(),
  );
  const [pluginSearchQuery, setPluginSearchQuery] = useState("");
  const [selectedRemotePluginId, setSelectedRemotePluginId] = useState<
    string | null
  >(null);
  const [remoteLayoutWide, setRemoteLayoutWide] = useState(false);
  const [remoteDetailDialogOpen, setRemoteDetailDialogOpen] = useState(false);
  const [remotePlugins, setRemotePlugins] = useState<PluginRegistryEntry[]>([]);
  const [remoteRegistryLoading, setRemoteRegistryLoading] = useState(false);
  const [remoteRegistryError, setRemoteRegistryError] = useState<string | null>(
    null,
  );
  const [remoteInstallStates, setRemoteInstallStates] = useState<
    Partial<Record<string, RemotePluginInstallState>>
  >({});
  const [remoteInstallErrors, setRemoteInstallErrors] = useState<
    Partial<Record<string, string>>
  >({});
  const [remoteManagementStates, setRemoteManagementStates] = useState<
    Partial<Record<string, RemotePluginManagementState>>
  >({});
  const [remoteManagementMessage, setRemoteManagementMessage] = useState<
    string | null
  >(null);

  const loadRemoteRegistry = useCallback(async () => {
    setRemoteRegistryLoading(true);
    setRemoteRegistryError(null);

    try {
      const response = await fetch(OFFICIAL_PLUGIN_REGISTRY_URL, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = validatePluginRegistry(await response.json());

      if (!result.ok) {
        throw new Error(result.errors.join("\n"));
      }

      setRemotePlugins(result.registry.plugins);
    } catch (error) {
      setRemotePlugins([]);
      setRemoteRegistryError(String(error));
    } finally {
      setRemoteRegistryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlugins()
      .then(() => {
        setPlugins(getPlugins());
        setDiscoveryErrors(getPluginDiscoveryErrors());
      })
      .catch((error) => {
        console.warn("Failed to load installed plugins for store:", error);
      });

    return subscribeToPluginChanges(() => {
      setPlugins(getPlugins());
      setDiscoveryErrors(getPluginDiscoveryErrors());
    });
  }, []);

  useEffect(() => {
    void loadRemoteRegistry();
  }, [loadRemoteRegistry]);

  useEffect(() => {
    const element = contentRef.current;

    if (!element) {
      return;
    }

    const updateLayout = () => {
      setRemoteLayoutWide(element.clientWidth >= 760);
    };

    updateLayout();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateLayout);

      return () => {
        window.removeEventListener("resize", updateLayout);
      };
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      setRemoteLayoutWide(
        (entry?.contentRect.width ?? element.clientWidth) >= 760,
      );
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (remoteLayoutWide) {
      setRemoteDetailDialogOpen(false);
    }
  }, [remoteLayoutWide]);

  const handleRemoteInstall = (entry: PluginRegistryEntry) => {
    const installedPlugin = plugins.find((plugin) => plugin.id === entry.id);
    const installKind = getRemotePluginInstallKind(entry, installedPlugin);

    if (installKind === "installed" || installKind === "unsupported") {
      return;
    }

    setRemoteInstallStates((states) => ({
      ...states,
      [entry.id]: "downloading",
    }));
    setRemoteInstallErrors((errors) => {
      const nextErrors = { ...errors };

      delete nextErrors[entry.id];

      return nextErrors;
    });
    setRemoteManagementMessage(null);

    const installPhaseTimer = window.setTimeout(() => {
      setRemoteInstallStates((states) =>
        states[entry.id] === "downloading"
          ? { ...states, [entry.id]: "installing" }
          : states,
      );
    }, 400);

    void installPluginFromUrl(
      entry.downloadUrl,
      entry.sha256,
      installKind === "update-available",
      OFFICIAL_PLUGIN_REGISTRY_URL,
    )
      .then((result) => {
        setPlugins(getPlugins());
        setDiscoveryErrors(getPluginDiscoveryErrors());
        setRemoteManagementMessage(
          LL.pluginPage.remote.installSuccess({
            pluginId: result.pluginId,
          }),
        );
      })
      .catch((error) => {
        const message = getRemotePluginInstallErrorMessage(error);

        setRemoteInstallErrors((errors) => ({
          ...errors,
          [entry.id]: message,
        }));
        setRemoteManagementMessage(
          LL.pluginPage.remote.installFailed({ error: message }),
        );
      })
      .finally(() => {
        window.clearTimeout(installPhaseTimer);
        setRemoteInstallStates((states) => {
          const nextStates = { ...states };

          delete nextStates[entry.id];

          return nextStates;
        });
      });
  };

  const handleRemotePluginEnabledChange = (
    plugin: PluginRegistryItem,
    enabled: boolean,
  ) => {
    const nextState: RemotePluginManagementState = enabled
      ? "enabling"
      : "disabling";

    setRemoteManagementStates((states) => ({
      ...states,
      [plugin.id]: nextState,
    }));
    setRemoteManagementMessage(null);

    const updatePluginState = async () => {
      if (enabled && !plugin.trusted) {
        await setPluginTrusted(plugin.id, true);
      }

      setPluginEnabled(plugin.id, enabled);
    };

    void updatePluginState()
      .then(() => {
        setPlugins(getPlugins());
        setDiscoveryErrors(getPluginDiscoveryErrors());
      })
      .catch((error) => {
        setRemoteManagementMessage(
          enabled
            ? LL.pluginPage.remote.enableFailed({ error: String(error) })
            : LL.pluginPage.remote.disableFailed({ error: String(error) }),
        );
      })
      .finally(() => {
        setRemoteManagementStates((states) => {
          const nextStates = { ...states };

          delete nextStates[plugin.id];

          return nextStates;
        });
      });
  };

  const handleRemotePluginUninstall = (plugin: PluginRegistryItem) => {
    const confirmed = window.confirm(
      LL.pluginPage.pluginRow.uninstallConfirm({
        name: plugin.name,
      }),
    );

    if (!confirmed) {
      return;
    }

    setRemoteManagementStates((states) => ({
      ...states,
      [plugin.id]: "uninstalling",
    }));
    setRemoteManagementMessage(null);

    void uninstallPlugin(plugin.id)
      .then(() => {
        setPlugins(getPlugins());
        setDiscoveryErrors(getPluginDiscoveryErrors());
        setRemoteManagementMessage(
          LL.pluginPage.pluginRow.uninstallSuccess({
            pluginId: plugin.id,
          }),
        );
      })
      .catch((error) => {
        setRemoteManagementMessage(
          LL.pluginPage.remote.uninstallFailed({ error: String(error) }),
        );
      })
      .finally(() => {
        setRemoteManagementStates((states) => {
          const nextStates = { ...states };

          delete nextStates[plugin.id];

          return nextStates;
        });
      });
  };

  const normalizedPluginSearchQuery = pluginSearchQuery.trim().toLowerCase();
  const installedPluginsById = new Map(
    plugins.map((plugin) => [plugin.id, plugin]),
  );
  const remotePluginViews = remotePlugins.map((entry) => {
    const installedPlugin = installedPluginsById.get(entry.id);
    const remoteManagedInstalledPlugin =
      installedPlugin && isRemoteManagedInstalledPlugin(entry, installedPlugin)
        ? installedPlugin
        : undefined;

    return {
      entry,
      installedPlugin: remoteManagedInstalledPlugin,
      conflictingInstalledPlugin:
        installedPlugin && !remoteManagedInstalledPlugin
          ? installedPlugin
          : undefined,
      installKind: getRemotePluginInstallKind(entry, installedPlugin),
    };
  });
  const filteredRemotePluginViews =
    normalizedPluginSearchQuery.length > 0
      ? remotePluginViews.filter(({ entry }) =>
          remotePluginMatchesSearch(entry, normalizedPluginSearchQuery),
        )
      : remotePluginViews;
  const selectedRemotePluginView =
    filteredRemotePluginViews.find(
      ({ entry }) => entry.id === selectedRemotePluginId,
    ) ??
    filteredRemotePluginViews[0] ??
    null;
  const selectRemotePlugin = (entryId: string) => {
    setSelectedRemotePluginId(entryId);

    if (!remoteLayoutWide) {
      setRemoteDetailDialogOpen(true);
    }
  };

  return (
    <div
      ref={panelRef}
      className={`relative h-full w-full px-4 py-3 text-sm text-text-main sm:px-6 ${
        remoteLayoutWide
          ? "flex min-h-0 flex-col overflow-hidden"
          : "overflow-y-auto"
      }`}
    >
      <div
        ref={contentRef}
        className={`@container mx-auto max-w-5xl ${
          remoteLayoutWide ? "flex min-h-0 w-full flex-1 flex-col" : ""
        }`}
      >
        <Section
          className={
            remoteLayoutWide ? "mb-0 flex min-h-0 flex-1 flex-col" : undefined
          }
          contentClassName={
            remoteLayoutWide ? "flex min-h-0 flex-1 flex-col" : undefined
          }
        >
          <div
            className={
              remoteLayoutWide
                ? "flex min-h-0 flex-1 flex-col space-y-3 py-0"
                : "space-y-3 py-0"
            }
          >
            {remoteManagementMessage && (
              <div className="rounded-md border border-border-main bg-main-bg p-3 text-xs text-text-muted">
                {remoteManagementMessage}
              </div>
            )}

            {discoveryErrors.length > 0 && (
              <div className="space-y-2 rounded-md border border-red-500/40 bg-main-bg p-3 text-xs text-red-400">
                {discoveryErrors.map((error) => (
                  <div key={`${error.path}:${error.error}`}>
                    <div className="font-mono text-text-muted">
                      {error.path}
                    </div>
                    <div>{error.error}</div>
                  </div>
                ))}
              </div>
            )}

            <div
              className={`grid gap-3 ${
                selectedRemotePluginView
                  ? "@min-[760px]:grid-cols-[minmax(200px,320px)_minmax(0,1fr)] @min-[1024px]:grid-cols-[minmax(220px,360px)_minmax(0,1fr)]"
                  : ""
              } ${remoteLayoutWide ? "min-h-0 flex-1" : ""}`}
            >
              <div className="space-y-3 @min-[760px]:flex @min-[760px]:min-h-0 @min-[760px]:flex-col">
                <PluginSearchControls
                  placeholder={LL.pluginPage.searchPlaceholder()}
                  value={pluginSearchQuery}
                  onChange={setPluginSearchQuery}
                  actions={
                    <RemotePluginSearchActions
                      LL={LL}
                      loading={remoteRegistryLoading}
                      onRefresh={() => {
                        void loadRemoteRegistry();
                      }}
                    />
                  }
                />

                {remoteRegistryError && (
                  <div className="rounded-md border border-red-500/40 bg-main-bg p-3 text-red-400">
                    {LL.pluginPage.remote.loadError({
                      error: remoteRegistryError,
                    })}
                  </div>
                )}

                {!remoteRegistryLoading &&
                  !remoteRegistryError &&
                  remotePlugins.length === 0 && (
                    <div className="rounded-md border border-border-main bg-main-bg p-3 text-text-muted">
                      {LL.pluginPage.remote.empty()}
                    </div>
                  )}

                {!remoteRegistryLoading &&
                  !remoteRegistryError &&
                  remotePlugins.length > 0 &&
                  filteredRemotePluginViews.length === 0 && (
                    <div className="rounded-md border border-border-main bg-main-bg p-3 text-text-muted">
                      {LL.pluginPage.remote.noSearchResults()}
                    </div>
                  )}

                {filteredRemotePluginViews.length > 0 &&
                  selectedRemotePluginView && (
                    <div className="overflow-hidden rounded-md border border-border-main bg-main-bg @min-[760px]:min-h-0 @min-[760px]:flex-1 @min-[760px]:overflow-y-auto">
                      {filteredRemotePluginViews.map(
                        ({ entry, installKind }) => (
                          <RemotePluginCatalogRow
                            key={entry.id}
                            entry={entry}
                            installKind={installKind}
                            installState={remoteInstallStates[entry.id]}
                            error={remoteInstallErrors[entry.id]}
                            LL={LL}
                            selected={
                              entry.id === selectedRemotePluginView.entry.id
                            }
                            onSelect={() => {
                              selectRemotePlugin(entry.id);
                            }}
                          />
                        ),
                      )}
                    </div>
                  )}
              </div>

              {filteredRemotePluginViews.length > 0 &&
                selectedRemotePluginView &&
                remoteLayoutWide && (
                  <RemotePluginDetail
                    entry={selectedRemotePluginView.entry}
                    installedPlugin={selectedRemotePluginView.installedPlugin}
                    conflictingInstalledPlugin={
                      selectedRemotePluginView.conflictingInstalledPlugin
                    }
                    installKind={selectedRemotePluginView.installKind}
                    installState={
                      remoteInstallStates[selectedRemotePluginView.entry.id]
                    }
                    managementState={
                      remoteManagementStates[selectedRemotePluginView.entry.id]
                    }
                    error={
                      remoteInstallErrors[selectedRemotePluginView.entry.id]
                    }
                    LL={LL}
                    locale={locale}
                    onInstall={() => {
                      handleRemoteInstall(selectedRemotePluginView.entry);
                    }}
                    onEnabledChange={handleRemotePluginEnabledChange}
                    onUninstall={handleRemotePluginUninstall}
                    surface="inline"
                  />
                )}
            </div>
          </div>
        </Section>
      </div>

      {!remoteLayoutWide &&
        remoteDetailDialogOpen &&
        selectedRemotePluginView && (
          <RemotePluginDetailOverlay
            entry={selectedRemotePluginView.entry}
            installedPlugin={selectedRemotePluginView.installedPlugin}
            conflictingInstalledPlugin={
              selectedRemotePluginView.conflictingInstalledPlugin
            }
            installKind={selectedRemotePluginView.installKind}
            installState={
              remoteInstallStates[selectedRemotePluginView.entry.id]
            }
            managementState={
              remoteManagementStates[selectedRemotePluginView.entry.id]
            }
            error={remoteInstallErrors[selectedRemotePluginView.entry.id]}
            LL={LL}
            locale={locale}
            onInstall={() => {
              handleRemoteInstall(selectedRemotePluginView.entry);
            }}
            onEnabledChange={handleRemotePluginEnabledChange}
            onUninstall={handleRemotePluginUninstall}
            onClose={() => {
              setRemoteDetailDialogOpen(false);
            }}
            panelRef={panelRef}
          />
        )}
    </div>
  );
};

const PluginSearchControls = ({
  actions,
  onChange,
  placeholder,
  value,
}: {
  actions?: ReactNode;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) => (
  <div
    className={
      actions ? "grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" : undefined
    }
  >
    <div className="relative">
      <Search
        size={15}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        aria-label={placeholder}
        placeholder={placeholder}
        className="h-9 w-full rounded border border-border-main bg-transparent pl-8 pr-3 text-sm text-text-main outline-none placeholder:text-text-muted focus:border-accent"
      />
    </div>
    {actions}
  </div>
);

const RemotePluginSearchActions = ({
  LL,
  loading,
  onRefresh,
}: {
  LL: TranslationFunctions;
  loading: boolean;
  onRefresh: () => void;
}) => (
  <button
    type="button"
    onClick={onRefresh}
    disabled={loading}
    aria-label={LL.pluginPage.remote.refresh()}
    title={LL.pluginPage.remote.refresh()}
    className="inline-flex size-9 items-center justify-center rounded border border-border-main text-text-muted hover:text-text-main disabled:opacity-50"
  >
    <RefreshCw
      size={16}
      aria-hidden="true"
      className={loading ? "animate-spin" : undefined}
    />
  </button>
);

const RemotePluginCatalogRow = ({
  entry,
  installKind,
  installState,
  error,
  LL,
  selected,
  onSelect,
}: {
  entry: PluginRegistryEntry;
  installKind: RemotePluginInstallKind;
  installState?: RemotePluginInstallState;
  error?: string;
  LL: TranslationFunctions;
  selected: boolean;
  onSelect: () => void;
}) => {
  const statusLabel = getRemotePluginStatusLabel(
    LL,
    installKind,
    installState,
    Boolean(error),
  );

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={LL.pluginPage.remote.openDetails({ name: entry.name })}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        onSelect();
      }}
      className={`border-b border-border-main/60 px-3 py-3 outline-none last:border-b-0 hover:bg-item-hover focus:bg-item-hover ${
        selected ? "bg-item-hover" : ""
      }`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 font-medium text-text-main">
            {entry.name}
          </span>
          <span className="text-xs text-text-muted">v{entry.version}</span>
          <RemotePluginStatusBadge
            failed={Boolean(error)}
            installKind={installKind}
            label={statusLabel}
          />
        </div>

        {entry.description && (
          <p className="line-clamp-1 text-sm text-text-muted">
            {entry.description}
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-300">
            <AlertCircle size={14} aria-hidden="true" className="mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </article>
  );
};

const RemotePluginDetailOverlay = ({
  entry,
  installedPlugin,
  conflictingInstalledPlugin,
  installKind,
  installState,
  managementState,
  error,
  LL,
  locale,
  onInstall,
  onEnabledChange,
  onUninstall,
  onClose,
  panelRef,
}: {
  entry: PluginRegistryEntry;
  installedPlugin?: PluginRegistryItem;
  conflictingInstalledPlugin?: PluginRegistryItem;
  installKind: RemotePluginInstallKind;
  installState?: RemotePluginInstallState;
  managementState?: RemotePluginManagementState;
  error?: string;
  LL: TranslationFunctions;
  locale: string;
  onInstall: () => void;
  onEnabledChange: (plugin: PluginRegistryItem, enabled: boolean) => void;
  onUninstall: (plugin: PluginRegistryItem) => void;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const dialogFocusedRef = useRef(false);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const [panelBounds, setPanelBounds] = useState<{
    height: number;
    left: number;
    top: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    return () => {
      previousActiveElementRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (panelBounds && !dialogFocusedRef.current) {
      dialogRef.current?.focus();
      dialogFocusedRef.current = true;
    }
  }, [panelBounds]);

  useEffect(() => {
    const panel = panelRef.current;

    if (!panel) {
      return;
    }

    const updatePanelBounds = () => {
      const rect = panel.getBoundingClientRect();

      setPanelBounds({
        height: rect.height,
        left: rect.left,
        top: rect.top,
        width: rect.width,
      });
    };

    updatePanelBounds();
    window.addEventListener("resize", updatePanelBounds);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.removeEventListener("resize", updatePanelBounds);
      };
    }

    const observer = new ResizeObserver(updatePanelBounds);

    observer.observe(panel);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePanelBounds);
    };
  }, [panelRef]);

  if (!panelBounds) {
    return null;
  }

  return (
    <div
      data-testid="remote-plugin-detail-overlay"
      className="fixed z-40 overflow-y-auto bg-black/10 p-6 supports-backdrop-filter:backdrop-blur-xs"
      onMouseDown={onClose}
      style={{
        height: panelBounds.height,
        left: panelBounds.left,
        top: panelBounds.top,
        width: panelBounds.width,
      }}
    >
      <div className="flex min-h-full items-center justify-center">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onClose();
            }
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          className="relative grid max-h-full w-full max-w-xl gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none"
        >
          <div className="sr-only">
            <h2 id={titleId}>{entry.name}</h2>
            <p id={descriptionId}>
              {LL.pluginPage.remote.openDetails({ name: entry.name })}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-[min(var(--radius-md),12px)] text-text-muted hover:bg-muted hover:text-foreground"
          >
            <X size={16} aria-hidden="true" />
          </button>

          <RemotePluginDetail
            entry={entry}
            installedPlugin={installedPlugin}
            conflictingInstalledPlugin={conflictingInstalledPlugin}
            installKind={installKind}
            installState={installState}
            managementState={managementState}
            error={error}
            LL={LL}
            locale={locale}
            onInstall={onInstall}
            onEnabledChange={onEnabledChange}
            onUninstall={onUninstall}
            surface="dialog"
          />
        </div>
      </div>
    </div>
  );
};

const RemotePluginDetail = ({
  entry,
  installedPlugin,
  conflictingInstalledPlugin,
  installKind,
  installState,
  managementState,
  error,
  LL,
  locale,
  onInstall,
  onEnabledChange,
  onUninstall,
  surface,
}: {
  entry: PluginRegistryEntry;
  installedPlugin?: PluginRegistryItem;
  conflictingInstalledPlugin?: PluginRegistryItem;
  installKind: RemotePluginInstallKind;
  installState?: RemotePluginInstallState;
  managementState?: RemotePluginManagementState;
  error?: string;
  LL: TranslationFunctions;
  locale: string;
  onInstall: () => void;
  onEnabledChange: (plugin: PluginRegistryItem, enabled: boolean) => void;
  onUninstall: (plugin: PluginRegistryItem) => void;
  surface: "inline" | "dialog";
}) => {
  const installDisabled = isRemotePluginActionDisabled(
    installKind,
    installState,
  );
  const managing = Boolean(managementState || installState);
  const installedPluginEnabled = Boolean(installedPlugin?.enabled);
  const statusLabel = getRemotePluginStatusLabel(
    LL,
    installKind,
    installState,
    Boolean(error),
  );
  const actionLabel = getRemotePluginActionLabel(LL, installKind, installState);
  const readmeUrl = getRemotePluginReadmeUrl(entry);
  const [readmeState, setReadmeState] = useState<{
    content: string;
    error: string | null;
    loading: boolean;
  }>({
    content: "",
    error: null,
    loading: false,
  });

  useEffect(() => {
    if (!readmeUrl) {
      setReadmeState({ content: "", error: null, loading: false });
      return;
    }

    let cancelled = false;

    setReadmeState({ content: "", error: null, loading: true });

    void fetch(readmeUrl, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const content = await response.text();

        if (content.length > REMOTE_PLUGIN_README_MAX_LENGTH) {
          throw new Error("readme too large");
        }

        if (!cancelled) {
          setReadmeState({ content, error: null, loading: false });
        }
      })
      .catch((readmeError) => {
        if (!cancelled) {
          setReadmeState({
            content: "",
            error:
              readmeError instanceof Error &&
              readmeError.message === "readme too large"
                ? LL.pluginPage.remote.readmeTooLarge()
                : LL.pluginPage.remote.readmeLoadError(),
            loading: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [LL, readmeUrl]);

  const repositoryUrl = entry.repositoryUrl;
  const hasReadmeContent = readmeState.content.trim().length > 0;
  const downloadCountLabel =
    typeof entry.downloadCount === "number"
      ? formatRemoteDownloadCount(entry.downloadCount, locale)
      : "-";

  return (
    <aside
      className={
        surface === "inline"
          ? "min-w-0 rounded-md border border-border-main bg-main-bg p-4 @min-[760px]:h-full @min-[760px]:min-h-0 @min-[760px]:overflow-y-auto"
          : "min-w-0"
      }
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <h3 className="text-base font-semibold text-text-main">
            {entry.name}
          </h3>
          <RemotePluginStatusBadge
            failed={Boolean(error)}
            installKind={installKind}
            label={statusLabel}
          />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          {entry.author && <span>{entry.author}</span>}
          {entry.author && <span aria-hidden="true">|</span>}
          <span
            aria-label={`${LL.pluginPage.remote.downloads()}: ${downloadCountLabel}`}
            className="inline-flex items-center gap-1"
          >
            <CloudDownload size={13} aria-hidden="true" />
            <span>{downloadCountLabel}</span>
          </span>
        </div>
      </div>

      <div className="mt-3 space-y-1.5 border-y border-border-main/70 py-3 text-xs">
        <RemotePluginMetadataLine
          label={LL.pluginPage.remote.version()}
          value={entry.version}
        />

        {repositoryUrl && (
          <RemotePluginMetadataLine
            label={LL.pluginPage.remote.repository()}
            value={
              <button
                type="button"
                onClick={() => {
                  openRemotePluginLink(repositoryUrl);
                }}
                className="inline-flex min-w-0 items-center gap-1 text-left text-text-main hover:text-accent"
              >
                <ExternalLink size={13} aria-hidden="true" />
                <span className="break-all">{repositoryUrl}</span>
              </button>
            }
          />
        )}

        {entry.releaseDate && (
          <RemotePluginMetadataLine
            label={LL.pluginPage.remote.lastUpdated()}
            value={formatRemoteRelativeDate(entry.releaseDate, locale)}
          />
        )}

        {entry.category && (
          <RemotePluginMetadataLine
            label={LL.pluginPage.remote.category()}
            value={
              <span className="rounded border border-border-main px-1.5 py-0.5 text-[11px] text-text-main">
                {entry.category}
              </span>
            }
          />
        )}
      </div>

      {entry.description && (
        <p className="mt-4 whitespace-pre-line text-sm leading-6 text-text-main">
          {entry.description}
        </p>
      )}

      {conflictingInstalledPlugin && (
        <div className="mt-4 rounded-md border border-border-main bg-main-bg p-3 text-xs text-text-muted">
          {LL.pluginPage.remote.localConflict({
            pluginId: conflictingInstalledPlugin.id,
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {(installKind === "not-installed" ||
          installKind === "update-available" ||
          (!installedPlugin && installKind === "unsupported")) && (
          <button
            type="button"
            onClick={onInstall}
            disabled={installDisabled}
            className="inline-flex min-h-9 min-w-28 items-center justify-center gap-2 rounded border border-border-main px-3 py-1.5 text-xs text-text-main hover:border-accent disabled:text-text-muted disabled:opacity-70"
          >
            <Download size={14} aria-hidden="true" />
            {actionLabel}
          </button>
        )}

        {installedPlugin && (
          <>
            <button
              type="button"
              onClick={() => {
                onEnabledChange(installedPlugin, !installedPluginEnabled);
              }}
              disabled={managing}
              className="inline-flex min-h-9 min-w-28 items-center justify-center rounded border border-border-main px-3 py-1.5 text-xs text-text-main hover:border-accent disabled:text-text-muted disabled:opacity-70"
            >
              {getRemotePluginEnabledActionLabel(
                LL,
                installedPlugin,
                managementState,
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                onUninstall(installedPlugin);
              }}
              disabled={managing}
              className="inline-flex min-h-9 min-w-28 items-center justify-center rounded border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:text-red-200 disabled:text-text-muted disabled:opacity-70"
            >
              {managementState === "uninstalling"
                ? LL.pluginPage.remote.uninstalling()
                : LL.pluginPage.remote.uninstall()}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 text-xs text-red-300">
          <AlertCircle size={14} aria-hidden="true" className="mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {readmeUrl && (
        <section className="mt-6 border-t border-border-main/70 pt-4">
          <h4 className="text-xs font-medium text-text-main">
            {LL.pluginPage.remote.readme()}
          </h4>

          {readmeState.loading && (
            <div className="mt-3 text-xs text-text-muted">
              {LL.pluginPage.remote.readmeLoading()}
            </div>
          )}

          {readmeState.error && (
            <div className="mt-3 text-xs text-red-300">{readmeState.error}</div>
          )}

          {hasReadmeContent && (
            <PluginReadmeMarkdown
              content={readmeState.content}
              baseUrl={readmeUrl}
            />
          )}
        </section>
      )}
    </aside>
  );
};

const RemotePluginMetadataLine = ({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) => (
  <div className="grid min-w-0 gap-1 min-[520px]:grid-cols-[7.5rem_minmax(0,1fr)]">
    <div className="text-text-muted">{label}</div>
    <div className="min-w-0 text-text-main">{value}</div>
  </div>
);

const getRemotePluginReadmeUrl = (entry: PluginRegistryEntry) =>
  entry.readmeUrl ??
  getRemotePluginReadmeUrlFromRepositoryUrl(entry.repositoryUrl, entry.id);

const getRemotePluginReadmeUrlFromRepositoryUrl = (
  repositoryUrl: string | undefined,
  pluginId: string,
) => {
  if (!repositoryUrl) {
    return undefined;
  }

  try {
    const url = new URL(repositoryUrl);
    const [owner, repo] = getGitHubRepositoryPath(url);

    if (owner !== "getglimpse" || repo !== "plugins") {
      return undefined;
    }

    return `https://raw.githubusercontent.com/getglimpse/plugins/main/${pluginId}/README.md`;
  } catch {
    return undefined;
  }
};

const getGitHubRepositoryPath = (url: URL) => {
  if (!isGitHubUrl(url)) {
    return [];
  }

  return url.pathname.split("/").filter(Boolean);
};

const isGitHubUrl = (url: URL) => {
  const host = url.hostname.toLowerCase();

  return (
    url.protocol === "https:" &&
    (host === "github.com" || host === "www.github.com")
  );
};

const PluginReadmeMarkdown = ({
  content,
  baseUrl,
}: {
  content: string;
  baseUrl?: string;
}) => (
  <div
    className="
      prose prose-sm mt-3 max-w-none select-text break-words text-sm
      [--tw-prose-body:var(--text-main)]
      [--tw-prose-headings:var(--text-main)]
      [--tw-prose-links:var(--accent)]
      [--tw-prose-bold:var(--text-main)]
      [--tw-prose-counters:var(--text-muted)]
      [--tw-prose-bullets:var(--text-muted)]
      [--tw-prose-hr:var(--border)]
      [--tw-prose-quotes:var(--text-main)]
      [--tw-prose-quote-borders:var(--accent)]
      [--tw-prose-code:var(--text-main)]
      [--tw-prose-pre-code:var(--text-main)]
      [--tw-prose-pre-bg:var(--main-bg)]
      prose-headings:mt-4 prose-headings:mb-2
      prose-p:my-2 prose-li:text-text-main
      prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-main-bg prose-a:text-accent
    "
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const resolvedHref = resolvePluginReadmeLink(href, baseUrl);

          return (
            <button
              type="button"
              onClick={() => {
                if (resolvedHref) {
                  openRemotePluginLink(resolvedHref);
                }
              }}
              disabled={!resolvedHref}
              className="text-left text-accent hover:underline disabled:text-text-muted"
            >
              {children}
            </button>
          );
        },
        img: ({ alt }) =>
          alt ? <span className="text-text-muted">{alt}</span> : null,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

const formatRemoteDownloadCount = (downloadCount: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(downloadCount);

const formatRemoteRelativeDate = (date: string, locale: string) => {
  const timestamp = Date.parse(`${date}T00:00:00Z`);

  if (!Number.isFinite(timestamp)) {
    return date;
  }

  const diffInSeconds = Math.round((timestamp - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  for (const [unit, seconds] of units) {
    if (Math.abs(diffInSeconds) >= seconds || unit === "minute") {
      return formatter.format(Math.round(diffInSeconds / seconds), unit);
    }
  }

  return formatter.format(0, "minute");
};

const resolvePluginReadmeLink = (
  href: string | undefined,
  baseUrl: string | undefined,
) => {
  if (!href) {
    return null;
  }

  try {
    const url = baseUrl ? new URL(href, baseUrl) : new URL(href);

    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const openRemotePluginLink = (url: string) => {
  void openerApi.openExternalUrl(url).catch((openError) => {
    console.warn("Failed to open plugin detail URL:", openError);
  });
};

const isRemotePluginActionDisabled = (
  installKind: RemotePluginInstallKind,
  installState: RemotePluginInstallState | undefined,
) =>
  Boolean(installState) ||
  installKind === "installed" ||
  installKind === "unsupported";

const RemotePluginStatusBadge = ({
  failed,
  installKind,
  label,
}: {
  failed: boolean;
  installKind: RemotePluginInstallKind;
  label: string;
}) => (
  <span
    className={`rounded border px-1.5 py-0.5 text-xs ${
      failed || installKind === "unsupported"
        ? "border-red-500/40 text-red-300"
        : installKind === "update-available"
          ? "border-accent/50 text-accent"
          : "border-border-main text-text-muted"
    }`}
  >
    {label}
  </span>
);

const getRemotePluginStatusLabel = (
  LL: TranslationFunctions,
  installKind: RemotePluginInstallKind,
  installState: RemotePluginInstallState | undefined,
  failed: boolean,
) => {
  if (failed) {
    return LL.pluginPage.remote.states.failed();
  }

  if (installState === "downloading") {
    return LL.pluginPage.remote.states.downloading();
  }

  if (installState === "installing") {
    return LL.pluginPage.remote.states.installing();
  }

  if (installKind === "not-installed") {
    return LL.pluginPage.remote.states.notInstalled();
  }

  if (installKind === "update-available") {
    return LL.pluginPage.remote.states.updateAvailable();
  }

  if (installKind === "unsupported") {
    return LL.pluginPage.remote.states.unsupportedApiVersion();
  }

  return LL.pluginPage.remote.states.installed();
};

const getRemotePluginActionLabel = (
  LL: TranslationFunctions,
  installKind: RemotePluginInstallKind,
  installState: RemotePluginInstallState | undefined,
) => {
  if (installState === "downloading") {
    return LL.pluginPage.remote.downloading();
  }

  if (installState === "installing") {
    return LL.pluginPage.remote.installing();
  }

  if (installKind === "update-available") {
    return LL.pluginPage.remote.update();
  }

  if (installKind === "installed") {
    return LL.pluginPage.remote.installed();
  }

  if (installKind === "unsupported") {
    return LL.pluginPage.remote.unsupported();
  }

  return LL.pluginPage.remote.install();
};

const getRemotePluginEnabledActionLabel = (
  LL: TranslationFunctions,
  plugin: PluginRegistryItem,
  managementState: RemotePluginManagementState | undefined,
) => {
  if (managementState === "enabling") {
    return LL.pluginPage.remote.enabling();
  }

  if (managementState === "disabling") {
    return LL.pluginPage.remote.disabling();
  }

  return plugin.enabled
    ? LL.pluginPage.remote.disable()
    : LL.pluginPage.remote.enable();
};

const Section = ({
  title,
  children,
  className,
  contentClassName,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) => (
  <section className={["mb-6", className].filter(Boolean).join(" ")}>
    {title && (
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h2>
    )}
    <div
      className={[
        "divide-y divide-border-main/60 border-y border-border-main/60",
        contentClassName,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  </section>
);
