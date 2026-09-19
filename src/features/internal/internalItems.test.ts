import { describe, expect, it, vi } from "vitest";

import type { IndexItem, IndexMetadata } from "@/types";
import { parseSearchInput } from "@/features/search/parseSearchInput";

const item = (
  id: string,
  title: string,
  metadata?: Partial<IndexMetadata>,
): IndexItem => ({
  id,
  title,
  sourcePath: null,
  updatedAt: new Date(0).toISOString(),
  metadata: {
    tags: ["internal", "plugin"],
    aliases: [],
    star: false,
    boost: 1,
    ...metadata,
  },
  preview: {
    type: "internal",
    page: "plugin:test-plugin",
  },
});

vi.mock("@/features/plugins/registry", () => ({
  getPluginInternalItems: () => [
    item("internal://plugin:tool-plugin", "Tool Plugin", {
      tags: ["internal", "plugin", "tool"],
    }),
    item("internal://plugin:converter-plugin", "Converter Plugin", {
      tags: ["internal", "plugin", "converter", "file"],
    }),
    item("internal://plugin:viewer-plugin", "Viewer Plugin", {
      tags: ["internal", "plugin", "viewer", "file"],
    }),
    item("internal://plugin:title-match", "Needle Title", {
      tags: ["internal"],
    }),
    item("internal://plugin:alias-match", "Alias Match", {
      tags: ["internal"],
      aliases: ["needle alias"],
    }),
    item("internal://plugin:tag-match", "Tag Match", {
      tags: ["internal", "needle"],
    }),
  ],
  getPluginActionItems: () => [
    item("plugin-action://test-plugin/sayHello", "Say Hello"),
  ],
}));

describe("internalItems", () => {
  it("keeps plugin actions out of the Internal item list", async () => {
    const { searchInternalItems } = await import("./internalItems");

    expect(
      searchInternalItems(":").map((result) => result.item.title),
    ).toContain("Tool Plugin");
    expect(
      searchInternalItems(":").map((result) => result.item.title),
    ).not.toContain("Say Hello");
  });

  it("keeps slash search scoped to all plugin pages", async () => {
    const { searchInternalItems } = await import("./internalItems");

    expect(searchInternalItems("/").map((result) => result.item.title)).toEqual(
      [
        "Tool Plugin",
        "Converter Plugin",
        "Viewer Plugin",
        "Needle Title",
        "Alias Match",
        "Tag Match",
      ],
    );
  });

  it("keeps plugin results visible for an empty tag token", async () => {
    const { searchInternalItems } = await import("./internalItems");
    const parsed = parseSearchInput("/ #");

    expect(
      searchInternalItems(parsed.query, parsed.tags).map(
        (result) => result.item.title,
      ),
    ).toHaveLength(6);
  });

  it("filters plugin pages by case-insensitive tag prefixes", async () => {
    const { searchInternalItems } = await import("./internalItems");

    expect(
      searchInternalItems("/", ["CONVERTER"]).map(
        (result) => result.item.title,
      ),
    ).toEqual(["Converter Plugin"]);
    expect(
      searchInternalItems("/plugin", ["VIEW", "fi"]).map(
        (result) => result.item.title,
      ),
    ).toEqual(["Viewer Plugin"]);
    expect(
      searchInternalItems("/", ["con"]).map((result) => result.item.title),
    ).toEqual(["Converter Plugin"]);
    expect(searchInternalItems("/", ["missing"])).toEqual([]);
  });

  it("ranks internal results by title, aliases, then tags", async () => {
    const { searchInternalItems } = await import("./internalItems");

    expect(
      searchInternalItems(":needle").map((result) => ({
        title: result.item.title,
        score: result.score,
      })),
    ).toEqual([
      { title: "Needle Title", score: 3 },
      { title: "Alias Match", score: 2 },
      { title: "Tag Match", score: 1 },
    ]);
  });
});
