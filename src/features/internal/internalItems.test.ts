import { describe, expect, it, vi } from "vitest";

import type { IndexItem } from "@/types";

const item = (id: string, title: string): IndexItem => ({
  id,
  title,
  sourcePath: null,
  updatedAt: new Date(0).toISOString(),
  metadata: {
    tags: ["internal", "plugin"],
    aliases: [],
    star: false,
    boost: 1,
  },
  preview: {
    type: "internal",
    page: "plugin:test-plugin",
  },
});

vi.mock("@/features/plugins/pluginRegistry", () => ({
  getPluginInternalItems: () => [
    item("internal://plugin:test-plugin", "Test Plugin"),
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
});
