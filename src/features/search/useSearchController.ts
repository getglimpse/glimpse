import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { searchApi } from "@/api/search";
import { searchInternalItems } from "@/features/internal/internalItems";
import { subscribeToPluginChanges } from "@/features/plugins/registry";
import type { GjsonEditorDocument, Preview, SearchResult } from "@/types";
import { perf } from "@/utils/debugPerf";
import { toast } from "@/utils/toast";

import { parseSearchInput } from "./parseSearchInput";
import {
  addTagToSearchQuery,
  createTemporarySavedResults,
  filterResultsBySourcePaths,
  filterTemporaryResultsForQuery,
  isInternalSearchQuery,
  normalizeFilePath,
  reconcileFetchedSearchResults,
  sanitizeSqliteFtsQuery,
  selectVisibleSearchResults,
  type TemporarySavedResults,
} from "./searchResultProjection";

type UseSearchControllerOptions = {
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  setLoadedPreview: Dispatch<SetStateAction<Preview | null>>;
  failedRefreshMessage: (error: string) => string;
};

export type SavedFileResult = {
  title: string;
  filePath: string;
  previousFilePath?: string;
  body: string;
  contentMode: "markdown" | "gjsonCards" | "raw";
  gjsonDocument?: GjsonEditorDocument;
};

export const useSearchController = ({
  setSelectedIndex,
  setLoadedPreview,
  failedRefreshMessage,
}: UseSearchControllerOptions) => {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [temporarySavedResults, setTemporarySavedResults] =
    useState<TemporarySavedResults | null>(null);
  const currentQueryRef = useRef(query);
  const previousSearchQueryRef = useRef("");

  const fetchResults = useCallback(
    async (
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
        const reconciliation = reconcileFetchedSearchResults({
          results,
          temporaryResults: activeTemporaryResults,
          query: nextQuery,
          forceTemporaryReplace: options?.forceTemporaryReplace,
        });

        if (reconciliation.shouldReplaceTemporaryResults) {
          setTemporarySavedResults(null);
        }

        perf.stop("searchApi.getItems");
        perf.log("search result count", reconciliation.nextResults.length);
        perf.start("setSearchResults");
        setSearchResults(reconciliation.nextResults);
        perf.stop("setSearchResults");

        return reconciliation.foundTemporarySource;
      } catch (error) {
        console.error("Search failed:", error);
        return false;
      } finally {
        setIsLoading(false);
        perf.end();
      }
    },
    [query, temporarySavedResults],
  );

  useEffect(() => {
    void fetchResults();
  }, [query]);

  useEffect(() => {
    currentQueryRef.current = query;
  }, [query]);

  useEffect(
    () =>
      subscribeToPluginChanges(() => {
        const parsed = parseSearchInput(query);

        if (isInternalSearchQuery(parsed.query)) void fetchResults(query);
      }),
    [query, fetchResults],
  );

  const handleQueryChange = useCallback(
    (value: string) => {
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
    },
    [setSelectedIndex],
  );

  const selectTag = useCallback(
    (tag: string) => {
      const nextQuery = addTagToSearchQuery(query, tag);

      setTemporarySavedResults(null);
      previousSearchQueryRef.current = nextQuery;
      currentQueryRef.current = nextQuery;
      setSelectedIndex(0);
      setQuery(nextQuery);

      return nextQuery;
    },
    [query, setSelectedIndex],
  );

  const refreshResultsAfterSave = useCallback(
    async ({
      title,
      filePath,
      previousFilePath,
      body,
      contentMode,
      gjsonDocument,
    }: SavedFileResult) => {
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
        toast.error(failedRefreshMessage(String(error)));
      }
    },
    [failedRefreshMessage, fetchResults, setLoadedPreview, setSelectedIndex],
  );

  const refreshTemporarySavedResults = useCallback(() => {
    const activeQuery = currentQueryRef.current;
    const activeTemporaryResults =
      temporarySavedResults?.query === activeQuery
        ? temporarySavedResults
        : null;

    if (!activeTemporaryResults) return;

    void searchApi
      .getItemsBySourcePath(activeTemporaryResults.filePath)
      .then((sourceResults) => {
        if (sourceResults.length === 0) return;

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
        toast.error(failedRefreshMessage(String(error)));
      });
  }, [
    failedRefreshMessage,
    setLoadedPreview,
    setSelectedIndex,
    temporarySavedResults,
  ]);

  return {
    query,
    setQuery,
    visibleSearchResults: selectVisibleSearchResults(
      searchResults,
      temporarySavedResults,
      query,
    ),
    isLoading,
    setIsLoading,
    fetchResults,
    handleQueryChange,
    selectTag,
    refreshResultsAfterSave,
    refreshTemporarySavedResults,
    getCurrentQuery: () => currentQueryRef.current,
  };
};
