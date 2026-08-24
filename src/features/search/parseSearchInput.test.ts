import { describe, expect, it } from "vitest";

import { parseSearchInput } from "./parseSearchInput";

describe("parseSearchInput", () => {
  it("treats a leading star as a local-search compatibility prefix", () => {
    expect(parseSearchInput("*rust")).toMatchObject({
      query: "rust",
      hidden: false,
    });
  });

  it("keeps hidden search local when a leading star is present", () => {
    expect(parseSearchInput("*!rust")).toMatchObject({
      query: "rust",
      hidden: true,
    });
  });
});
