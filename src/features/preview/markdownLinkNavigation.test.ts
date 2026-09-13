import { describe, expect, it, vi } from "vitest";

import { openMarkdownLink } from "./markdownLinkNavigation";
import type { IndexItem } from "@/types";

const item = (previewContent = ""): IndexItem => ({
  id: "doc",
  title: "Doc",
  sourcePath: "C:/notes/doc.md",
  updatedAt: "2026-09-14T00:00:00.000Z",
  metadata: {
    tags: [],
    aliases: [],
    star: false,
    boost: 1,
  },
  preview: {
    type: "markdown",
    content: previewContent,
  },
});

describe("openMarkdownLink", () => {
  it("opens missing-link create actions in a fixed-path file editor tab", async () => {
    const openFileCreatorTab = vi.fn();
    const toast = {
      error: vi.fn(),
      warning: vi.fn(),
    };

    await openMarkdownLink({
      sourcePath: "C:/notes/source.md",
      href: "./docs/template",
      sourceFileNotFoundMessage: "Source file not found",
      resolveMarkdownLink: vi.fn(async () => ({
        status: "missing" as const,
        createPath: "C:/notes/docs/template.md",
      })),
      getPreview: vi.fn(),
      openPreviewTab: vi.fn(),
      openFileCreatorTab,
      toast,
    });

    expect(toast.warning).toHaveBeenCalledWith("Link target not found: ./docs/template", {
      action: {
        label: "Create",
        onClick: expect.any(Function),
      },
    });

    const options = toast.warning.mock.calls[0][1];
    options.action.onClick();

    expect(openFileCreatorTab).toHaveBeenCalledWith({
      filePath: "C:/notes/docs/template.md",
      initialTitle: "template",
      extension: "md",
    });
  });

  it("loads a full preview before opening an indexed markdown link target", async () => {
    const lightweightItem = item("");
    const openPreviewTab = vi.fn();

    await openMarkdownLink({
      sourcePath: "C:/notes/source.md",
      href: "./doc.md",
      sourceFileNotFoundMessage: "Source file not found",
      resolveMarkdownLink: vi.fn(async () => ({
        status: "found" as const,
        item: lightweightItem,
      })),
      getPreview: vi.fn(async () => ({
        type: "markdown" as const,
        content: "# Full",
      })),
      openPreviewTab,
      openFileCreatorTab: vi.fn(),
      toast: {
        error: vi.fn(),
        warning: vi.fn(),
      },
    });

    expect(openPreviewTab).toHaveBeenCalledWith({
      ...lightweightItem,
      preview: {
        type: "markdown",
        content: "# Full",
      },
    });
  });
});
