import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  Download,
  ExternalLink,
  FolderOpen,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import { pluginsApi } from "@/api/plugins";
import { Switch } from "@/components/ui/switch";
import {
  getRemotePluginInstallErrorMessage,
  isRegistryEntryApiSupported,
  OFFICIAL_PLUGIN_REGISTRY_URL,
  validatePluginRegistry,
} from "@/features/plugins/remotePluginRegistry";
import {
  getPluginDiscoveryErrors,
  getPlugins,
  installPluginFromArchive,
  installPluginFromPath,
  installPluginFromUrl,
  loadPlugins,
  reloadPlugins,
  setPluginEnabled,
  setPluginTrusted,
  subscribeToPluginChanges,
  uninstallPlugin,
} from "@/features/plugins/pluginRegistry";
import { useI18nContext } from "@/i18n/I18nProvider";
import type { TranslationFunctions } from "@/i18n/i18n-types";
import type { PluginRegistryEntry, PluginRegistryItem } from "@/types";

const getPluginCapabilities = (LL: TranslationFunctions) => [
  {
    name: LL.pluginPage.capabilities.viewer.name(),
    runtime: "frontend",
    description: LL.pluginPage.capabilities.viewer.description(),
  },
  {
    name: LL.pluginPage.capabilities.extractor.name(),
    runtime: "frontend worker",
    description: LL.pluginPage.capabilities.extractor.description(),
  },
  {
    name: LL.pluginPage.capabilities.thumbnailer.name(),
    runtime: "frontend worker",
    description: LL.pluginPage.capabilities.thumbnailer.description(),
  },
  {
    name: LL.pluginPage.capabilities.pageBlock.name(),
    runtime: "frontend",
    description: LL.pluginPage.capabilities.pageBlock.description(),
  },
  {
    name: LL.pluginPage.capabilities.featureTemplate.name(),
    runtime: "frontend",
    description: LL.pluginPage.capabilities.featureTemplate.description(),
  },
];

const pluginMatchesSearch = (
  plugin: PluginRegistryItem,
  normalizedQuery: string,
) =>
  [
    plugin.name,
    plugin.id,
    plugin.version,
    `v${plugin.version}`,
    plugin.description ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);

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
    plugin.releaseDate ?? "",
    plugin.sourceUrl ?? "",
    plugin.repositoryUrl ?? "",
    plugin.homepageUrl ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);

type RemotePluginInstallState = "downloading" | "installing" | "failed";

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
) => {
  if (!isRegistryEntryApiSupported(entry)) {
    return "unsupported" as const;
  }

  if (!installedPlugin) {
    return "not-installed" as const;
  }

  if (compareVersionTriplets(entry.version, installedPlugin.version) > 0) {
    return "update-available" as const;
  }

  return "installed" as const;
};

export const PluginPage = () => {
  const { LL } = useI18nContext();
  const [plugins, setPlugins] = useState<PluginRegistryItem[]>(() =>
    getPlugins(),
  );
  const [discoveryErrors, setDiscoveryErrors] = useState(() =>
    getPluginDiscoveryErrors(),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trustingPluginId, setTrustingPluginId] = useState<string | null>(null);
  const [uninstallingPluginId, setUninstallingPluginId] = useState<
    string | null
  >(null);
  const [installSourcePath, setInstallSourcePath] = useState("");
  const [installing, setInstalling] = useState(false);
  const installingRef = useRef(false);
  const [draggingPluginFolder, setDraggingPluginFolder] = useState(false);
  const [managementMessage, setManagementMessage] = useState<string | null>(
    null,
  );
  const [reloadingAll, setReloadingAll] = useState(false);
  const [pluginSearchQuery, setPluginSearchQuery] = useState("");
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
        setLoadError(null);
      })
      .catch((error) => {
        setLoadError(String(error));
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
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDraggingPluginFolder(true);
          return;
        }

        if (event.payload.type === "leave") {
          setDraggingPluginFolder(false);
          return;
        }

        setDraggingPluginFolder(false);

        if (event.payload.paths.length > 0) {
          setInstallSourcePath(event.payload.paths.join("\n"));
          void installFromSources(event.payload.paths);
        }
      })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }

        unlisten = dispose;
      })
      .catch((error) => {
        console.warn("Failed to listen for plugin folder drops:", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const installFromSources = async (sourcePaths: string[]) => {
    const trimmedSourcePaths = [
      ...new Set(
        sourcePaths.map((sourcePath) => sourcePath.trim()).filter(Boolean),
      ),
    ];

    if (trimmedSourcePaths.length === 0 || installingRef.current) {
      return;
    }

    installingRef.current = true;
    setInstalling(true);
    setManagementMessage(null);

    const results: string[] = [];

    try {
      for (const sourcePath of trimmedSourcePaths) {
        try {
          const result = sourcePath.endsWith(".glimpse-plugin.zip")
            ? await installPluginFromArchive(sourcePath, true)
            : await installPluginFromPath(sourcePath, true);

          results.push(
            LL.pluginPage.installed.installSuccess({
              pluginId: result.pluginId,
            }),
          );
        } catch (error) {
          results.push(
            LL.pluginPage.installed.installFailed({
              error: `${sourcePath}: ${String(error)}`,
            }),
          );
        }
      }

      setPlugins(getPlugins());
      setDiscoveryErrors(getPluginDiscoveryErrors());
      setInstallSourcePath("");
      setManagementMessage(results.join("\n"));
    } finally {
      installingRef.current = false;
      setInstalling(false);
    }
  };

  const installSourcePaths = installSourcePath
    .split(/\r?\n/)
    .map((sourcePath) => sourcePath.trim())
    .filter(Boolean);

  const canInstall =
    !installing &&
    installSourcePaths.length > 0 &&
    installSourcePaths.every(Boolean);

  const handleInstallButtonClick = () => {
    void installFromSources(installSourcePaths);
  };

  const handleInstallSourcePathChange = (nextInstallSourcePath: string) => {
    setInstallSourcePath(nextInstallSourcePath);
  };

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

    window.setTimeout(() => {
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
        setRemoteInstallStates((states) => {
          const nextStates = { ...states };

          delete nextStates[entry.id];

          return nextStates;
        });
      });
  };

  const renderSelectedInstallPaths = () => {
    if (installSourcePaths.length === 0) {
      return null;
    }

    return (
      <div className="max-w-full space-y-1">
        {installSourcePaths.map((sourcePath) => (
          <code
            key={sourcePath}
            className="block max-w-full break-all rounded border border-border-main px-2 py-1 text-xs text-text-muted"
          >
            {sourcePath}
          </code>
        ))}
      </div>
    );
  };

  const normalizedPluginSearchQuery = pluginSearchQuery.trim().toLowerCase();
  const filteredPlugins =
    normalizedPluginSearchQuery.length > 0
      ? plugins.filter((plugin) =>
          pluginMatchesSearch(plugin, normalizedPluginSearchQuery),
        )
      : plugins;
  const filteredRemotePlugins =
    normalizedPluginSearchQuery.length > 0
      ? remotePlugins.filter((plugin) =>
          remotePluginMatchesSearch(plugin, normalizedPluginSearchQuery),
        )
      : remotePlugins;
  const pluginCapabilities = getPluginCapabilities(LL);
  const pluginSearchPlaceholder = LL.pluginPage.searchPlaceholder();

  return (
    <div className="h-full w-full overflow-y-auto p-6 text-sm text-text-main">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">{LL.pluginPage.title()}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {LL.pluginPage.subtitle()}
          </p>
        </header>

        <div className="mb-4 rounded-md border border-border-main bg-main-bg p-3">
          <div className="relative">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              type="search"
              value={pluginSearchQuery}
              onChange={(event) => {
                setPluginSearchQuery(event.target.value);
              }}
              aria-label={pluginSearchPlaceholder}
              placeholder={pluginSearchPlaceholder}
              className="h-9 w-full rounded border border-border-main bg-transparent pl-8 pr-3 text-sm text-text-main outline-none placeholder:text-text-muted focus:border-accent"
            />
          </div>
        </div>

        <Section title={LL.pluginPage.sections.remotePlugins()}>
          <div className="space-y-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-main bg-main-bg p-3 text-xs text-text-muted">
              <div className="min-w-0">
                <div className="font-medium text-text-main">
                  {LL.pluginPage.remote.registry()}
                </div>
                <code className="mt-1 block break-all text-[11px] text-text-muted">
                  {OFFICIAL_PLUGIN_REGISTRY_URL}
                </code>
              </div>
              <button
                type="button"
                onClick={() => {
                  void loadRemoteRegistry();
                }}
                disabled={remoteRegistryLoading}
                aria-label={LL.pluginPage.remote.refresh()}
                title={LL.pluginPage.remote.refresh()}
                className="inline-flex size-8 items-center justify-center rounded border border-border-main text-text-muted hover:text-text-main disabled:opacity-50"
              >
                <RefreshCw
                  size={16}
                  aria-hidden="true"
                  className={remoteRegistryLoading ? "animate-spin" : undefined}
                />
              </button>
            </div>

            {remoteRegistryError && (
              <div className="rounded-md border border-red-500/40 bg-main-bg p-3 text-red-400">
                {LL.pluginPage.remote.loadError({
                  error: remoteRegistryError,
                })}
              </div>
            )}

            {remoteManagementMessage && (
              <div className="rounded-md border border-border-main bg-main-bg p-3 text-xs text-text-muted">
                {remoteManagementMessage}
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
              filteredRemotePlugins.length === 0 && (
                <div className="rounded-md border border-border-main bg-main-bg p-3 text-text-muted">
                  {LL.pluginPage.remote.noSearchResults()}
                </div>
              )}

            {filteredRemotePlugins.map((entry) => (
              <RemotePluginCard
                key={entry.id}
                entry={entry}
                installedPlugin={plugins.find((plugin) => plugin.id === entry.id)}
                installState={remoteInstallStates[entry.id]}
                error={remoteInstallErrors[entry.id]}
                LL={LL}
                onInstall={() => {
                  handleRemoteInstall(entry);
                }}
              />
            ))}
          </div>
        </Section>

        <Section title={LL.pluginPage.sections.installedPlugins()}>
          <div className="space-y-4 py-3">
            <div className="rounded-md border border-border-main bg-main-bg p-3">
              <div className="space-y-3">
                <button
                  type="button"
                  disabled={installing}
                  onClick={handleInstallButtonClick}
                  className={`flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-5 text-center transition-colors disabled:opacity-50 ${
                    draggingPluginFolder
                      ? "border-accent bg-item-hover text-text-main"
                      : "border-border-main text-text-muted hover:border-accent hover:text-text-main"
                  }`}
                >
                  <span className="text-sm font-medium text-text-main">
                    {installing
                      ? LL.pluginPage.installed.installing()
                      : LL.pluginPage.installed.install()}
                  </span>
                  <span className="max-w-xl text-xs">
                    {LL.pluginPage.installed.installDropHint()}
                  </span>
                  <span className="max-w-xl text-xs text-text-muted">
                    {LL.pluginPage.installed.installReplaceHint()}
                  </span>
                  {renderSelectedInstallPaths()}
                </button>

                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <textarea
                    value={installSourcePath}
                    onChange={(event) => {
                      handleInstallSourcePathChange(event.target.value);
                    }}
                    placeholder={LL.pluginPage.installed.installPlaceholder()}
                    rows={Math.min(Math.max(installSourcePaths.length, 1), 4)}
                    className="min-h-8 resize-y rounded border border-border-main bg-transparent px-2 py-1.5 text-xs text-text-main placeholder:text-text-muted"
                  />
                  <button
                    type="button"
                    disabled={!canInstall}
                    onClick={handleInstallButtonClick}
                    className="rounded border border-border-main px-2 py-1 text-xs text-text-muted hover:text-text-main disabled:opacity-50"
                  >
                    {installing
                      ? LL.pluginPage.installed.installing()
                      : LL.pluginPage.installed.install()}
                  </button>
                </div>

                {managementMessage && (
                  <div className="whitespace-pre-line text-xs text-text-muted">
                    {managementMessage}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-md border border-border-main bg-main-bg p-3 text-xs text-text-muted">
              <div className="flex w-full items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void pluginsApi.openFolder();
                  }}
                  aria-label={LL.pluginPage.installed.openFolder()}
                  title={LL.pluginPage.installed.openFolder()}
                  className="inline-flex size-8 items-center justify-center rounded border border-border-main text-text-muted hover:text-text-main"
                >
                  <FolderOpen size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReloadingAll(true);
                    void reloadPlugins()
                      .then(() => {
                        setPlugins(getPlugins());
                        setDiscoveryErrors(getPluginDiscoveryErrors());
                        setLoadError(null);
                      })
                      .catch((error) => {
                        setLoadError(String(error));
                      })
                      .finally(() => {
                        setReloadingAll(false);
                      });
                  }}
                  disabled={reloadingAll}
                  aria-label={LL.pluginPage.installed.reloadAll()}
                  title={LL.pluginPage.installed.reloadAll()}
                  className="inline-flex size-8 items-center justify-center rounded border border-border-main text-text-muted hover:text-text-main disabled:opacity-50"
                >
                  <RefreshCw
                    size={16}
                    aria-hidden="true"
                    className={reloadingAll ? "animate-spin" : undefined}
                  />
                </button>
              </div>
            </div>

            {loadError && (
              <div className="rounded-md border border-red-500/40 bg-main-bg p-3 text-red-400">
                {LL.pluginPage.installed.loadError({ error: loadError })}
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

            {!loadError && plugins.length === 0 && (
              <div className="rounded-md border border-border-main bg-main-bg p-3 text-text-muted">
                {LL.pluginPage.installed.empty()}
              </div>
            )}

            {!loadError &&
              plugins.length > 0 &&
              filteredPlugins.length === 0 && (
                <div className="rounded-md border border-border-main bg-main-bg p-3 text-text-muted">
                  {LL.pluginPage.installed.noSearchResults()}
                </div>
              )}

            {filteredPlugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                trusting={trustingPluginId === plugin.id}
                uninstalling={uninstallingPluginId === plugin.id}
                LL={LL}
                onEnabledChange={(enabled) => {
                  setTrustingPluginId(plugin.id);
                  const updatePluginState = enabled
                    ? setPluginTrusted(plugin.id, true).then(() => {
                        setPluginEnabled(plugin.id, true);
                      })
                    : setPluginTrusted(plugin.id, false);

                  void updatePluginState
                    .then(() => {
                      setPlugins(getPlugins());
                      setDiscoveryErrors(getPluginDiscoveryErrors());
                    })
                    .catch((error) => {
                      console.error("Failed to update plugin state:", error);
                    })
                    .finally(() => {
                      setTrustingPluginId(null);
                    });
                }}
                onUninstall={() => {
                  const confirmed = window.confirm(
                    LL.pluginPage.pluginRow.uninstallConfirm({
                      name: plugin.name,
                    }),
                  );

                  if (!confirmed) {
                    return;
                  }

                  setUninstallingPluginId(plugin.id);
                  setManagementMessage(null);
                  void uninstallPlugin(plugin.id)
                    .then(() => {
                      setPlugins(getPlugins());
                      setDiscoveryErrors(getPluginDiscoveryErrors());
                      setManagementMessage(
                        LL.pluginPage.pluginRow.uninstallSuccess({
                          pluginId: plugin.id,
                        }),
                      );
                    })
                    .catch((error) => {
                      setManagementMessage(
                        LL.pluginPage.pluginRow.uninstallFailed({
                          error: String(error),
                        }),
                      );
                    })
                    .finally(() => {
                      setUninstallingPluginId(null);
                    });
                }}
              />
            ))}
          </div>
        </Section>

        <Section title={LL.pluginPage.sections.pluginModel()}>
          <InfoRow
            label={LL.pluginPage.pluginModel.package.label()}
            value={LL.pluginPage.pluginModel.package.value()}
          />
          <InfoRow
            label={LL.pluginPage.pluginModel.capability.label()}
            value={LL.pluginPage.pluginModel.capability.value()}
          />
          <InfoRow
            label={LL.pluginPage.pluginModel.runtime.label()}
            value={LL.pluginPage.pluginModel.runtime.value()}
          />
          <InfoRow
            label={LL.pluginPage.pluginModel.permissionScope.label()}
            value={LL.pluginPage.pluginModel.permissionScope.value()}
          />
        </Section>

        <Section title={LL.pluginPage.sections.capabilities()}>
          <div className="divide-y divide-border-main/60">
            {pluginCapabilities.map((capability) => (
              <div
                key={capability.name}
                className="grid gap-2 py-3 sm:grid-cols-[140px_120px_1fr]"
              >
                <div className="font-medium text-text-main">
                  {capability.name}
                </div>
                <code className="text-xs text-accent">
                  {capability.runtime}
                </code>
                <div className="text-text-muted">{capability.description}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title={LL.pluginPage.sections.featurePages()}>
          <p className="py-3 text-text-muted">
            {LL.pluginPage.featurePages.description()}
          </p>
        </Section>
      </div>
    </div>
  );
};

const RemotePluginCard = ({
  entry,
  installedPlugin,
  installState,
  error,
  LL,
  onInstall,
}: {
  entry: PluginRegistryEntry;
  installedPlugin?: PluginRegistryItem;
  installState?: RemotePluginInstallState;
  error?: string;
  LL: TranslationFunctions;
  onInstall: () => void;
}) => {
  const installKind = getRemotePluginInstallKind(entry, installedPlugin);
  const sourceUrl = entry.sourceUrl ?? entry.homepageUrl ?? entry.repositoryUrl;
  const disabled =
    Boolean(installState) ||
    installKind === "installed" ||
    installKind === "unsupported";
  const statusLabel = getRemotePluginStatusLabel(
    LL,
    installKind,
    installState,
    Boolean(error),
  );
  const actionLabel = getRemotePluginActionLabel(LL, installKind, installState);

  return (
    <article className="rounded-md border border-border-main bg-main-bg p-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <span className="min-w-0 text-base font-medium text-text-main">
              {entry.name}
            </span>
            <code className="break-all rounded border border-border-main px-1.5 py-0.5 text-xs text-text-muted">
              {entry.id}
            </code>
            <span className="text-xs text-text-muted">v{entry.version}</span>
            <span
              className={`rounded border px-1.5 py-0.5 text-xs ${
                error || installKind === "unsupported"
                  ? "border-red-500/40 text-red-300"
                  : installKind === "update-available"
                    ? "border-accent/50 text-accent"
                    : "border-border-main text-text-muted"
              }`}
            >
              {statusLabel}
            </span>
          </div>

          {entry.description && (
            <p className="mt-1 text-text-muted">{entry.description}</p>
          )}

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            <span>
              {LL.pluginPage.remote.apiVersion({ version: entry.apiVersion })}
            </span>
            {entry.releaseDate && (
              <span>
                {LL.pluginPage.remote.releaseDate({
                  date: entry.releaseDate,
                })}
              </span>
            )}
            {installedPlugin && (
              <span>
                {LL.pluginPage.remote.installedVersion({
                  version: installedPlugin.version,
                })}
              </span>
            )}
          </div>

          {sourceUrl && (
            <button
              type="button"
              onClick={() => {
                void openUrl(sourceUrl).catch((openError) => {
                  console.warn("Failed to open plugin source URL:", openError);
                });
              }}
              className="mt-3 inline-flex items-center gap-1 rounded border border-border-main px-2 py-1 text-xs text-text-muted hover:text-text-main"
            >
              <ExternalLink size={13} aria-hidden="true" />
              {LL.pluginPage.remote.source()}
            </button>
          )}

          {error && (
            <div className="mt-3 flex items-start gap-2 text-xs text-red-300">
              <AlertCircle size={14} aria-hidden="true" className="mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onInstall}
          disabled={disabled}
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-border-main px-3 py-1.5 text-xs text-text-main hover:border-accent disabled:text-text-muted disabled:opacity-70"
        >
          <Download size={14} aria-hidden="true" />
          {actionLabel}
        </button>
      </div>
    </article>
  );
};

const getRemotePluginStatusLabel = (
  LL: TranslationFunctions,
  installKind: ReturnType<typeof getRemotePluginInstallKind>,
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
  installKind: ReturnType<typeof getRemotePluginInstallKind>,
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

const PluginCard = ({
  plugin,
  trusting,
  uninstalling,
  LL,
  onEnabledChange,
  onUninstall,
}: {
  plugin: PluginRegistryItem;
  trusting: boolean;
  uninstalling: boolean;
  LL: TranslationFunctions;
  onEnabledChange: (enabled: boolean) => void;
  onUninstall: () => void;
}) => {
  return (
    <article className="rounded-md border border-border-main bg-main-bg p-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <span className="min-w-0 text-base font-medium text-text-main">
              {plugin.name}
            </span>
            <code className="break-all rounded border border-border-main px-1.5 py-0.5 text-xs text-text-muted">
              {plugin.id}
            </code>
            <span className="text-xs text-text-muted">v{plugin.version}</span>
          </div>

          {plugin.description && (
            <p className="mt-1 truncate text-text-muted">
              {plugin.description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 justify-self-start sm:justify-end">
          <label className="flex items-center gap-2">
            <span className="text-xs text-text-muted">
              {plugin.enabled
                ? LL.pluginPage.pluginRow.on()
                : LL.pluginPage.pluginRow.off()}
            </span>
            <Switch
              checked={plugin.enabled}
              onCheckedChange={onEnabledChange}
              disabled={trusting}
              aria-label={LL.pluginPage.pluginRow.toggleLabel({
                name: plugin.name,
              })}
            />
          </label>
          <button
            type="button"
            onClick={onUninstall}
            disabled={uninstalling}
            aria-label={LL.pluginPage.pluginRow.uninstall()}
            title={LL.pluginPage.pluginRow.uninstall()}
            className="inline-flex size-8 items-center justify-center rounded border border-red-500/40 text-red-300 hover:text-red-200 disabled:opacity-50"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
};

const Section = ({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) => (
  <section className="mb-6">
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
      {title}
    </h2>
    <div className="divide-y divide-border-main/60 border-y border-border-main/60">
      {children}
    </div>
  </section>
);

const InfoRow = ({ label, value }: { label: ReactNode; value: ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <span className="text-text-muted">{label}</span>
    <span className="font-mono text-xs text-text-main">{value}</span>
  </div>
);
