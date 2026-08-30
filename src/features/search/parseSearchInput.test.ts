import { describe, expect, it } from "vitest";

import { parseSearchInput } from "./parseSearchInput";

describe("parseSearchInput", () => {
  it("treats a leading star as a local-search compatibility prefix", () => {
    expect(parseSearchInput("*rust")).toMatchObject({
      query: "rust",
      unstar: true,
      hidden: false,
      reverse: false,
    });
  });

  it("keeps hidden search local when a leading star is present", () => {
    expect(parseSearchInput("*!rust")).toMatchObject({
      query: "rust",
      unstar: true,
      hidden: true,
      reverse: false,
    });
  });

  it("treats a lone star as an unstar filter for an empty query", () => {
    expect(parseSearchInput("*")).toMatchObject({
      query: "",
      unstar: true,
      hidden: false,
      reverse: false,
    });
  });

  it("treats a leading caret as reverse ordering", () => {
    expect(parseSearchInput("^rust")).toMatchObject({
      query: "rust",
      unstar: false,
      hidden: false,
      reverse: true,
    });
  });

  it("treats a lone caret as reverse ordering for an empty query", () => {
    expect(parseSearchInput("^")).toMatchObject({
      query: "",
      unstar: false,
      hidden: false,
      reverse: true,
    });
  });

  it("supports reverse ordering with hidden search", () => {
    expect(parseSearchInput("!^rust")).toMatchObject({
      query: "rust",
      unstar: false,
      hidden: true,
      reverse: true,
    });
  });

  it("keeps internal search prefixes after reverse ordering", () => {
    expect(parseSearchInput("^:settings")).toMatchObject({
      query: ":settings",
      unstar: false,
      hidden: false,
      reverse: true,
    });
  });
});
