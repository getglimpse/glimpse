import { useEffect, useRef, useState, type ReactNode } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { FolderOpen, RefreshCw, Search, Trash2 } from "lucide-react";

import { pluginsApi } from "@/api/plugins";
import { Switch } from "@/components/ui/switch";
import {
  getPluginDiscoveryErrors,
  getPlugins,
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
          const result = await installPluginFromPath(sourcePath, true);

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
  const pluginCapabilities = getPluginCapabilities(LL);
  const pluginSearchPlaceholder = LL.pluginPage.installed.searchPlaceholder();

  return (
    <div className="h-full w-full overflow-y-auto p-6 text-sm text-text-main">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">{LL.pluginPage.title()}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {LL.pluginPage.subtitle()}
          </p>
        </header>

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
              {plugins.length > 0 && (
                <div className="relative min-w-0 flex-1">
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
              )}
              <div className="flex shrink-0 items-center gap-2">
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
