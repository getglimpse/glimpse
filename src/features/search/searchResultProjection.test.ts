import { describe, expect, it } from "vitest";

import type { SearchResult } from "@/types";

import {
  addTagToSearchQuery,
  createTemporarySavedResults,
  filterResultsBySourcePaths,
  filterTemporaryResultsForQuery,
  normalizeFilePath,
  reconcileFetchedSearchResults,
  sanitizeSqliteFtsQuery,
  selectVisibleSearchResults,
  type TemporarySavedResults,
} from "./searchResultProjection";

const result = (
  id: string,
  sourcePath: string | null,
  options: { tags?: string[]; star?: boolean; hidden?: boolean } = {},
): SearchResult => ({
  item: {
    id,
    title: id,
    sourcePath,
    updatedAt: "2026-09-18T00:00:00.000Z",
    metadata: {
      tags: options.tags ?? [],
      aliases: [],
      star: options.star ?? false,
      hidden: options.hidden,
      boost: 0,
    },
    preview: { type: "markdown", content: id },
  },
  score: 1,
});

const temporaryState = (
  results: SearchResult[],
  overrides: Partial<TemporarySavedResults> = {},
): TemporarySavedResults => ({
  query: "notes",
  filePath: "C:\\notes\\saved.md",
  excludedSourcePaths: ["C:\\notes\\old.md", "C:\\notes\\saved.md"],
  autoReplaceWhenIndexed: true,
  results,
  ...overrides,
});

describe("searchResultProjection", () => {
  it("normalizes Windows paths before excluding source results", () => {
    const kept = result("kept", "C:\\notes\\kept.md");
    const excluded = result("excluded", "C:/notes/saved.md");

    expect(normalizeFilePath("\\\\?\\C:\\notes\\saved.md")).toBe(
      "C:/notes/saved.md",
    );
    expect(
      filterResultsBySourcePaths([excluded, kept], ["C:\\notes\\saved.md"]),
    ).toEqual([kept]);
  });

  it("builds a temporary Markdown result from frontmatter", () => {
    const [temporary] = createTemporarySavedResults({
      title: "Fallback",
      filePath: "C:\\notes\\saved.md",
      contentMode: "markdown",
      body: `---
title: Saved note
tags: [rust, tauri]
star: true
url: https://example.com/docs
iframe: true
---

Body`,
    });

    expect(temporary.item).toMatchObject({
      title: "Saved note",
      sourcePath: "C:\\notes\\saved.md",
      metadata: { tags: ["rust", "tauri"], star: true },
      preview: { type: "external", url: "https://example.com/docs" },
      defaultAction: "url",
    });
  });

  it("filters temporary results with hidden, unstar, tag, and internal queries", () => {
    const visible = result("visible", "visible.md", { tags: ["Rust"] });
    const hidden = result("hidden", "hidden.md", {
      tags: ["Rust"],
      hidden: true,
    });
    const starred = result("starred", "starred.md", {
      tags: ["Rust"],
      star: true,
    });

    expect(
      filterTemporaryResultsForQuery([visible, hidden, starred], "#rust"),
    ).toEqual([visible, starred]);
    expect(
      filterTemporaryResultsForQuery([visible, hidden, starred], "!#rust"),
    ).toEqual([visible, hidden, starred]);
    expect(
      filterTemporaryResultsForQuery([visible, hidden, starred], "*#rust"),
    ).toEqual([visible]);
    expect(filterTemporaryResultsForQuery([visible], ":settings")).toEqual([]);
  });

  it("keeps temporary results until the saved source is indexed", () => {
    const temporary = result("temporary", "C:\\notes\\saved.md");
    const existing = result("existing", "C:\\notes\\other.md");
    const state = temporaryState([temporary]);

    expect(selectVisibleSearchResults([existing], state, "notes")).toEqual([
      temporary,
      existing,
    ]);
  });

  it("replaces temporary results with all indexed items from the saved source", () => {
    const savedA = result("saved-a", "C:/notes/saved.md");
    const savedB = result("saved-b", "C:/notes/saved.md");
    const old = result("old", "C:/notes/old.md");
    const other = result("other", "C:/notes/other.md");
    const reconciliation = reconcileFetchedSearchResults({
      results: [savedA, savedB, old, other],
      temporaryResults: temporaryState([
        result("temporary", "C:\\notes\\saved.md"),
      ]),
      query: "notes",
    });

    expect(reconciliation).toMatchObject({
      foundTemporarySource: true,
      shouldReplaceTemporaryResults: true,
      nextResults: [savedA, savedB, other],
    });
  });

  it("normalizes tag insertion and SQLite FTS input", () => {
    expect(addTagToSearchQuery("hello #Rust > run", "rust")).toBe(
      "hello #Rust ",
    );
    expect(addTagToSearchQuery(":settings", "config")).toBe("#config ");
    expect(sanitizeSqliteFtsQuery('hello "世界" OR test*')).toBe(
      "hello 世界 OR test",
    );
  });
});
