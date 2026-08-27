import { previewApi } from "@/api/preview";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  CommandHistoryEntry,
  CommandHistoryKind,
  IndexItem,
  PluginInternalPage,
  PreviewPanelHandle,
  ShortcutHandlers,
} from "@/types";

import { parseSearchInput } from "@/features/search/parseSearchInput";
import {
  toggleHiddenFilter,
  toggleInternalFilter,
  togglePluginPlaygroundFilter,
} from "@/features/search/searchBarViewModel";
import { commandApi } from "@/api/command";
import { openerApi } from "@/api/opener";
import { settingsApi } from "@/api/settings";
import type { TranslationFunctions } from "@/i18n/i18n-types";

import { toast } from "@/utils/toast";
import {
  executePluginAction,
  getInternalPageContribution,
  isPluginInternalPage,
} from "@/features/plugins/pluginRegistry";

const nextIndex = (current: number, length: number) =>
  length === 0 ? current : (current + 1) % length;

const prevIndex = (current: number, length: number) =>
  length === 0 ? current : (current - 1 + length) % length;

type Params = {
  LL: TranslationFunctions;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  itemCount: number;
  pageSize: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  togglePreviewMode: () => void;
  togglePreviewLayout: () => void;
  toggleLauncherLayout: () => void;
  scrollActivePreviewDown: () => void;
  scrollActivePreviewUp: () => void;
  pinCurrentPreview: () => void;
  switchNextPreviewTab: () => void;
  switchPrevPreviewTab: () => void;
  closeActivePreviewTab: () => void;
  getActivePreviewHandle: () => PreviewPanelHandle | null;
  getActiveItem: () => IndexItem | null;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  getQuery: () => string;
  switchTargetGroup: () => void;
  openQueryInspector: () => void;
  openItemHelp: () => void;
  openCommandHistory: () => void;
  openDebugPage: () => void;
  openTagCloudPage: () => void;
  openPluginActionPage: (page: PluginInternalPage) => void;
  openItemInspector: (item: IndexItem) => void;
  openFileCreator: () => void;
  openActiveFileEditor: () => void;
  recordCommandHistory: (
    entry: Omit<CommandHistoryEntry, "id" | "createdAt">,
  ) => void;
};

export const createAppShortcuts = ({
  LL,
  setSelectedIndex,
  itemCount,
  pageSize,
  inputRef,
  togglePreviewMode,
  togglePreviewLayout,
  toggleLauncherLayout,
  scrollActivePreviewDown,
  scrollActivePreviewUp,
  pinCurrentPreview,
  switchNextPreviewTab,
  switchPrevPreviewTab,
  closeActivePreviewTab,
  getActivePreviewHandle,
  getActiveItem,
  getQuery,
  setQuery,
  switchTargetGroup,
  openQueryInspector,
  openItemHelp,
  openCommandHistory,
  openDebugPage,
  openTagCloudPage,
  openPluginActionPage,
  openItemInspector,
  openFileCreator,
  openActiveFileEditor,
  recordCommandHistory,
}: Params): ShortcutHandlers => {
  const recordHistory = ({
    input,
    result,
    status,
    kind,
    target,
  }: {
    input: string;
    result: string;
    status: CommandHistoryEntry["status"];
    kind: CommandHistoryKind;
    target: string;
  }) => {
    recordCommandHistory({
      input,
      result,
      status,
      kind,
      target,
    });
  };

  const runActiveUrlAction = async () => {
    const item = getActiveItem();

    if (!item?.url) {
      return;
    }

    await openUrl(item.url);
  };

  const runActiveCommandAction = async () => {
    const item = getActiveItem();

    if (!item?.command) {
      return;
    }

    const rawInput = getQuery();
    const { commandArgs } = parseSearchInput(rawInput);

    try {
      await commandApi.runItemCommand(item.id, commandArgs);
      const resultMessage = LL.appMessages.launchedItem({
        title: item.title,
      });

      toast.success(resultMessage);
      recordHistory({
        input: rawInput,
        result: resultMessage,
        status: "success",
        kind: "command",
        target: item.title,
      });
    } catch (error) {
      const resultMessage = String(error);

      toast.error(resultMessage);
      recordHistory({
        input: rawInput,
        result: resultMessage,
        status: "error",
        kind: "command",
        target: item.title,
      });
    }
  };

  const runPluginPageAction = async (item: IndexItem) => {
    const rawInput = getQuery();
    const { query, commandArgs } = parseSearchInput(rawInput);

    if (
      item.preview.type === "internal" &&
      isPluginInternalPage(item.preview.page)
    ) {
      const contribution = getInternalPageContribution(item.preview.page);
      const pageAction = contribution?.pageAction;

      if (contribution && pageAction) {
        try {
          const result = await executePluginAction({
            pluginId: contribution.pluginId,
            actionId: pageAction.actionId,
            input: commandArgs ?? undefined,
          });
          const resultMessage =
            result === undefined
              ? LL.appMessages.ranItem({ title: item.title })
              : String(result);

          toast.success(resultMessage);
          recordHistory({
            input: rawInput,
            result: resultMessage,
            status: "success",
            kind: "pageAction",
            target: item.title,
          });

          if (commandArgs !== null) {
            setQuery(`${query} > `);
          }
        } catch (error) {
          const resultMessage = String(error);

          toast.error(resultMessage);
          recordHistory({
            input: rawInput,
            result: resultMessage,
            status: "error",
            kind: "pageAction",
            target: item.title,
          });
        }

        return true;
      }
    }

    return false;
  };

  const openActiveItem = async () => {
    const item = getActiveItem();

    if (!item) {
      return;
    }

    if (await runPluginPageAction(item)) {
      return;
    }

    switch (item.defaultAction) {
      case "command":
        await runActiveCommandAction();
        return;

      case "url":
        await runActiveUrlAction();
        return;

      default:
        if (!item.url && item.preview.type === "external") {
          await openUrl(item.preview.url);
        }
        return;
    }
  };

  const openActiveSourceFile = async () => {
    const item = getActiveItem();

    if (!item?.sourcePath) {
      toast.error(LL.previewPanel.noSourceFilePath());
      return;
    }

    try {
      await openerApi.openSourceFileOrReveal(item.sourcePath);
    } catch {
      toast.error(LL.previewPanel.openFileFallback());
    }
  };

  const revealActiveSourceFile = async () => {
    const item = getActiveItem();

    if (!item?.sourcePath) {
      toast.error(LL.previewPanel.noSourceFilePath());
      return;
    }

    try {
      await openerApi.revealInExplorer(item.sourcePath);
    } catch (error) {
      toast.error(
        LL.appMessages.openContainingFolderFailed({ error: String(error) }),
      );
    }
  };

  const copyActivePreviewContent = async () => {
    try {
      const copied = await getActivePreviewHandle()?.copyContent?.();

      if (copied) {
        toast.success(LL.previewPanel.textCopied());
      } else {
        toast.error(LL.previewPanel.noTextToCopy());
      }
    } catch (error) {
      toast.error(LL.appMessages.copyTextFailed({ error: String(error) }));
    }
  };

  const copyActivePreviewCodeBlock = async (index: number) => {
    try {
      const copied = await getActivePreviewHandle()?.copyCodeBlock?.(index);

      if (copied) {
        toast.success(LL.markdownPreview.copiedCodeBlock({ index: index + 1 }));
      } else {
        toast.error(LL.markdownPreview.codeBlockNotFound({ index: index + 1 }));
      }
    } catch (error) {
      toast.error(
        LL.markdownPreview.copyCodeBlockFailed({ error: String(error) }),
      );
    }
  };

  return {
    selectNextItem: () => {
      setSelectedIndex((p) => nextIndex(p, itemCount));
    },

    selectPrevItem: () => {
      setSelectedIndex((p) => prevIndex(p, itemCount));
    },

    selectNextPage: () => {
      if (itemCount === 0) return;
      setSelectedIndex((p) => Math.min(p + pageSize, itemCount - 1));
    },

    selectPrevPage: () => {
      if (itemCount === 0) return;
      setSelectedIndex((p) => Math.max(p - pageSize, 0));
    },

    selectFirstItem: () => {
      if (itemCount === 0) return;
      setSelectedIndex(0);
    },

    selectLastItem: () => {
      if (itemCount === 0) return;
      setSelectedIndex(itemCount - 1);
    },

    openActiveItem: () => {
      void openActiveItem();
    },

    openActiveUrlAction: () => {
      void runActiveUrlAction();
    },

    openActiveCommandAction: () => {
      void runActiveCommandAction();
    },

    scrollActivePreviewDown: () => {
      scrollActivePreviewDown();
    },

    scrollActivePreviewUp: () => {
      scrollActivePreviewUp();
    },

    createFile: () => {
      openFileCreator();
    },

    openActiveFileEditor: () => {
      openActiveFileEditor();
    },

    pinActivePreview: () => {
      pinCurrentPreview();
    },

    switchNextPreviewTab: () => {
      switchNextPreviewTab();
    },

    switchPrevPreviewTab: () => {
      switchPrevPreviewTab();
    },

    closeActivePreviewTab: () => {
      closeActivePreviewTab();
    },

    focusSearch: () => {
      inputRef.current?.focus();
    },

    toggleHiddenFilter: () => {
      setQuery(toggleHiddenFilter(getQuery()));
      inputRef.current?.focus();
    },

    toggleInternalFilter: () => {
      setQuery(toggleInternalFilter(getQuery()));
      inputRef.current?.focus();
    },

    togglePluginPlaygroundFilter: () => {
      setQuery(togglePluginPlaygroundFilter(getQuery()));
      inputRef.current?.focus();
    },

    openActiveSourceFile: () => {
      void openActiveSourceFile();
    },

    revealActiveSourceFile: () => {
      void revealActiveSourceFile();
    },

    togglePreviewMode: () => {
      togglePreviewMode();
    },

    togglePreviewLayout: () => {
      togglePreviewLayout();
    },

    toggleLauncherLayout: () => {
      toggleLauncherLayout();
    },

    switchTargetGroup: () => {
      switchTargetGroup();
    },

    openQueryInspector: () => {
      openQueryInspector();
    },

    openItemHelp: () => {
      openItemHelp();
    },

    openCommandHistory: () => {
      openCommandHistory();
    },

    openDebugPage: () => {
      openDebugPage();
    },

    openTagCloudPage: () => {
      openTagCloudPage();
    },

    openPluginActionPage: (page) => {
      openPluginActionPage(page);
    },

    inspectActiveItem: () => {
      const item = getActiveItem();

      if (!item) {
        return;
      }

      openItemInspector(item);
    },

    closePreviewWindow: () => {
      previewApi.closePreview();
    },

    copyActivePreviewContent: () => {
      void copyActivePreviewContent();
    },

    copyActivePreviewCodeBlock1: () => {
      void copyActivePreviewCodeBlock(0);
    },

    copyActivePreviewCodeBlock2: () => {
      void copyActivePreviewCodeBlock(1);
    },

    copyActivePreviewCodeBlock3: () => {
      void copyActivePreviewCodeBlock(2);
    },

    copyActivePreviewCodeBlock4: () => {
      void copyActivePreviewCodeBlock(3);
    },

    openSettingsFile: () => {
      settingsApi.openFile();
    },
  };
};
