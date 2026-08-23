// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (filePath: string) => `asset://${filePath}`,
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

vi.mock("@/i18n/I18nProvider", () => ({
  useI18nContext: () => ({
    LL: {
      markdownPreview: {
        copiedCodeBlock: ({ index }: { index: number }) =>
          `Copied code block ${index}`,
        codeBlockNotFound: ({ index }: { index: number }) =>
          `Code block ${index} not found`,
        copyCodeBlockFailed: ({ error }: { error: string }) =>
          `Failed to copy code block: ${error}`,
        sourceFileNotFound: () => "Source file not found",
        taskNotFound: () => "Task not found",
        updateTaskFailed: ({ error }: { error: string }) =>
          `Failed to update task: ${error}`,
      },
    },
  }),
}));

vi.mock("@/views/preview/CodeBlock", () => ({
  CodeBlock: () => <pre>code block</pre>,
}));

vi.mock("@/views/preview/MermaidBlock", () => ({
  MermaidBlock: () => <pre>mermaid block</pre>,
}));

afterEach(() => {
  cleanup();
  mockedInvoke.mockReset();
});

describe("MarkdownPreview", () => {
  it("renders a single Markdown line break as a visible break", async () => {
    const { container } = render(
      <MarkdownPreview id="soft-break" content={"first line\nsecond line"} />,
    );

    await waitFor(() => {
      expect(container.querySelector("p br")).toBeTruthy();
    });

    const paragraph = container.querySelector("p");

    expect(paragraph?.textContent).toContain("first line");
    expect(paragraph?.textContent).toContain("second line");
  });

  it("renders local video file URLs with the built-in video player", async () => {
    render(
      <MarkdownPreview
        id="video"
        content="![Demo video](file:///C:/Users/j/Documents/demo.mp4)"
      />,
    );

    const video = await screen.findByTitle("Demo video");
    const source = video.querySelector("source");

    expect(video.tagName.toLowerCase()).toBe("video");
    expect(source?.getAttribute("src")).toBe(
      "asset://C:/Users/j/Documents/demo.mp4",
    );
    expect(source?.getAttribute("type")).toBe("video/mp4");
  });

  it("renders local audio file URLs with the built-in audio player", async () => {
    const { container } = render(
      <MarkdownPreview
        id="audio"
        content="![Demo audio](file:///C:/Users/j/Documents/demo.mp3)"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Demo audio")).toBeTruthy();
    });

    const source = container.querySelector("audio source");

    expect(source?.getAttribute("src")).toBe(
      "asset://C:/Users/j/Documents/demo.mp3",
    );
    expect(source?.getAttribute("type")).toBe("audio/mpeg");
  });

  it("renders local PDF file URLs with the built-in PDF frame", async () => {
    render(
      <MarkdownPreview
        id="pdf"
        content="![Spec](file:///C:/Users/j/Documents/spec.pdf)"
      />,
    );

    const frame = await screen.findByTitle("Spec");

    expect(frame.tagName.toLowerCase()).toBe("iframe");
    expect(frame.getAttribute("src")).toBe(
      "asset://C:/Users/j/Documents/spec.pdf",
    );
  });

  it("toggles only the clicked nested task item", async () => {
    mockedInvoke.mockResolvedValue(undefined);

    const content = [
      "- [ ] 1つ目のTODO",
      "  - [x] 2つ目のTODO",
      "  - [ ] 3つ目のTODO",
      "  - [ ] 4つ目のTODO",
    ].join("\n");

    render(
      <MarkdownPreview
        id="nested-tasks"
        content={content}
        sourcePath="C:/Users/j/Documents/tasks.md"
      />,
    );

    fireEvent.click(await screen.findByText("2つ目のTODO"));

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith("update_markdown_file_body", {
      filePath: "C:/Users/j/Documents/tasks.md",
      body: [
        "- [ ] 1つ目のTODO",
        "  - [ ] 2つ目のTODO",
        "  - [ ] 3つ目のTODO",
        "  - [ ] 4つ目のTODO",
      ].join("\n"),
    });
  });
});
