import "./styles/App.css";

import { useEffect, useRef, useState } from "react";

import { listen } from "@tauri-apps/api/event";
import { toast } from "@/utils/toast";

import { fileApi } from "@/api/file";
import { indexingApi } from "@/api/indexing";
import { previewApi } from "@/api/preview";
import { searchApi } from "@/api/search";
import { settingsApi } from "@/api/settings";
import { statsApi } from "@/api/stats";
import { themesApi } from "@/api/themes";

import { ItemList } from "@/components/ItemList";
import { PreviewPanelList } from "@/components/preview/PreviewPanelList";
import { SearchBar } from "@/components/SearchBar";
import { StatusBar } from "@/components/StatusBar";
import { Toaster } from "@/components/ui/sonner";

import { ShortcutProvider } from "@/contexts/ShortcutContext";

import {
  COMMAND_HISTORY_ITEM,
  DEBUG_ITEM,
  METADATA_HELP_ITEM,
  TAG_CLOUD_ITEM,
} from "@/features/internal/internalItems";
import {
  getPluginInternalItem,
  loadPlugins,
  setPluginLocale,
} from "@/features/plugins/registry";
import { useSearchController } from "@/features/search/useSearchController";
import { createAppShortcuts } from "@/features/shortcuts/createAppShortcuts";
import { openMarkdownLink } from "@/features/preview/markdownLinkNavigation";

import { useCustomThemeStyles } from "@/hooks/useCustomThemeStyles";
import { useDebouncedIndex } from "@/hooks/useDebouncedIndex";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { usePreviewTabs } from "@/hooks/usePreviewTabs";
import { useSettings } from "@/hooks/useSettings";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useTheme } from "@/hooks/useTheme";

import { I18nProvider } from "@/i18n/I18nProvider";
import { i18nObject, isLocale } from "@/i18n/i18n-util";

import { BUILT_IN_THEMES } from "@/constants/themes";
import { perf } from "@/utils/debugPerf";
import { parseGjsonEditorDocument } from "@/utils/gjsonEditor";
import { hasHelpContent } from "@/utils/helpContent";

import type {
  CommandHistoryEntry,
  CssTheme,
  SearchResult,
  SearchSnippet,
  StartupWarmStats,
} from "@/types";
import { LIVE_PREVIEW_TAB_ID } from "@/components/preview/constants";

const ENABLE_ANIMATIONS = true;
const PREVIEW_DEBOUNCE_MS = 50;
const PAGE_SIZE = 5;
const COMMAND_HISTORY_LIMIT = 50;

const titleFromPath = (filePath: string) => {
  const name = filePath.split(/[\\/]/).pop() ?? "";

  return name.includes(".") ? name.replace(/\.[^.]+$/, "") : name;
};

const extensionFromPath = (filePath: string) => {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  const match = /\.([^.]+)$/.exec(name);

  return match?.[1]?.toLowerCase() ?? "";
};

type PendingSnippetNavigation = {
  itemId: string;
  startByte: number;
  endByte: number;
};

type WindowFocusedPayload = {
  selectedText?: string | null;
};

const getHelpPageId = (item: SearchResult["item"] | null): string | null => {
  const preview = item?.preview;

  if (!preview || preview.type !== "internal") {
    return null;
  }

  const page = preview.page;

  if (!page) {
    return null;
  }

  return hasHelpContent(page) ? page : null;
};

export default function App() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [totalIndexedItems, setTotalIndexedItems] = useState<number | null>(
    null,
  );
  const [startupWarm, setStartupWarm] = useState<StartupWarmStats | null>(null);
  const [customThemes, setCustomThemes] = useState<CssTheme[]>([]);
  const [loadedPreview, setLoadedPreview] = useState<
    SearchResult["item"]["preview"] | null
  >(null);
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>(
    [],
  );
  const [pendingSnippetNavigation, setPendingSnippetNavigation] =
    useState<PendingSnippetNavigation | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const {
    layoutMode,
    showItemList,
    showPreview,
    togglePreviewLayout,
    toggleLauncherLayout,
  } = useLayoutMode("normal");

  const {
    themeId,
    setThemeId,
    compactListItems,
    setCompactListItems,
    keybindings,
    language,
    setLanguage,
    currentTargetGroupName,
    setCurrentTargetGroupName,
  } = useSettings();
  const appLocale = isLocale(language) ? language : "en";
  const LL = i18nObject(appLocale);
  const {
    query,
    setQuery,
    visibleSearchResults,
    isLoading,
    setIsLoading,
    fetchResults,
    handleQueryChange,
    selectTag,
    refreshResultsAfterSave,
    refreshTemporarySavedResults,
    getCurrentQuery,
  } = useSearchController({
    setSelectedIndex,
    setLoadedPreview,
    failedRefreshMessage: (error) =>
      LL.appMessages.failedRefreshSavedFile({ error }),
  });

  const focusSearchInput = () => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  localStorage.setItem("glimpse:debug:perf", "1");

  const refreshIndexStats = async () => {
    try {
      const stats = await statsApi.get();
      setTotalIndexedItems(stats.totalItems);
    } catch (error) {
      console.error("Failed to load index stats:", error);
    }
  };

  const refreshIndexingStatus = async () => {
    try {
      const indexing = await indexingApi.getStats();
      setStartupWarm(indexing.stats.startupWarm);
    } catch (error) {
      console.error("Failed to load indexing status:", error);
    }
  };

  useEffect(() => {
    void refreshIndexStats();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let startupPollsRemaining = 30;

    const poll = async () => {
      try {
        const indexing = await indexingApi.getStats();

        if (cancelled) {
          return;
        }

        const warm = indexing.stats.startupWarm;

        setStartupWarm(warm);

        if (warm.status === "running" || startupPollsRemaining > 0) {
          startupPollsRemaining -= 1;
          timer = window.setTimeout(poll, 1_000);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to poll indexing status:", error);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;

      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    void loadPlugins()
      .then(() => fetchResults(getCurrentQuery()))
      .catch((error) => {
        console.error("Failed to load plugins:", error);
      });
  }, []);

  useEffect(() => {
    setPluginLocale(language);
  }, [language]);

  const items = visibleSearchResults.map((result) => result.item);
  const hasResults = items.length > 0;

  const displayIndex = useDebouncedIndex(
    selectedIndex,
    PREVIEW_DEBOUNCE_MS,
    isLoading,
  );

  const baseItem = hasResults ? (items[displayIndex] ?? items[0]) : null;

  const item = baseItem
    ? {
        ...baseItem,
        preview: loadedPreview ?? baseItem.preview,
      }
    : null;

  useEffect(() => {
    if (!baseItem?.id) {
      setLoadedPreview(null);
      return;
    }

    setLoadedPreview(null);

    const timer = window.setTimeout(() => {
      void previewApi
        .getPreview(baseItem.id)
        .then((preview) => {
          if (preview) {
            setLoadedPreview(preview);
          }
        })
        .catch((error) => {
          console.error("Failed to load preview:", error);
        });
    }, 80);

    return () => {
      window.clearTimeout(timer);
    };
  }, [baseItem?.id]);

  const {
    tabs: previewTabs,
    activeTabId: activePreviewTabId,
    lastActivePinnedTabId,
    activePreviewItem,
    isFileEditorActive,
    setPreviewRef,
    activateLivePreview,
    activatePreviewTab,
    scrollActivePreviewDown,
    scrollActivePreviewUp,
    pinCurrentPreview,
    openPreviewTab,
    openFileCreatorTab,
    openFileEditorTab,
    openItemInspectorTab,
    openQueryInspectorTab,
    openHelpTab,
    updateFileEditorTab,
    closePreviewTab,
    switchNextPreviewTab,
    switchPrevPreviewTab,
    closeActivePreviewTab,
    getActivePreviewHandle,
  } = usePreviewTabs(item);

  useEffect(() => {
    if (!pendingSnippetNavigation || !item) {
      return;
    }

    if (item.id !== pendingSnippetNavigation.itemId) {
      return;
    }

    if (activePreviewTabId !== LIVE_PREVIEW_TAB_ID) {
      return;
    }

    if (item.preview.type !== "markdown" && item.preview.type !== "raw") {
      setPendingSnippetNavigation(null);
      return;
    }

    if (!loadedPreview && item.preview.content.length === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      getActivePreviewHandle()?.revealRange?.({
        startByte: pendingSnippetNavigation.startByte,
        endByte: pendingSnippetNavigation.endByte,
      });
      setPendingSnippetNavigation(null);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    activePreviewTabId,
    getActivePreviewHandle,
    item,
    loadedPreview,
    pendingSnippetNavigation,
  ]);

  const themeOptions = [
    ...BUILT_IN_THEMES,
    ...customThemes.map((theme) => ({
      id: theme.id,
      name: theme.name,
      source: "custom" as const,
    })),
  ];

  useTheme(themeId);
  useCustomThemeStyles(customThemes);

  const reloadCustomThemes = async () => {
    try {
      const themes = await themesApi.getCustomThemes();
      setCustomThemes(themes);
    } catch (error) {
      console.error("Failed to reload custom themes:", error);
      toast.error(LL.appMessages.failedReloadThemes());
    }
  };

  useEffect(() => {
    void reloadCustomThemes();
  }, []);

  const openFileCreator = () => {
    openFileCreatorTab();
  };

  const handleMarkdownLinkOpen = async (
    sourcePath: string | null | undefined,
    href: string,
  ) => {
    await openMarkdownLink({
      sourcePath,
      href,
      sourceFileNotFoundMessage: LL.markdownPreview.sourceFileNotFound(),
      resolveMarkdownLink: searchApi.resolveMarkdownLink,
      getPreview: previewApi.getPreview,
      openPreviewTab,
      openFileCreatorTab,
      toast,
    });
  };

  const openActiveFileEditor = async () => {
    const activeItem = activePreviewItem;

    if (!activeItem?.sourcePath) {
      toast.error(LL.previewPanel.noSourceFilePath());
      return;
    }

    try {
      const body = await fileApi.readTextFile(activeItem.sourcePath);
      const extension = extensionFromPath(activeItem.sourcePath);
      const initialTitle = titleFromPath(activeItem.sourcePath);

      if (extension === "gjson") {
        try {
          const gjsonDocument = parseGjsonEditorDocument(body);

          openFileEditorTab({
            filePath: activeItem.sourcePath,
            initialTitle,
            initialBody: body,
            extension: "gjson",
            extensionLabel: ".gjson",
            contentMode: "gjsonCards",
            initialGjsonDocument: gjsonDocument,
            gjsonDocument,
          });

          return;
        } catch (error) {
          openFileEditorTab({
            filePath: activeItem.sourcePath,
            initialTitle,
            initialBody: body,
            extension: "raw",
            extensionLabel: "raw (.gjson)",
            contentMode: "raw",
            gjsonParseError:
              error instanceof Error ? error.message : String(error),
          });

          return;
        }
      }

      openFileEditorTab({
        filePath: activeItem.sourcePath,
        initialTitle,
        initialBody: body,
        extension: extension === "md" ? "md" : "raw",
        extensionLabel:
          extension === "md"
            ? ".md"
            : extension
              ? `raw (.${extension})`
              : "raw",
        contentMode: extension === "md" ? "markdown" : "raw",
      });
    } catch (error) {
      toast.error(LL.appMessages.failedReadFile({ error: String(error) }));
    }
  };

  const openItemHelp = () => {
    const page = getHelpPageId(activePreviewItem);

    if (!page) {
      return;
    }

    openHelpTab(page);
  };

  const recordCommandHistory = (
    entry: Omit<CommandHistoryEntry, "id" | "createdAt">,
  ) => {
    setCommandHistory((previous) =>
      [
        {
          ...entry,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        },
        ...previous,
      ].slice(0, COMMAND_HISTORY_LIMIT),
    );
  };

  const switchTargetGroup = async () => {
    perf.begin("Ctrl+r total");

    try {
      perf.start("settingsApi.switchNextTargetGroup");

      const nextSettings = await settingsApi.switchNextTargetGroup();

      perf.stop("settingsApi.switchNextTargetGroup");

      const nextGroup = nextSettings.targetGroups.find(
        (group) => group.id === nextSettings.currentTargetGroupId,
      );

      if (!nextGroup) {
        toast.error(LL.appMessages.noTargetGroupsConfigured());
        return;
      }

      await fetchResults(query);
      await refreshIndexStats();
      await refreshIndexingStatus();

      perf.start("setCurrentTargetGroupName");
      setCurrentTargetGroupName(nextGroup.name);
      perf.stop("setCurrentTargetGroupName");

      toast.success(
        LL.appMessages.switchedTargetGroup({ name: nextGroup.name }),
      );
    } catch (error) {
      if (String(error).includes("no other active target groups")) {
        toast.error(LL.appMessages.noOtherActiveTargetGroups());
        return;
      }

      toast.error(
        LL.appMessages.switchTargetGroupFailed({ error: String(error) }),
      );
    } finally {
      perf.end();
    }
  };

  const shortcutHandlers = createAppShortcuts({
    LL,
    setSelectedIndex,
    itemCount: items.length,
    pageSize: PAGE_SIZE,
    inputRef,
    togglePreviewMode: () => {
      getActivePreviewHandle()?.togglePreviewMode?.();
    },
    togglePreviewLayout,
    toggleLauncherLayout,
    scrollActivePreviewDown,
    scrollActivePreviewUp,
    pinCurrentPreview,
    switchNextPreviewTab,
    switchPrevPreviewTab,
    closeActivePreviewTab,
    getActivePreviewHandle,
    getActiveItem: () => activePreviewItem,
    getQuery: () => query,
    setQuery,
    switchTargetGroup,
    openQueryInspector: () => {
      openQueryInspectorTab(query);
    },
    openItemHelp,
    openCommandHistory: () => {
      openPreviewTab(COMMAND_HISTORY_ITEM);
    },
    openDebugPage: () => {
      openPreviewTab(DEBUG_ITEM);
    },
    openTagCloudPage: () => {
      openPreviewTab(TAG_CLOUD_ITEM);
    },
    openPluginActionPage: (page) => {
      const pluginItem = getPluginInternalItem(page);

      if (!pluginItem) {
        toast.error(`Plugin action page not found: ${page}`);
        return;
      }

      openPreviewTab(pluginItem);
    },
    openItemInspector: openItemInspectorTab,
    openFileCreator,
    openActiveFileEditor,
    recordCommandHistory,
  });

  useShortcuts({
    bindings: keybindings,
    handlers: shortcutHandlers,
    disabled: false,
    disabledWhen: (event) =>
      isFileEditorActive && !event.ctrlKey && !event.altKey,
  });

  useEffect(() => {
    const preventAltSpaceTextInput = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.code === "Space" || event.key === " ")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("keydown", preventAltSpaceTextInput, {
      capture: true,
    });

    return () => {
      window.removeEventListener("keydown", preventAltSpaceTextInput, {
        capture: true,
      });
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<WindowFocusedPayload>("window-focused", (event) => {
      const selectedText = event.payload?.selectedText?.trim();
      const nextQuery = selectedText || getCurrentQuery();

      if (selectedText) {
        handleQueryChange(selectedText);
      }

      focusSearchInput();

      void indexingApi
        .cleanupMissingSourcePaths()
        .then((deletedCount) => {
          if (deletedCount > 0) {
            void fetchResults(nextQuery);
            void refreshIndexStats();
          }
        })
        .catch((error) => {
          console.error("Cleanup failed:", error);
        });
    });

    return () => {
      void unlisten.then((dispose) => {
        dispose();
      });
    };
  }, []);

  const handleTagCloudTagSelect = (tag: string) => {
    selectTag(tag);
    focusSearchInput();
  };

  const handleSnippetNavigation = (index: number, snippet: SearchSnippet) => {
    const chunk = snippet.chunk;
    const targetItem = visibleSearchResults[index]?.item;

    if (!chunk || !targetItem) {
      setSelectedIndex(index);
      activateLivePreview();
      return;
    }

    if (targetItem.id !== baseItem?.id) {
      setLoadedPreview(null);
    }

    setSelectedIndex(index);
    activateLivePreview();
    setPendingSnippetNavigation({
      itemId: targetItem.id,
      startByte: chunk.startByte,
      endByte: chunk.endByte,
    });
  };

  return (
    <I18nProvider locale={language}>
      <ShortcutProvider keybindings={keybindings}>
        <div className="flex h-screen flex-col overflow-hidden border border-border bg-app-bg font-sans text-text-main select-none">
          <SearchBar
            value={query}
            inputRef={inputRef}
            onChange={handleQueryChange}
            onFullScanCompleted={async () => {
              await fetchResults("");
              await refreshIndexStats();
              await refreshIndexingStatus();
            }}
          />

          <div className="flex flex-1 overflow-hidden">
            {showItemList && (
              <ItemList
                items={items}
                results={visibleSearchResults}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                onSnippetClick={handleSnippetNavigation}
                isEmpty={!hasResults}
                isLoading={isLoading}
                compact={compactListItems}
                layout={layoutMode === "launcher" ? "launcher" : "sidebar"}
              />
            )}

            {showPreview && (
              <PreviewPanelList
                tabs={previewTabs}
                activeTabId={activePreviewTabId}
                lastActivePinnedTabId={lastActivePinnedTabId}
                selectedIndex={selectedIndex}
                displayIndex={displayIndex}
                isLoading={isLoading}
                hasResults={hasResults}
                animation={ENABLE_ANIMATIONS}
                themeOptions={themeOptions}
                themeId={themeId}
                onThemeChange={setThemeId}
                onReloadThemes={reloadCustomThemes}
                compactListItems={compactListItems}
                onCompactListItemsChange={setCompactListItems}
                onLoad={() => {
                  setIsLoading(false);
                }}
                setPreviewRef={setPreviewRef}
                onActivateTab={activatePreviewTab}
                language={language}
                onLanguageChange={setLanguage}
                commandHistory={commandHistory}
                onInspectItem={openItemInspectorTab}
                onHelpItemPage={openHelpTab}
                onOpenCommandHistory={() => {
                  openPreviewTab(COMMAND_HISTORY_ITEM);
                }}
                onUrlAction={shortcutHandlers.openActiveUrlAction}
                onCommandAction={shortcutHandlers.openActiveCommandAction}
                onRefreshTemporaryItem={refreshTemporarySavedResults}
                onTagCloudTagSelect={handleTagCloudTagSelect}
                onOpenMarkdownLink={(sourcePath, href) => {
                  void handleMarkdownLinkOpen(sourcePath, href);
                }}
                onFileEditorChange={updateFileEditorTab}
                onFileEditorHelp={() => {
                  openPreviewTab(METADATA_HELP_ITEM);
                }}
                onCloseTab={closePreviewTab}
                onFileEditorSaved={(tabId, result) => {
                  updateFileEditorTab(tabId, {
                    mode: "edit",
                    filePath: result.filePath,
                    initialTitle: result.title,
                    initialBody: result.body,
                    initialGjsonDocument: result.gjsonDocument,
                    gjsonDocument: result.gjsonDocument,
                    title: result.title,
                    dirty: false,
                  });

                  void refreshResultsAfterSave(result);
                }}
              />
            )}
          </div>

          <StatusBar
            count={items.length}
            totalCount={totalIndexedItems}
            animation={ENABLE_ANIMATIONS}
            currentTargetGroupName={currentTargetGroupName}
            startupWarm={startupWarm}
          />

          <Toaster offset={{ bottom: 35, right: 5 }} position="bottom-right" />
        </div>
      </ShortcutProvider>
    </I18nProvider>
  );
}
