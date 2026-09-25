import { useEffect, useRef, useState, type ReactNode } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { OPEN_LOCAL_PLUGIN_INSTALL_EVENT } from "@/features/plugins/events/page";
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
} from "@/features/plugins/registry";
import { useI18nContext } from "@/i18n/I18nProvider";
import type { PluginRegistryItem } from "@/types";
import {
  InstalledPluginSearchActions,
  LocalPluginInstallDialog,
  PluginSearchControls,
} from "./pluginManagement/InstallControls";
import {
  InstalledPluginDetail,
  InstalledPluginRow,
  PluginCard,
} from "./pluginManagement/InstalledPluginDetails";

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
  const contentRef = useRef<HTMLDivElement>(null);
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
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [pluginLayoutWide, setPluginLayoutWide] = useState(false);

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
    const element = contentRef.current;

    if (!element) {
      return;
    }

    const updateLayout = () => {
      setPluginLayoutWide(element.clientWidth >= 760);
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

      setPluginLayoutWide(
        (entry?.contentRect.width ?? element.clientWidth) >= 760,
      );
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

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

  const handleEnabledChange = (
    plugin: PluginRegistryItem,
    enabled: boolean,
  ) => {
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
  };

  const handleUninstall = (plugin: PluginRegistryItem) => {
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
  const selectedPlugin =
    filteredPlugins.find((plugin) => plugin.id === selectedPluginId) ??
    filteredPlugins[0] ??
    null;
  const pluginSearchPlaceholder = LL.pluginPage.installed.searchPlaceholder();

  return (
    <div
      className={`h-full w-full px-4 py-3 text-sm text-text-main sm:px-6 ${
        pluginLayoutWide
          ? "flex min-h-0 flex-col overflow-hidden"
          : "overflow-y-auto"
      }`}
    >
      <div
        ref={contentRef}
        className={`@container mx-auto max-w-5xl ${
          pluginLayoutWide ? "flex min-h-0 w-full flex-1 flex-col" : ""
        }`}
      >
        <Section
          className={
            pluginLayoutWide ? "mb-0 flex min-h-0 flex-1 flex-col" : undefined
          }
          contentClassName={
            pluginLayoutWide ? "flex min-h-0 flex-1 flex-col" : undefined
          }
        >
          <div
            data-testid="installed-plugin-layout"
            className={`grid gap-3 py-0 ${
              selectedPlugin
                ? "@min-[760px]:grid-cols-[minmax(200px,320px)_minmax(0,1fr)] @min-[1024px]:grid-cols-[minmax(220px,360px)_minmax(0,1fr)]"
                : ""
            } ${pluginLayoutWide ? "min-h-0 flex-1" : ""}`}
          >
            <div className="space-y-3 @min-[760px]:flex @min-[760px]:min-h-0 @min-[760px]:flex-col">
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

              {pluginLayoutWide && filteredPlugins.length > 0 && (
                <div className="overflow-hidden rounded-md border border-border-main bg-main-bg @min-[760px]:min-h-0 @min-[760px]:flex-1 @min-[760px]:overflow-y-auto">
                  {filteredPlugins.map((plugin) => (
                    <InstalledPluginRow
                      key={plugin.id}
                      plugin={plugin}
                      selected={plugin.id === selectedPlugin?.id}
                      onSelect={() => {
                        setSelectedPluginId(plugin.id);
                      }}
                    />
                  ))}
                </div>
              )}

              {!pluginLayoutWide &&
                filteredPlugins.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    trusting={trustingPluginId === plugin.id}
                    uninstalling={uninstallingPluginId === plugin.id}
                    LL={LL}
                    onEnabledChange={(enabled) => {
                      handleEnabledChange(plugin, enabled);
                    }}
                    onUninstall={() => {
                      handleUninstall(plugin);
                    }}
                  />
                ))}
            </div>

            {pluginLayoutWide && selectedPlugin && (
              <InstalledPluginDetail
                plugin={selectedPlugin}
                trusting={trustingPluginId === selectedPlugin.id}
                uninstalling={uninstallingPluginId === selectedPlugin.id}
                LL={LL}
                onEnabledChange={(enabled) => {
                  handleEnabledChange(selectedPlugin, enabled);
                }}
                onUninstall={() => {
                  handleUninstall(selectedPlugin);
                }}
              />
            )}
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
