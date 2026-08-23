import { useMemo, useRef, useState } from "react";
import { previewApi } from "@/api/preview";

import {
  FileEditorTabState,
  IndexItem,
  PreviewTab,
  PreviewPanelHandle,
} from "@/types";
import { LIVE_PREVIEW_TAB_ID } from "@/components/preview/constants";

const normalizeFilePath = (filePath: string) => filePath.replace(/\\/g, "/");

type OpenFileEditorTabParams = {
  filePath: string;
  initialTitle: string;
  initialBody: string;
};

/**
 * Manages preview tabs for the currently selected item.
 *
 * The preview area has two kinds of tabs:
 *
 * - live tab: automatically follows the currently selected item
 * - pinned tabs: fixed preview tabs created from selected items
 *
 * This hook owns:
 *
 * - active preview tab state
 * - pinned preview tabs
 * - preview panel refs
 * - tab switching
 * - tab closing
 * - preview scroll commands
 *
 * @param item Currently selected item shown in the live preview tab.
 */
export const usePreviewTabs = (item: IndexItem | null) => {
  const [pinnedTabs, setPinnedTabs] = useState<PreviewTab[]>([]);
  const [activeTabId, setActiveTabId] = useState(LIVE_PREVIEW_TAB_ID);

  /**
   * Imperative handles for rendered preview panels.
   *
   * Used by keyboard shortcuts to scroll the active preview
   * without coupling shortcut handling to individual preview components.
   */
  const previewRefs = useRef<Record<string, PreviewPanelHandle | null>>({});

  /**
   * Current tab list.
   *
   * The live tab is included only when an item is selected.
   * Pinned tabs are appended after the live tab.
   */
  const tabs = useMemo(() => {
    const liveTab: PreviewTab[] = item
      ? [{ id: LIVE_PREVIEW_TAB_ID, type: "item", item }]
      : [];

    return [...liveTab, ...pinnedTabs];
  }, [item, pinnedTabs]);

  /**
   * Returns the imperative handle for the active preview panel.
   */
  const getActivePreviewHandle = () => {
    return previewRefs.current[activeTabId] ?? null;
  };

  const activateLivePreview = () => {
    setActiveTabId(LIVE_PREVIEW_TAB_ID);
  };

  /**
   * Scrolls the active preview panel down.
   */
  const scrollActivePreviewDown = () => {
    getActivePreviewHandle()?.scrollDown();
  };

  /**
   * Scrolls the active preview panel up.
   */
  const scrollActivePreviewUp = () => {
    getActivePreviewHandle()?.scrollUp();
  };

  /**
   * Opens an item as a fixed preview tab.
   *
   * If the item already has a pinned tab, that tab is activated.
   */
  const openPreviewTab = (tabItem: IndexItem) => {
    const id = `pinned:${tabItem.id}`;

    setPinnedTabs((prev) => {
      if (prev.some((tab) => tab.id === id)) return prev;

      return [...prev, { id, type: "item", item: tabItem }];
    });

    setActiveTabId(id);
  };

  const openFileCreatorTab = () => {
    const id = `editor:create:${crypto.randomUUID()}`;

    setPinnedTabs((prev) => [
      ...prev,
      {
        id,
        type: "fileEditor",
        editor: {
          mode: "create",
          initialTitle: "",
          initialBody: "",
          title: "Untitled",
          dirty: false,
        },
      },
    ]);

    setActiveTabId(id);
  };

  const openFileEditorTab = ({
    filePath,
    initialTitle,
    initialBody,
  }: OpenFileEditorTabParams) => {
    const normalizedPath = normalizeFilePath(filePath);
    let existingId: string | null = null;

    setPinnedTabs((prev) => {
      const existing = prev.find(
        (tab) =>
          tab.type === "fileEditor" &&
          tab.editor.filePath &&
          normalizeFilePath(tab.editor.filePath) === normalizedPath,
      );

      if (existing) {
        existingId = existing.id;
        return prev;
      }

      const id = `editor:${crypto.randomUUID()}`;
      existingId = id;

      return [
        ...prev,
        {
          id,
          type: "fileEditor",
          editor: {
            mode: "edit",
            filePath,
            initialTitle,
            initialBody,
            title: initialTitle.trim() || "Untitled",
            dirty: false,
          },
        },
      ];
    });

    if (existingId) {
      setActiveTabId(existingId);
    }
  };

  const openItemInspectorTab = (inspectedItem: IndexItem) => {
    const id = `inspector:item:${inspectedItem.id}`;

    setPinnedTabs((prev) => {
      if (prev.some((tab) => tab.id === id)) return prev;

      return [
        ...prev,
        {
          id,
          type: "itemInspector",
          item: inspectedItem,
        },
      ];
    });

    setActiveTabId(id);
  };

  const openQueryInspectorTab = (inspectedQuery: string) => {
    const id = `inspector:query:${inspectedQuery}`;

    setPinnedTabs((prev) => {
      if (prev.some((tab) => tab.id === id)) return prev;

      return [
        ...prev,
        {
          id,
          type: "queryInspector",
          query: inspectedQuery,
        },
      ];
    });

    setActiveTabId(id);
  };

  const openHelpTab = (itemPage: string) => {
    const id = `help:${itemPage}`;

    setPinnedTabs((prev) => {
      if (prev.some((tab) => tab.id === id)) return prev;

      return [
        ...prev,
        {
          id,
          type: "help",
          itemPage,
        },
      ];
    });

    setActiveTabId(id);
  };

  const updateFileEditorTab = (
    tabId: string,
    patch: Partial<FileEditorTabState>,
  ) => {
    setPinnedTabs((prev) => {
      let changed = false;

      const next = prev.map((tab) => {
        if (tab.id !== tabId || tab.type !== "fileEditor") {
          return tab;
        }

        const patchChanged = Object.entries(patch).some(
          ([key, value]) =>
            tab.editor[key as keyof FileEditorTabState] !== value,
        );

        if (!patchChanged) {
          return tab;
        }

        changed = true;

        return {
          ...tab,
          editor: {
            ...tab.editor,
            ...patch,
          },
        };
      });

      return changed ? next : prev;
    });
  };

  const canCloseTab = (tab: PreviewTab | undefined) => {
    if (tab?.type !== "fileEditor" || !tab.editor.dirty) {
      return true;
    }

    return window.confirm("Discard unsaved changes?");
  };

  const closePreviewTab = (
    tabId: string,
    options: { force?: boolean } = {},
  ) => {
    const tab = tabs.find((candidate) => candidate.id === tabId);

    if (!options.force && !canCloseTab(tab)) {
      return;
    }

    setPinnedTabs((prev) => prev.filter((candidate) => candidate.id !== tabId));

    if (activeTabId === tabId) {
      setActiveTabId(LIVE_PREVIEW_TAB_ID);
    }
  };

  /**
   * Pins the current live preview as a fixed tab.
   *
   * If the item is already pinned, the existing pinned tab is kept.
   * The pinned tab becomes active after this operation.
   */
  const pinCurrentPreview = () => {
    if (!item) return;

    openPreviewTab(item);
  };

  /**
   * Switches the active preview tab in the given direction.
   *
   * Tab navigation wraps around at both ends.
   *
   * @param direction `1` for next tab, `-1` for previous tab.
   */
  const switchPreviewTab = (direction: 1 | -1) => {
    if (tabs.length === 0) return;

    const currentIndex = Math.max(
      0,
      tabs.findIndex((tab) => tab.id === activeTabId),
    );

    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;

    setActiveTabId(tabs[nextIndex].id);
  };

  /**
   * Closes the active preview tab.
   *
   * Behavior:
   *
   * - If a pinned tab is active, removes that pinned tab.
   * - If the live tab is active and pinned tabs exist, removes the oldest pinned tab.
   * - If the live tab is active and no pinned tabs exist, closes the preview area.
   */
  const closeActivePreviewTab = () => {
    if (activeTabId !== LIVE_PREVIEW_TAB_ID) {
      closePreviewTab(activeTabId);
      return;
    }

    setPinnedTabs((prev) => {
      if (prev.length === 0) {
        previewApi.closePreview();
        return prev;
      }

      if (!canCloseTab(prev[0])) {
        return prev;
      }

      return prev.slice(1);
    });
  };

  /**
   * Registers or clears an imperative preview panel handle.
   *
   * Called by preview panel components during mount/unmount.
   *
   * @param tabId Preview tab id.
   * @param handle Preview panel imperative handle.
   */
  const setPreviewRef = (tabId: string, handle: PreviewPanelHandle | null) => {
    previewRefs.current[tabId] = handle;
  };

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activePreviewItem = activeTab?.type === "item" ? activeTab.item : null;
  const isFileEditorActive = activeTab?.type === "fileEditor";

  return {
    tabs,
    activeTabId,
    activePreviewItem,
    isFileEditorActive,
    setPreviewRef,
    getActivePreviewHandle,
    activateLivePreview,
    scrollActivePreviewDown,
    scrollActivePreviewUp,
    pinCurrentPreview,
    openPreviewTab,
    openFileCreatorTab,
    openFileEditorTab,
    openItemInspectorTab,
    openQueryInspectorTab,
    openHelpTab,
    updateFileEditorTab,
    closePreviewTab,
    switchNextPreviewTab: () => switchPreviewTab(1),
    switchPrevPreviewTab: () => switchPreviewTab(-1),
    closeActivePreviewTab,
  };
};
