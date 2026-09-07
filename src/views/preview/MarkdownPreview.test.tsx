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
  const mockPreviewAssetDataUrl = () => {
    mockedInvoke.mockImplementation((command, args) => {
      if (command === "read_preview_asset_data_url") {
        const assetPath = (args as { assetPath: string }).assetPath;

        if (assetPath.endsWith(".mp4")) {
          return Promise.resolve("data:video/mp4;base64,dmlkZW8=");
        }

        if (assetPath.endsWith(".mp3")) {
          return Promise.resolve("data:audio/mpeg;base64,YXVkaW8=");
        }

        if (assetPath.endsWith(".pdf")) {
          return Promise.resolve("data:application/pdf;base64,cGRm");
        }
      }

      return Promise.resolve(undefined);
    });
  };

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
    mockPreviewAssetDataUrl();

    render(
      <MarkdownPreview
        id="video"
        sourcePath="C:/Users/j/Documents/source.md"
        content="![Demo video](file:///C:/Users/j/Documents/demo.mp4)"
      />,
    );

    const video = await screen.findByTitle("Demo video");
    const source = video.querySelector("source");

    expect(video.tagName.toLowerCase()).toBe("video");
    expect(source?.getAttribute("src")).toBe("data:video/mp4;base64,dmlkZW8=");
    expect(source?.getAttribute("type")).toBe("video/mp4");
    expect(mockedInvoke).toHaveBeenCalledWith("read_preview_asset_data_url", {
      sourcePath: "C:/Users/j/Documents/source.md",
      assetPath: "C:/Users/j/Documents/demo.mp4",
    });
  });

  it("renders local audio file URLs with the built-in audio player", async () => {
    mockPreviewAssetDataUrl();

    const { container } = render(
      <MarkdownPreview
        id="audio"
        sourcePath="C:/Users/j/Documents/source.md"
        content="![Demo audio](file:///C:/Users/j/Documents/demo.mp3)"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Demo audio")).toBeTruthy();
    });

    const source = container.querySelector("audio source");

    expect(source?.getAttribute("src")).toBe("data:audio/mpeg;base64,YXVkaW8=");
    expect(source?.getAttribute("type")).toBe("audio/mpeg");
  });

  it("renders local PDF file URLs with the built-in PDF frame", async () => {
    mockPreviewAssetDataUrl();

    render(
      <MarkdownPreview
        id="pdf"
        sourcePath="C:/Users/j/Documents/source.md"
        content="![Spec](file:///C:/Users/j/Documents/spec.pdf)"
      />,
    );

    const frame = await screen.findByTitle("Spec");

    expect(frame.tagName.toLowerCase()).toBe("iframe");
    expect(frame.getAttribute("src")).toBe("data:application/pdf;base64,cGRm");
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-same-origin allow-scripts",
    );
  });

  it("does not render local file URLs without a source file scope", async () => {
    render(
      <MarkdownPreview
        id="unscoped"
        content="![Secret](file:///C:/Users/j/Documents/secret.pdf)"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Secret")).toBeTruthy();
    });

    expect(mockedInvoke).not.toHaveBeenCalledWith(
      "read_preview_asset_data_url",
      expect.anything(),
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
