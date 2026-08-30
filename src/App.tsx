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
  searchInternalItems,
  TAG_CLOUD_ITEM,
} from "@/features/internal/internalItems";
import {
  getPluginInternalItem,
  loadPlugins,
  setPluginLocale,
  subscribeToPluginChanges,
} from "@/features/plugins/pluginRegistry";
import { parseSearchInput } from "@/features/search/parseSearchInput";
import { createAppShortcuts } from "@/features/shortcuts/createAppShortcuts";

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
import { parseMarkdownMetadata } from "@/utils/markdownMetadata";

import type {
  CommandHistoryEntry,
  CssTheme,
  GjsonCardItem,
  GjsonEditorDocument,
  IndexItem,
  SearchResult,
  SearchSnippet,
  StartupWarmStats,
} from "@/types";
import { LIVE_PREVIEW_TAB_ID } from "@/components/preview/constants";

const ENABLE_ANIMATIONS = true;
const PREVIEW_DEBOUNCE_MS = 50;
const PAGE_SIZE = 5;
const COMMAND_HISTORY_LIMIT = 50;

const isInternalSearchQuery = (query: string) => {
  const trimmed = query.trim();

  return trimmed.startsWith(":") || trimmed.startsWith("/");
};

const titleFromPath = (filePath: string) => {
  const name = filePath.split(/[\\/]/).pop() ?? "";

  return name.includes(".") ? name.replace(/\.[^.]+$/, "") : name;
};

const normalizeFilePath = (filePath: string) =>
  filePath.replace(/\\/g, "/").replace(/^\/\/\?\//, "");

const extensionFromPath = (filePath: string) => {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  const match = /\.([^.]+)$/.exec(name);

  return match?.[1]?.toLowerCase() ?? "";
};

const sourcePathMatches = (
  sourcePath: string | null | undefined,
  filePath: string,
) =>
  !!sourcePath && normalizeFilePath(sourcePath) === normalizeFilePath(filePath);

const includesSourcePath = (results: SearchResult[], filePath: string) => {
  return results.some((result) =>
    sourcePathMatches(result.item.sourcePath, filePath),
  );
};

const filterResultsBySourcePath = (results: SearchResult[], filePath: string) =>
  results.filter((result) =>
    sourcePathMatches(result.item.sourcePath, filePath),
  );

const filterResultsBySourcePaths = (
  results: SearchResult[],
  sourcePaths: string[],
) => {
  const normalizedPaths = new Set(sourcePaths.map(normalizeFilePath));

  return results.filter((result) => {
    const sourcePath = result.item.sourcePath;

    return !sourcePath || !normalizedPaths.has(normalizeFilePath(sourcePath));
  });
};

const normalizeHttpUrl = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);

    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};

const parseCommaList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeStringList = (items: string[]) =>
  Array.from(new Set(items)).sort();

type TemporarySavedResults = {
  query: string;
  filePath: string;
  excludedSourcePaths: string[];
  autoReplaceWhenIndexed: boolean;
  results: SearchResult[];
};

type PendingSnippetNavigation = {
  itemId: string;
  startByte: number;
  endByte: number;
};

type WindowFocusedPayload = {
  selectedText?: string | null;
};

const createTemporaryMarkdownResult = ({
  title,
  filePath,
  body,
  raw,
  metadata,
}: {
  title: string;
  filePath: string;
  body: string;
  raw: boolean;
  metadata?: {
    tags: string[];
    aliases: string[];
    star: boolean;
    hidden: boolean;
    url?: string | null;
    iframe: boolean;
    defaultAction?: "url" | null;
  };
}): SearchResult => {
  const now = new Date().toISOString();
  const url = metadata?.url ?? null;
  const item: IndexItem = {
    id: `temporary-saved:${normalizeFilePath(filePath)}`,
    title,
    sourcePath: filePath,
    updatedAt: now,
    metadata: {
      tags: metadata?.tags ?? [],
      aliases: metadata?.aliases ?? [],
      star: metadata?.star ?? false,
      hidden: metadata?.hidden || undefined,
      boost: 0,
    },
    preview:
      !raw && metadata?.iframe && url
        ? {
            type: "external",
            url,
          }
        : raw
          ? {
              type: "raw",
              content: body,
            }
          : {
              type: "markdown",
              content: body,
            },
    url,
    defaultAction: metadata?.defaultAction ?? null,
  };

  return {
    item,
    score: Number.MAX_SAFE_INTEGER,
  };
};

const previewContentForGjsonCard = (card: GjsonCardItem, url: string | null) =>
  [card.desc.trim(), url].filter(Boolean).join("\n\n");

const defaultActionForTemporaryGjsonCard = (
  card: GjsonCardItem,
  url: string | null,
) => {
  if (!url) return null;

  if (card.defaultAction === "url") return "url";

  return card.command.trim() ? null : "url";
};

const createTemporaryGjsonResults = ({
  filePath,
  document,
}: {
  filePath: string;
  document: GjsonEditorDocument;
}): SearchResult[] => {
  const now = new Date().toISOString();
  const sourceId = normalizeFilePath(filePath);

  return document.items
    .filter((card) => card.title.trim())
    .map((card, index) => {
      const url = normalizeHttpUrl(card.url);
      const previewContent = previewContentForGjsonCard(card, url);
      const defaultAction = defaultActionForTemporaryGjsonCard(card, url);
      const item: IndexItem = {
        id: `temporary-saved:${sourceId}::${index}:${card.id}`,
        title: card.title.trim(),
        sourcePath: filePath,
        updatedAt: now,
        metadata: {
          tags: normalizeStringList(parseCommaList(card.tags)),
          aliases: normalizeStringList(parseCommaList(card.aliases)),
          star: card.star,
          hidden: card.hidden || undefined,
          boost: 0,
        },
        preview:
          card.iframe && url
            ? {
                type: "external",
                url,
              }
            : {
                type: "markdown",
                content: previewContent,
              },
        url,
        defaultAction,
      };

      return {
        item,
        score: Number.MAX_SAFE_INTEGER - index,
      };
    });
};

const createTemporarySavedResults = ({
  title,
  filePath,
  body,
  contentMode,
  gjsonDocument,
}: {
  title: string;
  filePath: string;
  body: string;
  contentMode: "markdown" | "gjsonCards" | "raw";
  gjsonDocument?: GjsonEditorDocument;
}): SearchResult[] => {
  if (contentMode === "gjsonCards" && gjsonDocument) {
    return createTemporaryGjsonResults({
      filePath,
      document: gjsonDocument,
    });
  }

  const markdownMetadata =
    contentMode === "markdown" ? parseMarkdownMetadata(body) : null;
  const url = markdownMetadata?.url
    ? normalizeHttpUrl(markdownMetadata.url)
    : null;
  const defaultAction =
    url && markdownMetadata?.defaultAction === "url"
      ? "url"
      : url && !markdownMetadata?.command
        ? "url"
        : null;

  return [
    createTemporaryMarkdownResult({
      title: markdownMetadata?.title ?? title,
      filePath,
      body: markdownMetadata?.body ?? body,
      raw: contentMode === "raw",
      metadata: markdownMetadata
        ? {
            tags: markdownMetadata.tags,
            aliases: markdownMetadata.aliases,
            star: markdownMetadata.star,
            hidden: markdownMetadata.hidden,
            url,
            iframe: markdownMetadata.iframe,
            defaultAction,
          }
        : undefined,
    }),
  ];
};

const filterTemporaryResultsForQuery = (
  results: SearchResult[],
  query: string,
) => {
  const parsed = parseSearchInput(query);

  if (isInternalSearchQuery(parsed.query)) {
    return [];
  }

  const requiredTags = parsed.tags.map((tag) => tag.toLowerCase());

  return results.filter((result) => {
    if (!parsed.hidden && result.item.metadata.hidden) {
      return false;
    }

    if (parsed.unstar && result.item.metadata.star) {
      return false;
    }

    if (requiredTags.length === 0) {
      return true;
    }

    const resultTags = new Set(
      result.item.metadata.tags.map((tag) => tag.toLowerCase()),
    );

    return requiredTags.every((tag) => resultTags.has(tag));
  });
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

const addTagToSearchQuery = (currentQuery: string, tag: string) => {
  const normalizedTag = tag.trim();

  if (!normalizedTag) {
    return currentQuery;
  }

  const parsed = parseSearchInput(currentQuery);
  const tagToken = `#${normalizedTag}`;

  if (isInternalSearchQuery(parsed.query)) {
    return `${tagToken} `;
  }

  const searchPart = currentQuery.split(">")[0].trim();
  const existingTags = new Set(
    parseSearchInput(searchPart).tags.map((existingTag) =>
      existingTag.toLowerCase(),
    ),
  );

  if (existingTags.has(normalizedTag.toLowerCase())) {
    return searchPart ? `${searchPart} ` : "";
  }

  return `${[searchPart, tagToken].filter(Boolean).join(" ")} `;
};

export const sanitizeSqliteFtsQuery = (query: string) => {
  return query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export default function App() {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
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
  const [temporarySavedResults, setTemporarySavedResults] =
    useState<TemporarySavedResults | null>(null);
  const [pendingSnippetNavigation, setPendingSnippetNavigation] =
    useState<PendingSnippetNavigation | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const currentQueryRef = useRef(query);
  const previousSearchQueryRef = useRef("");

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

  const fetchResults = async (
    nextQuery = query,
    temporaryOverride?: TemporarySavedResults | null,
    options?: { forceTemporaryReplace?: boolean },
  ) => {
    perf.begin("fetchResults");

    try {
      setIsLoading(true);

      const parsed = parseSearchInput(nextQuery);
      const activeTemporaryResults =
        temporaryOverride === undefined
          ? temporarySavedResults
          : temporaryOverride;

      if (isInternalSearchQuery(parsed.query)) {
        const internalResults = searchInternalItems(parsed.query);

        if (activeTemporaryResults?.query === nextQuery) {
          setTemporarySavedResults(null);
        }

        perf.log("internal results", internalResults.length);
        setSearchResults(internalResults);

        return false;
      }

      const searchQuery = [
        sanitizeSqliteFtsQuery(parsed.query),
        ...parsed.tags.map((tag) => `#${tag}`),
      ]
        .filter(Boolean)
        .join(" ");

      perf.start("searchApi.getItems");

      const results = await searchApi.getItems({
        query: searchQuery,
        unstar: parsed.unstar,
        hidden: parsed.hidden,
        reverse: parsed.reverse,
      });

      const foundTemporarySource = Boolean(
        activeTemporaryResults?.query === nextQuery &&
        includesSourcePath(results, activeTemporaryResults.filePath),
      );
      const shouldReplaceTemporaryResults =
        foundTemporarySource &&
        (activeTemporaryResults?.autoReplaceWhenIndexed ||
          options?.forceTemporaryReplace);
      const replacementResults = activeTemporaryResults
        ? filterResultsBySourcePath(results, activeTemporaryResults.filePath)
        : [];
      const nextResults =
        activeTemporaryResults?.query === nextQuery
          ? shouldReplaceTemporaryResults
            ? [
                ...replacementResults,
                ...filterResultsBySourcePaths(
                  results,
                  activeTemporaryResults.excludedSourcePaths,
                ),
              ]
            : filterResultsBySourcePaths(
                results,
                activeTemporaryResults.excludedSourcePaths,
              )
          : results;

      if (shouldReplaceTemporaryResults) {
        setTemporarySavedResults(null);
      }

      perf.stop("searchApi.getItems");
      perf.log("search result count", nextResults.length);

      perf.start("setSearchResults");
      setSearchResults(nextResults);
      perf.stop("setSearchResults");

      return foundTemporarySource;
    } catch (error) {
      console.error("Search failed:", error);
      return false;
    } finally {
      setIsLoading(false);
      perf.end();
    }
  };

  useEffect(() => {
    void fetchResults();
  }, [query]);

  useEffect(() => {
    currentQueryRef.current = query;
  }, [query]);

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
    void loadPlugins().catch((error) => {
      console.error("Failed to load plugins:", error);
    });
  }, []);

  useEffect(() => {
    setPluginLocale(language);
  }, [language]);

  useEffect(() => {
    return subscribeToPluginChanges(() => {
      const parsed = parseSearchInput(query);

      if (isInternalSearchQuery(parsed.query)) {
        void fetchResults(query);
      }
    });
  }, [query]);

  const activeTemporarySavedResults =
    temporarySavedResults?.query === query ? temporarySavedResults : null;
  const visibleBaseSearchResults = activeTemporarySavedResults
    ? filterResultsBySourcePaths(
        searchResults,
        activeTemporarySavedResults.excludedSourcePaths,
      )
    : searchResults;
  const shouldShowTemporarySavedResults =
    activeTemporarySavedResults !== null &&
    activeTemporarySavedResults.results.length > 0 &&
    !includesSourcePath(searchResults, activeTemporarySavedResults.filePath);

  const visibleSearchResults = shouldShowTemporarySavedResults
    ? [...activeTemporarySavedResults.results, ...visibleBaseSearchResults]
    : visibleBaseSearchResults;

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
    activePreviewItem,
    isFileEditorActive,
    setPreviewRef,
    activateLivePreview,
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

  const refreshResultsAfterSave = async ({
    title,
    filePath,
    previousFilePath,
    body,
    contentMode,
    gjsonDocument,
  }: {
    title: string;
    filePath: string;
    previousFilePath?: string;
    body: string;
    contentMode: "markdown" | "gjsonCards" | "raw";
    gjsonDocument?: GjsonEditorDocument;
  }) => {
    try {
      const activeQuery = currentQueryRef.current;
      const excludedSourcePaths = [previousFilePath, filePath].filter(
        (path): path is string => Boolean(path),
      );
      const temporaryResults = filterTemporaryResultsForQuery(
        createTemporarySavedResults({
          title,
          filePath,
          body,
          contentMode,
          gjsonDocument,
        }),
        activeQuery,
      );
      const nextTemporaryResults: TemporarySavedResults = {
        query: activeQuery,
        filePath,
        excludedSourcePaths,
        autoReplaceWhenIndexed:
          !previousFilePath ||
          normalizeFilePath(previousFilePath) !== normalizeFilePath(filePath),
        results: temporaryResults,
      };

      setTemporarySavedResults(nextTemporaryResults);
      setSearchResults((current) =>
        filterResultsBySourcePaths(current, excludedSourcePaths),
      );
      setSelectedIndex(0);
      setLoadedPreview(null);
      await fetchResults(activeQuery, nextTemporaryResults);
    } catch (error) {
      toast.error(
        LL.appMessages.failedRefreshSavedFile({ error: String(error) }),
      );
    }
  };

  const refreshTemporarySavedResults = () => {
    const activeQuery = currentQueryRef.current;
    const activeTemporaryResults =
      temporarySavedResults?.query === activeQuery
        ? temporarySavedResults
        : null;

    if (!activeTemporaryResults) {
      return;
    }

    void searchApi
      .getItemsBySourcePath(activeTemporaryResults.filePath)
      .then((sourceResults) => {
        if (sourceResults.length === 0) {
          return;
        }

        const replacementResults = filterTemporaryResultsForQuery(
          sourceResults,
          activeQuery,
        );

        setTemporarySavedResults(null);
        setSearchResults((current) => [
          ...replacementResults,
          ...filterResultsBySourcePaths(
            current,
            activeTemporaryResults.excludedSourcePaths,
          ),
        ]);
        setSelectedIndex(0);
        setLoadedPreview(null);
      })
      .catch((error) => {
        toast.error(
          LL.appMessages.failedRefreshSavedFile({ error: String(error) }),
        );
      });
  };

  const openFileCreator = () => {
    openFileCreatorTab();
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

  const handleQueryChange = (value: string) => {
    setTemporarySavedResults(null);

    const previousParsed = parseSearchInput(previousSearchQueryRef.current);
    const nextParsed = parseSearchInput(value);

    if (
      previousParsed.query !== nextParsed.query ||
      previousParsed.unstar !== nextParsed.unstar ||
      previousParsed.hidden !== nextParsed.hidden ||
      previousParsed.tags.join("\0") !== nextParsed.tags.join("\0")
    ) {
      setSelectedIndex(0);
    }

    previousSearchQueryRef.current = value;
    currentQueryRef.current = value;
    setQuery(value);
  };

  useEffect(() => {
    const unlisten = listen<WindowFocusedPayload>("window-focused", (event) => {
      const selectedText = event.payload?.selectedText?.trim();
      const nextQuery = selectedText || currentQueryRef.current;

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
    const nextQuery = addTagToSearchQuery(query, tag);

    setTemporarySavedResults(null);
    previousSearchQueryRef.current = nextQuery;
    currentQueryRef.current = nextQuery;
    setSelectedIndex(0);
    setQuery(nextQuery);
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
