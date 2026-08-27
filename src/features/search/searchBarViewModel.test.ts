import { describe, expect, it } from "vitest";

import {
  buildSearchInputFromDisplay,
  commitActiveTag,
  completeActiveTag,
  getSearchBarViewModel,
  getTagCompletion,
  removeCommittedTagAt,
  removeHiddenFilter,
  sortTagSuggestions,
} from "./searchBarViewModel";

describe("searchBarViewModel", () => {
  it("keeps an unfinished tag in the input until it is followed by space", () => {
    expect(getSearchBarViewModel("#rust")).toEqual({
      displayValue: "#rust",
      committedTags: [],
      hidden: false,
    });
  });

  it("shows a tag followed by space as a committed badge", () => {
    expect(getSearchBarViewModel("#rust ")).toEqual({
      displayValue: "",
      committedTags: ["rust"],
      hidden: false,
    });
  });

  it("keeps non-tag query text editable after committed tags", () => {
    expect(getSearchBarViewModel("cargo #rust async")).toEqual({
      displayValue: "cargo async",
      committedTags: ["rust"],
      hidden: false,
    });
  });

  it("keeps trailing spaces in regular query text after committed tags", () => {
    expect(getSearchBarViewModel("#tag aaa ")).toEqual({
      displayValue: "aaa ",
      committedTags: ["tag"],
      hidden: false,
    });

    expect(buildSearchInputFromDisplay("#tag aaa", "aaa ")).toBe("#tag aaa ");
  });

  it("preserves committed tags when the visible input changes", () => {
    expect(buildSearchInputFromDisplay("#rust ", "cargo")).toBe("#rust cargo");
  });

  it("keeps committed tags badged when visible input is cleared", () => {
    expect(buildSearchInputFromDisplay("#rust cargo", "")).toBe("#rust ");
    expect(
      getSearchBarViewModel(buildSearchInputFromDisplay("#rust cargo", "")),
    ).toEqual({
      displayValue: "",
      committedTags: ["rust"],
      hidden: false,
    });
  });

  it("keeps command arguments after visible query text", () => {
    expect(buildSearchInputFromDisplay("#rust ", "cargo > run")).toBe(
      "#rust cargo > run",
    );
  });

  it("supports hidden search prefixes with committed tags", () => {
    expect(getSearchBarViewModel("!#rust ")).toEqual({
      displayValue: "",
      committedTags: ["rust"],
      hidden: true,
    });

    expect(buildSearchInputFromDisplay("!#rust ", "cargo")).toBe(
      "!#rust cargo",
    );
  });

  it("shows hidden search as a badge instead of visible punctuation", () => {
    expect(getSearchBarViewModel("! ")).toEqual({
      displayValue: "",
      committedTags: [],
      hidden: true,
    });

    expect(getSearchBarViewModel("! rust ")).toEqual({
      displayValue: "rust ",
      committedTags: [],
      hidden: true,
    });
  });

  it("keeps hidden search active while visible text changes", () => {
    expect(buildSearchInputFromDisplay("! rust", "rust async")).toBe(
      "!rust async",
    );
  });

  it("keeps hidden search active when tags are badged", () => {
    expect(getSearchBarViewModel("! #rust ")).toEqual({
      displayValue: "",
      committedTags: ["rust"],
      hidden: true,
    });

    expect(buildSearchInputFromDisplay("! #rust cargo", "")).toBe("!#rust ");
  });

  it("removes hidden search without disturbing tag badges", () => {
    expect(removeHiddenFilter("! #rust cargo")).toBe("#rust cargo");
    expect(getSearchBarViewModel(removeHiddenFilter("! #rust "))).toEqual({
      displayValue: "",
      committedTags: ["rust"],
      hidden: false,
    });
  });

  it("removes a committed tag without disturbing the query", () => {
    expect(removeCommittedTagAt("#rust #tauri cargo", 0)).toBe("#tauri cargo");
  });

  it("keeps later tags badged after removing an earlier badge", () => {
    const nextInput = removeCommittedTagAt("#rust #tauri ", 0);

    expect(nextInput).toBe("#tauri ");
    expect(getSearchBarViewModel(nextInput)).toEqual({
      displayValue: "",
      committedTags: ["tauri"],
      hidden: false,
    });
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
      hidden: false,
    });
  });

  it("sorts tag suggestions by tag cloud hit count", () => {
    expect(
      sortTagSuggestions([
        { tag: "tauri", count: 3 },
        { tag: "rust", count: 12 },
        { tag: "react", count: 12 },
      ]),
    ).toEqual(["react", "rust", "tauri"]);
  });
});
