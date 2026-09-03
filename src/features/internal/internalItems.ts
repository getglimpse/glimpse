import { IndexItem, SearchResult } from "@/types";
import {
  getPluginInternalItems,
  getPluginPlaygroundInternalItems,
} from "@/features/plugins/pluginRegistry";

const INTERNAL_ITEMS: IndexItem[] = [
  {
    id: "internal://help",
    title: "Help",
    sourcePath: null,
    updatedAt: new Date(0).toISOString(),
    metadata: {
      tags: ["internal", "help", "docs"],
      aliases: ["help", "usage", "使い方", "ヘルプ"],
      star: false,
      boost: 1,
    },
    preview: {
      type: "internal",
      page: "help",
    },
  },
  {
    id: "internal://settings",
    title: "settings",
    sourcePath: null,
    updatedAt: new Date(0).toISOString(),
    metadata: {
      tags: ["internal", "settings", "config"],
      aliases: ["setting", "preferences", "config", "設定"],
      star: false,
      boost: 1,
    },
    preview: {
      type: "internal",
      page: "settings",
    },
  },
  {
    id: "internal://shortcuts",
    title: "shortcuts",
    sourcePath: null,
    updatedAt: new Date(0).toISOString(),
    metadata: {
      tags: ["internal", "shortcuts", "keyboard"],
      aliases: ["shortcut", "keys", "keybindings", "hotkeys", "ショートカット"],
      star: false,
      boost: 1,
    },
    preview: {
      type: "internal",
      page: "shortcuts",
    },
  },
  {
    id: "internal://metadata",
    title: "metadata",
    sourcePath: null,
    updatedAt: new Date(0).toISOString(),
    metadata: {
      tags: ["internal", "metadata", "docs", "gjson", "frontmatter"],
      aliases: [
        "metadata",
        "frontmatter",
        "gjson",
        ".gjson",
        "document metadata",
        "メタデータ",
      ],
      star: false,
      boost: 1,
    },
    preview: {
      type: "internal",
      page: "metadata",
    },
  },
  {
    id: "internal://about",
    title: "about",
    sourcePath: null,
    updatedAt: new Date(0).toISOString(),
    metadata: {
      tags: ["internal", "about", "info"],
      aliases: ["version", "app info", "概要", "情報"],
      star: false,
      boost: 1,
    },
    preview: {
      type: "internal",
      page: "about",
    },
  },
  {
    id: "internal://debug",
    title: "debug",
    sourcePath: null,
    updatedAt: new Date(0).toISOString(),
    metadata: {
      tags: ["internal", "debug", "statistics", "index"],
      aliases: ["statistics", "index", "watch", "統計", "インデックス統計"],
      star: false,
      boost: 1,
    },
    preview: {
      type: "internal",
      page: "debug",
    },
  },
  {
    id: "internal://command-history",
    title: "Command History",
    sourcePath: null,
    updatedAt: new Date(0).toISOString(),
    metadata: {
      tags: ["internal", "command", "history", "log"],
      aliases: [
        "command-history",
        "commands",
        "command log",
        "コマンド履歴",
        "履歴",
      ],
      star: false,
      boost: 1,
    },
    preview: {
      type: "internal",
      page: "command-history",
    },
  },
  {
    id: "internal://tag-cloud",
    title: "Tag Cloud",
    sourcePath: null,
    updatedAt: new Date(0).toISOString(),
    metadata: {
      tags: ["internal", "tag", "tags", "cloud"],
      aliases: ["tag cloud", "tags", "metadata", "taxonomy"],
      star: false,
      boost: 1,
    },
    preview: {
      type: "internal",
      page: "tag-cloud",
    },
  },
  {
    id: "internal://plugin",
    title: "Plugin Page",
    sourcePath: null,
    updatedAt: new Date(0).toISOString(),
    metadata: {
      tags: ["internal", "plugin", "extension", "feature-page"],
      aliases: [
        "plugins",
        "extension",
        "extensions",
        "capability",
        "capabilities",
        "feature page",
        "プラグイン",
        "拡張機能",
        "機能ページ",
      ],
      star: false,
      boost: 1,
    },
    preview: {
      type: "internal",
      page: "plugin",
    },
  },
];

export const HELP_ITEM = INTERNAL_ITEMS.find(
  (item) => item.id === "internal://help",
)!;

export const METADATA_HELP_ITEM = INTERNAL_ITEMS.find(
  (item) => item.id === "internal://metadata",
)!;

export const COMMAND_HISTORY_ITEM = INTERNAL_ITEMS.find(
  (item) => item.id === "internal://command-history",
)!;

export const DEBUG_ITEM = INTERNAL_ITEMS.find(
  (item) => item.id === "internal://debug",
)!;

export const TAG_CLOUD_ITEM = INTERNAL_ITEMS.find(
  (item) => item.id === "internal://tag-cloud",
)!;

const getInternalItems = () => [
  ...INTERNAL_ITEMS,
  ...getPluginInternalItems(),
];

type InternalSearchScope = "all" | "pluginPlaygrounds";

const getInternalSearchScope = (query: string): InternalSearchScope => {
  const trimmed = query.trimStart();

  if (trimmed.startsWith("/")) {
    return "pluginPlaygrounds";
  }

  return "all";
};

const getItemsForScope = (scope: InternalSearchScope): IndexItem[] => {
  switch (scope) {
    case "pluginPlaygrounds":
      return getPluginPlaygroundInternalItems();
    case "all":
      return getInternalItems();
  }
};

export const searchInternalItems = (query: string): SearchResult[] => {
  const scope = getInternalSearchScope(query);
  const normalized = query.trim().replace(/^[:/]/, "").trim().toLowerCase();
  const internalItems = getItemsForScope(scope);

  if (!normalized) {
    return internalItems.map((item) => ({
      item,
      score: 0,
    }));
  }

  return internalItems
    .filter((item) => {
      const haystack = [
        item.title,
        ...item.metadata.tags,
        ...item.metadata.aliases,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalized);
    })
    .map((item) => ({
      item,
      score: 0,
    }));
};
