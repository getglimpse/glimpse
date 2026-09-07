import { afterEach, describe, expect, it, vi } from "vitest";

import type { IndexItem } from "@/types";
import type { TranslationFunctions } from "@/i18n/i18n-types";

import { createAppShortcuts } from "./createAppShortcuts";

const clipboardMocks = vi.hoisted(() => ({
  copyText: vi.fn(),
}));

const pluginRegistryMocks = vi.hoisted(() => ({
  executePluginAction: vi.fn(),
  getInternalPageContribution: vi.fn(),
  isPluginInternalPage: vi.fn((page: string) => page.startsWith("plugin:")),
}));

const settingsMocks = vi.hoisted(() => ({
  settingsApi: {
    get: vi.fn(),
    openFile: vi.fn(),
  },
}));

const toastMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/api/command", () => ({
  commandApi: {
    runItemCommand: vi.fn(),
  },
}));

const openerMocks = vi.hoisted(() => ({
  openerApi: {
    openExternalUrl: vi.fn(),
    openSourceFileOrReveal: vi.fn(),
    revealInExplorer: vi.fn(),
  },
}));

vi.mock("@/api/opener", () => ({
  openerApi: openerMocks.openerApi,
}));

vi.mock("@/api/preview", () => ({
  previewApi: {
    closePreview: vi.fn(),
  },
}));

vi.mock("@/api/settings", () => ({
  settingsApi: settingsMocks.settingsApi,
}));

vi.mock("@/features/plugins/pluginRegistry", () => ({
  executePluginAction: pluginRegistryMocks.executePluginAction,
  getInternalPageContribution: pluginRegistryMocks.getInternalPageContribution,
  isPluginInternalPage: pluginRegistryMocks.isPluginInternalPage,
}));

vi.mock("@/utils/clipboard", () => ({
  copyText: clipboardMocks.copyText,
}));

vi.mock("@/utils/toast", () => ({
  toast: toastMocks.toast,
}));

const pluginItem: IndexItem = {
  id: "plugin:date-calculator-plugin",
  title: "Date Calculator",
  updatedAt: "2026-08-31T00:00:00.000Z",
  metadata: {
    tags: [],
    aliases: [],
    star: false,
    boost: 0,
  },
  preview: {
    type: "internal",
    page: "plugin:date-calculator-plugin",
  },
};

const LL = {
  appMessages: {
    ranItem: ({ title }: { title: string }) => `Ran ${title}`,
    launchedItem: ({ title }: { title: string }) => `Launched ${title}`,
    openContainingFolderFailed: ({ error }: { error: string }) => error,
    copyTextFailed: ({ error }: { error: string }) => error,
  },
  previewPanel: {
    noSourceFilePath: () => "No source file path",
    openFileFallback: () => "Could not open file",
    textCopied: () => "Text copied",
    noTextToCopy: () => "No text to copy",
  },
  markdownPreview: {
    copiedCodeBlock: ({ index }: { index: number }) =>
      `Copied code block ${index}`,
    codeBlockNotFound: ({ index }: { index: number }) =>
      `Code block ${index} not found`,
    copyCodeBlockFailed: ({ error }: { error: string }) => error,
  },
} as TranslationFunctions;

afterEach(() => {
  vi.clearAllMocks();
});

describe("createAppShortcuts", () => {
  it("opens URL actions through the validated backend opener API", async () => {
    const item: IndexItem = {
      ...pluginItem,
      id: "rust",
      title: "Rust",
      preview: {
        type: "markdown",
        content: "Rust",
      },
      url: "https://www.rust-lang.org/",
      defaultAction: "url",
    };

    createShortcuts({ getActiveItem: () => item }).openActiveItem();

    await vi.waitFor(() => {
      expect(openerMocks.openerApi.openExternalUrl).toHaveBeenCalledWith(
        "https://www.rust-lang.org/",
      );
    });
  });

  it("opens external previews through the validated backend opener API", async () => {
    const item: IndexItem = {
      ...pluginItem,
      id: "external-preview",
      title: "External Preview",
      preview: {
        type: "external",
        url: "https://example.com/",
      },
    };

    createShortcuts({ getActiveItem: () => item }).openActiveItem();

    await vi.waitFor(() => {
      expect(openerMocks.openerApi.openExternalUrl).toHaveBeenCalledWith(
        "https://example.com/",
      );
    });
  });

  it("copies successful plugin page action results when enabled", async () => {
    pluginRegistryMocks.executePluginAction.mockResolvedValue("2026-08-31");
    pluginRegistryMocks.getInternalPageContribution.mockReturnValue({
      pluginId: "date-calculator-plugin",
      pageAction: {
        actionId: "calculate",
      },
    });
    settingsMocks.settingsApi.get.mockResolvedValue({
      plugins: {
        "date-calculator-plugin": {
          copySuccessfulSearchResults: {
            calculate: true,
          },
        },
      },
    });

    createShortcuts().openActiveItem();

    await vi.waitFor(() => {
      expect(clipboardMocks.copyText).toHaveBeenCalledWith("2026-08-31");
    });
    expect(toastMocks.toast.success).toHaveBeenCalledWith("2026-08-31", {
      copy: true,
    });
  });

  it("does not copy plugin page action results when disabled", async () => {
    pluginRegistryMocks.executePluginAction.mockResolvedValue("2026-08-31");
    pluginRegistryMocks.getInternalPageContribution.mockReturnValue({
      pluginId: "date-calculator-plugin",
      pageAction: {
        actionId: "calculate",
      },
    });
    settingsMocks.settingsApi.get.mockResolvedValue({
      plugins: {},
    });

    createShortcuts().openActiveItem();

    await vi.waitFor(() => {
      expect(toastMocks.toast.success).toHaveBeenCalledWith("2026-08-31", {
        copy: true,
      });
    });
    expect(clipboardMocks.copyText).not.toHaveBeenCalled();
  });
});

const createShortcuts = (
  overrides: Partial<Parameters<typeof createAppShortcuts>[0]> = {},
) =>
  createAppShortcuts({
    LL,
    setSelectedIndex: vi.fn(),
    itemCount: 1,
    pageSize: 10,
    inputRef: { current: null },
    togglePreviewMode: vi.fn(),
    togglePreviewLayout: vi.fn(),
    toggleLauncherLayout: vi.fn(),
    scrollActivePreviewDown: vi.fn(),
    scrollActivePreviewUp: vi.fn(),
    pinCurrentPreview: vi.fn(),
    switchNextPreviewTab: vi.fn(),
    switchPrevPreviewTab: vi.fn(),
    closeActivePreviewTab: vi.fn(),
    getActivePreviewHandle: () => null,
    getActiveItem: () => pluginItem,
    setQuery: vi.fn(),
    getQuery: () => "date calculator > eom(today)",
    switchTargetGroup: vi.fn(),
    openQueryInspector: vi.fn(),
    openItemHelp: vi.fn(),
    openCommandHistory: vi.fn(),
    openDebugPage: vi.fn(),
    openTagCloudPage: vi.fn(),
    openPluginActionPage: vi.fn(),
    openItemInspector: vi.fn(),
    openFileCreator: vi.fn(),
    openActiveFileEditor: vi.fn(),
    recordCommandHistory: vi.fn(),
    ...overrides,
  });
