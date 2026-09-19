import { parseMarkdownMetadata } from "@/utils/markdownMetadata";
import type {
  GjsonCardItem,
  GjsonEditorDocument,
  IndexItem,
  SearchResult,
} from "@/types";

import { parseSearchInput } from "./parseSearchInput";

export type TemporarySavedResults = {
  query: string;
  filePath: string;
  excludedSourcePaths: string[];
  autoReplaceWhenIndexed: boolean;
  results: SearchResult[];
};

export const isInternalSearchQuery = (query: string) => {
  const trimmed = query.trim();

  return trimmed.startsWith(":") || trimmed.startsWith("/");
};

export const normalizeFilePath = (filePath: string) =>
  filePath.replace(/\\/g, "/").replace(/^\/\/\?\//, "");

const sourcePathMatches = (
  sourcePath: string | null | undefined,
  filePath: string,
) =>
  !!sourcePath && normalizeFilePath(sourcePath) === normalizeFilePath(filePath);

export const includesSourcePath = (results: SearchResult[], filePath: string) =>
  results.some((result) => sourcePathMatches(result.item.sourcePath, filePath));

const filterResultsBySourcePath = (results: SearchResult[], filePath: string) =>
  results.filter((result) =>
    sourcePathMatches(result.item.sourcePath, filePath),
  );

export const filterResultsBySourcePaths = (
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
  const url = metadata?.url ? normalizeHttpUrl(metadata.url) : null;
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
        ? { type: "external", url }
        : raw
          ? { type: "raw", content: body }
          : { type: "markdown", content: body },
    url,
    defaultAction: metadata?.defaultAction ?? null,
  };

  return { item, score: Number.MAX_SAFE_INTEGER };
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
            ? { type: "external", url }
            : {
                type: "markdown",
                content: previewContentForGjsonCard(card, url),
              },
        url,
        defaultAction: defaultActionForTemporaryGjsonCard(card, url),
      };

      return { item, score: Number.MAX_SAFE_INTEGER - index };
    });
};

export const createTemporarySavedResults = ({
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
    return createTemporaryGjsonResults({ filePath, document: gjsonDocument });
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

export const filterTemporaryResultsForQuery = (
  results: SearchResult[],
  query: string,
) => {
  const parsed = parseSearchInput(query);

  if (isInternalSearchQuery(parsed.query)) return [];

  const requiredTags = parsed.tags.map((tag) => tag.toLowerCase());

  return results.filter((result) => {
    if (!parsed.hidden && result.item.metadata.hidden) return false;
    if (parsed.unstar && result.item.metadata.star) return false;
    if (requiredTags.length === 0) return true;

    const resultTags = new Set(
      result.item.metadata.tags.map((tag) => tag.toLowerCase()),
    );

    return requiredTags.every((tag) => resultTags.has(tag));
  });
};

export const reconcileFetchedSearchResults = ({
  results,
  temporaryResults,
  query,
  forceTemporaryReplace = false,
}: {
  results: SearchResult[];
  temporaryResults: TemporarySavedResults | null;
  query: string;
  forceTemporaryReplace?: boolean;
}) => {
  const foundTemporarySource = Boolean(
    temporaryResults?.query === query &&
    includesSourcePath(results, temporaryResults.filePath),
  );
  const shouldReplaceTemporaryResults = Boolean(
    foundTemporarySource &&
    (temporaryResults?.autoReplaceWhenIndexed || forceTemporaryReplace),
  );
  const replacementResults = temporaryResults
    ? filterResultsBySourcePath(results, temporaryResults.filePath)
    : [];
  const nextResults =
    temporaryResults?.query === query
      ? shouldReplaceTemporaryResults
        ? [
            ...replacementResults,
            ...filterResultsBySourcePaths(
              results,
              temporaryResults.excludedSourcePaths,
            ),
          ]
        : filterResultsBySourcePaths(
            results,
            temporaryResults.excludedSourcePaths,
          )
      : results;

  return { foundTemporarySource, shouldReplaceTemporaryResults, nextResults };
};

export const selectVisibleSearchResults = (
  searchResults: SearchResult[],
  temporaryResults: TemporarySavedResults | null,
  query: string,
) => {
  const activeTemporaryResults =
    temporaryResults?.query === query ? temporaryResults : null;
  const visibleBaseResults = activeTemporaryResults
    ? filterResultsBySourcePaths(
        searchResults,
        activeTemporaryResults.excludedSourcePaths,
      )
    : searchResults;
  const shouldShowTemporaryResults =
    activeTemporaryResults !== null &&
    activeTemporaryResults.results.length > 0 &&
    !includesSourcePath(searchResults, activeTemporaryResults.filePath);

  return shouldShowTemporaryResults
    ? [...activeTemporaryResults.results, ...visibleBaseResults]
    : visibleBaseResults;
};

export const addTagToSearchQuery = (currentQuery: string, tag: string) => {
  const normalizedTag = tag.trim();

  if (!normalizedTag) return currentQuery;

  const parsed = parseSearchInput(currentQuery);
  const tagToken = `#${normalizedTag}`;

  if (parsed.query.trimStart().startsWith(":")) return `${tagToken} `;

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

export const sanitizeSqliteFtsQuery = (query: string) =>
  query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
