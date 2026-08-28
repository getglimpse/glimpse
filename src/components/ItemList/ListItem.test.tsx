// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IndexItem, SearchSnippet } from "@/types";

import { ListItem } from "./ListItem";

vi.mock("@/i18n/I18nProvider", () => ({
  useI18nContext: () => ({
    LL: {
      itemList: {
        today: () => "Today",
        yesterday: () => "Yesterday",
        daysAgo: ({ count }: { count: number }) => `${count} days ago`,
        snippetSources: {
          body: () => "Body",
          title: () => "Title",
          alias: () => "Alias",
          tag: () => "Tag",
        },
      },
    },
  }),
}));

afterEach(() => {
  cleanup();
});

const item: IndexItem = {
  id: "item-1",
  title: "Rust Notes",
  sourcePath: "C:/notes/rust.md",
  updatedAt: new Date().toISOString(),
  metadata: {
    tags: ["search"],
    aliases: [],
    star: false,
    boost: 1,
  },
  preview: {
    type: "markdown",
    content: "# Rust Notes",
  },
};

const bodySnippet: SearchSnippet = {
  source: "body",
  fragments: [
    {
      text: "before ",
      matched: false,
    },
    {
      text: "needle",
      matched: true,
    },
    {
      text: " after",
      matched: false,
    },
  ],
  chunk: {
    ordinal: 0,
    startByte: 10,
    endByte: 28,
  },
};

const aliasSnippet: SearchSnippet = {
  source: "alias",
  fragments: [
    {
      text: "secondary alias",
      matched: true,
    },
  ],
};

const titleSnippet: SearchSnippet = {
  source: "title",
  fragments: [
    {
      text: "Rust",
      matched: true,
    },
    {
      text: " Notes",
      matched: false,
    },
  ],
};

describe("ListItem snippets", () => {
  it("renders the search score", () => {
    render(
      <ListItem
        item={item}
        score={12.345}
        isSelected={false}
        onClick={() => undefined}
      />,
    );

    expect(screen.getByText("12.345")).toBeTruthy();
  });

  it("renders the search score in compact mode", () => {
    render(
      <ListItem
        item={item}
        score={12.345}
        isSelected={false}
        onClick={() => undefined}
        compact
      />,
    );

    expect(screen.getByText("12.345")).toBeTruthy();
  });

  it("renders the first snippet with a source label", () => {
    render(
      <ListItem
        item={item}
        snippets={[bodySnippet]}
        isSelected={false}
        onClick={() => undefined}
      />,
    );

    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.getByText("before")).toBeTruthy();
    expect(screen.getByText("needle")).toBeTruthy();
    expect(screen.getByText("after")).toBeTruthy();
  });

  it("highlights matched snippet fragments", () => {
    render(
      <ListItem
        item={item}
        snippets={[bodySnippet]}
        isSelected={false}
        onClick={() => undefined}
      />,
    );

    expect(screen.getByText("needle").className).toContain("font-semibold");
    expect(screen.getByText("before").className).not.toContain("font-semibold");
  });

  it("omits snippets in compact mode", () => {
    render(
      <ListItem
        item={item}
        snippets={[bodySnippet]}
        isSelected={false}
        onClick={() => undefined}
        compact
      />,
    );

    expect(screen.queryByText("Body")).toBeNull();
    expect(screen.queryByText("needle")).toBeNull();
  });

  it("renders only the first snippet", () => {
    render(
      <ListItem
        item={item}
        snippets={[bodySnippet, aliasSnippet]}
        isSelected={false}
        onClick={() => undefined}
      />,
    );

    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.getByText("needle")).toBeTruthy();
    expect(screen.queryByText("Alias")).toBeNull();
    expect(screen.queryByText("secondary alias")).toBeNull();
  });

  it("renders Japanese snippet fragments", () => {
    render(
      <ListItem
        item={item}
        snippets={[
          {
            source: "body",
            fragments: [
              {
                text: "あなたが修了したときに",
                matched: false,
              },
              {
                text: "できる",
                matched: true,
              },
              {
                text: "ようになっていること",
                matched: false,
              },
            ],
          },
        ]}
        isSelected={false}
        onClick={() => undefined}
      />,
    );

    expect(screen.getByText("あなたが修了したときに")).toBeTruthy();
    expect(screen.getByText("できる")).toBeTruthy();
    expect(screen.getByText("ようになっていること")).toBeTruthy();
    expect(screen.getByText("できる").className).toContain("font-semibold");
  });

  it("renders title snippet fragments", () => {
    render(
      <ListItem
        item={item}
        snippets={[titleSnippet]}
        isSelected={false}
        onClick={() => undefined}
      />,
    );

    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("Rust").className).toContain("font-semibold");
    expect(screen.getByText("Notes")).toBeTruthy();
  });

  it("handles snippet clicks without selecting the row", () => {
    const onClick = vi.fn();
    const onSnippetClick = vi.fn();

    render(
      <ListItem
        item={item}
        snippets={[bodySnippet]}
        isSelected={false}
        onClick={onClick}
        onSnippetClick={onSnippetClick}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Body.*needle/s }));

    expect(onSnippetClick).toHaveBeenCalledWith(bodySnippet);
    expect(onClick).not.toHaveBeenCalled();
  });
});
