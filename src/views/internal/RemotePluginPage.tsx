import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  createRemotePluginViews,
  remotePluginMatchesSearch,
} from "@/features/plugins/remote/viewModel";
import { useRemotePluginCatalog } from "@/features/plugins/remote/useCatalog";
import { useI18nContext } from "@/i18n/I18nProvider";

import { RemotePluginDetail } from "./remotePlugin/RemotePluginDetail";
import { RemotePluginDetailOverlay } from "./remotePlugin/RemotePluginDetailOverlay";
import {
  PluginSearchControls,
  RemotePluginCatalogRow,
  RemotePluginSearchActions,
} from "./remotePlugin/RemotePluginList";

export const RemotePluginPage = () => {
  const { LL, locale } = useI18nContext();
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pluginSearchQuery, setPluginSearchQuery] = useState("");
  const [selectedRemotePluginId, setSelectedRemotePluginId] = useState<
    string | null
  >(null);
  const [remoteLayoutWide, setRemoteLayoutWide] = useState(false);
  const [remoteDetailDialogOpen, setRemoteDetailDialogOpen] = useState(false);
  const {
    plugins,
    discoveryErrors,
    remotePlugins,
    remoteRegistryLoading,
    remoteRegistryError,
    remoteInstallStates,
    remoteInstallErrors,
    remoteManagementStates,
    remoteManagementMessage,
    loadRemoteRegistry,
    installRemotePlugin,
    setRemotePluginEnabled,
    uninstallRemotePlugin,
  } = useRemotePluginCatalog(LL);

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

  const normalizedPluginSearchQuery = pluginSearchQuery.trim().toLowerCase();
  const remotePluginViews = createRemotePluginViews(remotePlugins, plugins);
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
                      installRemotePlugin(selectedRemotePluginView.entry);
                    }}
                    onEnabledChange={setRemotePluginEnabled}
                    onUninstall={uninstallRemotePlugin}
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
              installRemotePlugin(selectedRemotePluginView.entry);
            }}
            onEnabledChange={setRemotePluginEnabled}
            onUninstall={uninstallRemotePlugin}
            onClose={() => {
              setRemoteDetailDialogOpen(false);
            }}
            panelRef={panelRef}
          />
        )}
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
