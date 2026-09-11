import { useEffect, useRef, useState, type ReactNode } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { FolderOpen, RefreshCw, Search, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { openerApi } from "@/api/opener";
import { pluginsApi } from "@/api/plugins";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { OPEN_LOCAL_PLUGIN_INSTALL_EVENT } from "@/features/plugins/pluginPageEvents";
import {
  getPluginDiscoveryErrors,
  getPlugins,
  installPluginFromArchive,
  installPluginFromPath,
  loadPlugins,
  reloadPlugins,
  setPluginEnabled,
  setPluginTrusted,
  subscribeToPluginChanges,
  uninstallPlugin,
} from "@/features/plugins/pluginRegistry";
import { useI18nContext } from "@/i18n/I18nProvider";
import type { TranslationFunctions } from "@/i18n/i18n-types";
import type { PluginRegistryItem } from "@/types";

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

export const PluginManagementPage = () => {
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
  const [localInstallDialogOpen, setLocalInstallDialogOpen] = useState(false);
  const localInstallDialogOpenRef = useRef(false);
  const [draggingPluginFolder, setDraggingPluginFolder] = useState(false);
  const [managementMessage, setManagementMessage] = useState<string | null>(
    null,
  );
  const [reloadingAll, setReloadingAll] = useState(false);
  const [pluginSearchQuery, setPluginSearchQuery] = useState("");

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
    localInstallDialogOpenRef.current = localInstallDialogOpen;
  }, [localInstallDialogOpen]);

  useEffect(() => {
    const openLocalInstallDialog = () => {
      setLocalInstallDialogOpen(true);
    };

    window.addEventListener(
      OPEN_LOCAL_PLUGIN_INSTALL_EVENT,
      openLocalInstallDialog,
    );

    return () => {
      window.removeEventListener(
        OPEN_LOCAL_PLUGIN_INSTALL_EVENT,
        openLocalInstallDialog,
      );
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (!localInstallDialogOpenRef.current) {
          return;
        }

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

  const handleReloadAll = () => {
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
  const pluginSearchPlaceholder = LL.pluginPage.installed.searchPlaceholder();

  return (
    <div className="h-full w-full overflow-y-auto p-6 text-sm text-text-main">
      <div className="@container mx-auto max-w-5xl">
        <Section>
          <div className="space-y-4 py-3">
            <PluginSearchControls
              placeholder={pluginSearchPlaceholder}
              value={pluginSearchQuery}
              onChange={setPluginSearchQuery}
              actions={
                <InstalledPluginSearchActions
                  LL={LL}
                  reloadingAll={reloadingAll}
                  onReloadAll={handleReloadAll}
                />
              }
            />

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

        <LocalPluginInstallDialog
          canInstall={canInstall}
          draggingPluginFolder={draggingPluginFolder}
          installSourcePath={installSourcePath}
          installSourcePaths={installSourcePaths}
          installing={installing}
          LL={LL}
          managementMessage={managementMessage}
          open={localInstallDialogOpen}
          onInstall={handleInstallButtonClick}
          onOpenChange={(open) => {
            setLocalInstallDialogOpen(open);

            if (!open) {
              setDraggingPluginFolder(false);
            }
          }}
          onSourcePathChange={handleInstallSourcePathChange}
          renderSelectedInstallPaths={renderSelectedInstallPaths}
        />
      </div>
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

const InstalledPluginSearchActions = ({
  LL,
  onReloadAll,
  reloadingAll,
}: {
  LL: TranslationFunctions;
  onReloadAll: () => void;
  reloadingAll: boolean;
}) => (
  <div className="flex items-center justify-end gap-2">
    <button
      type="button"
      onClick={() => {
        void pluginsApi.openFolder();
      }}
      aria-label={LL.pluginPage.installed.openFolder()}
      title={LL.pluginPage.installed.openFolder()}
      className="inline-flex size-9 items-center justify-center rounded border border-border-main text-text-muted hover:text-text-main"
    >
      <FolderOpen size={16} aria-hidden="true" />
    </button>
    <button
      type="button"
      onClick={onReloadAll}
      disabled={reloadingAll}
      aria-label={LL.pluginPage.installed.reloadAll()}
      title={LL.pluginPage.installed.reloadAll()}
      className="inline-flex size-9 items-center justify-center rounded border border-border-main text-text-muted hover:text-text-main disabled:opacity-50"
    >
      <RefreshCw
        size={16}
        aria-hidden="true"
        className={reloadingAll ? "animate-spin" : undefined}
      />
    </button>
  </div>
);

const LocalPluginInstallDialog = ({
  canInstall,
  draggingPluginFolder,
  installSourcePath,
  installSourcePaths,
  installing,
  LL,
  managementMessage,
  onInstall,
  onOpenChange,
  onSourcePathChange,
  open,
  renderSelectedInstallPaths,
}: {
  canInstall: boolean;
  draggingPluginFolder: boolean;
  installSourcePath: string;
  installSourcePaths: string[];
  installing: boolean;
  LL: TranslationFunctions;
  managementMessage: string | null;
  onInstall: () => void;
  onOpenChange: (open: boolean) => void;
  onSourcePathChange: (value: string) => void;
  open: boolean;
  renderSelectedInstallPaths: () => ReactNode;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{LL.pluginPage.installed.localInstall()}</DialogTitle>
        <DialogDescription>
          {LL.pluginPage.installed.installReplaceHint()}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <button
          type="button"
          disabled={installing}
          onClick={onInstall}
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
          {renderSelectedInstallPaths()}
        </button>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <textarea
            value={installSourcePath}
            onChange={(event) => {
              onSourcePathChange(event.target.value);
            }}
            placeholder={LL.pluginPage.installed.installPlaceholder()}
            rows={Math.min(Math.max(installSourcePaths.length, 1), 4)}
            className="min-h-8 resize-y rounded border border-border-main bg-transparent px-2 py-1.5 text-xs text-text-main placeholder:text-text-muted"
          />
          <button
            type="button"
            disabled={!canInstall}
            onClick={onInstall}
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
    </DialogContent>
  </Dialog>
);

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
    let cancelled = false;

    setReadmeState({ content: "", error: null, loading: true });

    void pluginsApi
      .getReadmeSource(plugin.id)
      .then((readme) => {
        if (!cancelled) {
          setReadmeState({
            content: readme.source,
            error: null,
            loading: false,
          });
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message = String(error);

        setReadmeState({
          content: "",
          error: isPluginReadmeMissing(message)
            ? null
            : LL.pluginPage.installed.readmeLoadError(),
          loading: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [LL, plugin.id]);

  const hasReadmeContent = readmeState.content.trim().length > 0;

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

      {(readmeState.loading || readmeState.error || hasReadmeContent) && (
        <details className="mt-4 border-t border-border-main/70 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-text-main marker:text-text-muted">
            {LL.pluginPage.installed.readme()}
          </summary>

          {readmeState.loading && (
            <div className="mt-3 text-xs text-text-muted">
              {LL.pluginPage.installed.readmeLoading()}
            </div>
          )}

          {readmeState.error && (
            <div className="mt-3 text-xs text-red-300">{readmeState.error}</div>
          )}

          {hasReadmeContent && (
            <PluginReadmeMarkdown content={readmeState.content} />
          )}
        </details>
      )}
    </article>
  );
};

const isPluginReadmeMissing = (message: string) =>
  message.toLowerCase().includes("plugin readme not found");

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
                  openPluginReadmeLink(resolvedHref);
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

const openPluginReadmeLink = (url: string) => {
  void openerApi.openExternalUrl(url).catch((openError) => {
    console.warn("Failed to open plugin README URL:", openError);
  });
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
