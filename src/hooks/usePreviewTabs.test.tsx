// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { LIVE_PREVIEW_TAB_ID } from "@/components/preview/constants";
import { usePreviewTabs } from "./usePreviewTabs";

vi.mock("@/api/preview", () => ({
  previewApi: { closePreview: vi.fn() },
}));

const editorParams = (filePath: string, initialTitle: string) => ({
  filePath,
  initialTitle,
  initialBody: `body:${initialTitle}`,
});

it("creates and activates a file editor tab", () => {
  const { result } = renderHook(() => usePreviewTabs(null));

  expect(result.current.activeTabId).toBe(LIVE_PREVIEW_TAB_ID);

  act(() => {
    result.current.openFileEditorTab(editorParams("C:\\notes\\one.md", "One"));
  });

  expect(result.current.tabs).toHaveLength(1);
  expect(result.current.tabs[0]).toMatchObject({
    id: result.current.activeTabId,
    type: "fileEditor",
    editor: { filePath: "C:\\notes\\one.md", initialTitle: "One" },
  });
  expect(result.current.lastActivePinnedTabId).toBe(
    result.current.activeTabId,
  );
});

it("reactivates the existing editor tab without adding a duplicate", () => {
  const { result } = renderHook(() => usePreviewTabs(null));

  act(() => {
    result.current.openFileEditorTab(editorParams("C:\\notes\\one.md", "One"));
  });
  const firstEditorId = result.current.activeTabId;

  act(() => {
    result.current.openFileEditorTab(editorParams("C:\\notes\\two.md", "Two"));
  });
  expect(result.current.activeTabId).not.toBe(firstEditorId);

  act(() => {
    result.current.openFileEditorTab(editorParams("C:/notes/one.md", "Ignored"));
  });

  expect(result.current.tabs).toHaveLength(2);
  expect(result.current.activeTabId).toBe(firstEditorId);
  expect(result.current.lastActivePinnedTabId).toBe(firstEditorId);
  expect(result.current.tabs.find((tab) => tab.id === firstEditorId)).toMatchObject(
    {
      type: "fileEditor",
      editor: { initialTitle: "One" },
    },
  );
});
