import { describe, expect, it, vi } from "vitest";

import type { IndexItem, IndexMetadata } from "@/types";

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

vi.mock("@/features/plugins/pluginRegistry", () => ({
  getPluginInternalItems: () => [
    item("internal://plugin:test-plugin", "Test Plugin"),
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
  getPluginPlaygroundInternalItems: () => [
    item("internal://plugin:playground-plugin", "Playground Plugin"),
  ],
  getPluginActionItems: () => [
    item("plugin-action://test-plugin/sayHello", "Say Hello"),
  ],
}));

describe("internalItems", () => {
  it("keeps plugin actions out of the Internal item list", async () => {
    const { searchInternalItems } = await import("./internalItems");

    expect(searchInternalItems(":").map((result) => result.item.title)).toContain(
      "Test Plugin",
    );
    expect(
      searchInternalItems(":").map((result) => result.item.title),
    ).not.toContain("Say Hello");
  });

  it("keeps slash search scoped to plugin playground pages", async () => {
    const { searchInternalItems } = await import("./internalItems");

    expect(searchInternalItems("/").map((result) => result.item.title)).toEqual([
      "Playground Plugin",
    ]);
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
