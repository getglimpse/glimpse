import { describe, expect, it } from "vitest";

import {
  buildSearchInputFromDisplay,
  commitActiveTag,
  completeActiveTag,
  getSearchBarViewModel,
  getTagCompletion,
  removeCommittedTagAt,
} from "./searchBarViewModel";

describe("searchBarViewModel", () => {
  it("keeps an unfinished tag in the input until it is followed by space", () => {
    expect(getSearchBarViewModel("#rust")).toEqual({
      displayValue: "#rust",
      committedTags: [],
    });
  });

  it("shows a tag followed by space as a committed badge", () => {
    expect(getSearchBarViewModel("#rust ")).toEqual({
      displayValue: "",
      committedTags: ["rust"],
    });
  });

  it("keeps non-tag query text editable after committed tags", () => {
    expect(getSearchBarViewModel("cargo #rust async")).toEqual({
      displayValue: "cargo async",
      committedTags: ["rust"],
    });
  });

  it("preserves committed tags when the visible input changes", () => {
    expect(buildSearchInputFromDisplay("#rust ", "cargo")).toBe("#rust cargo");
  });

  it("keeps command arguments after visible query text", () => {
    expect(buildSearchInputFromDisplay("#rust ", "cargo > run")).toBe(
      "#rust cargo > run",
    );
  });

  it("supports hidden search prefixes with committed tags", () => {
    expect(getSearchBarViewModel("!#rust ")).toEqual({
      displayValue: "!",
      committedTags: ["rust"],
    });

    expect(buildSearchInputFromDisplay("!#rust ", "!cargo")).toBe(
      "!#rust cargo",
    );
  });

  it("removes a committed tag without disturbing the query", () => {
    expect(removeCommittedTagAt("#rust #tauri cargo", 0)).toBe("#tauri cargo");
  });

  it("suggests an existing tag while typing a hash token", () => {
    expect(
      getTagCompletion({
        displayValue: "cargo #ru",
        committedTags: [],
        availableTags: ["react", "rust"],
      }),
    ).toEqual({
      tag: "rust",
      suffix: "st",
    });
  });

  it("does not suggest already committed tags", () => {
    expect(
      getTagCompletion({
        displayValue: "#ru",
        committedTags: ["rust"],
        availableTags: ["rust"],
      }),
    ).toBeNull();
  });

  it("completes the active tag and leaves it ready to become a badge", () => {
    expect(completeActiveTag("cargo #ru", "rust")).toBe("cargo #rust ");
  });

  it("commits an active tag without a completion suggestion", () => {
    expect(commitActiveTag("#rust")).toBe("#rust ");
    expect(getSearchBarViewModel(commitActiveTag("#rust") ?? "")).toEqual({
      displayValue: "",
      committedTags: ["rust"],
    });
  });
});
