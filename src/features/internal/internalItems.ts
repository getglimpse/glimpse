import { IndexItem, SearchResult } from "@/types";
import { getPluginInternalItems } from "@/features/plugins/registry";

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
    title: "Plugins",
    sourcePath: null,
    updatedAt: new Date(0).toISOString(),
    metadata: {
      tags: ["internal", "plugin", "plugins", "extension"],
      aliases: [
        "plugins",
        "extension",
        "extensions",
        "installed plugins",
        "plugin management",
        "プラグイン",
        "拡張機能",
        "インストール済みプラグイン",
      ],
      star: false,
      boost: 1,
    },
    preview: {
      type: "internal",
      page: "plugin",
    },
  },
  {
    id: "internal://plugin-store",
    title: "Plugin Store",
    sourcePath: null,
    updatedAt: new Date(0).toISOString(),
    metadata: {
      tags: ["internal", "plugin", "plugins", "store", "remote"],
      aliases: [
        "remote plugins",
        "plugin registry",
        "plugin store",
        "install plugins",
        "リモートプラグイン",
        "プラグインストア",
        "プラグインをインストール",
      ],
      star: false,
      boost: 1,
    },
    preview: {
      type: "internal",
      page: "plugin-store",
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

let cachedPluginItems: IndexItem[] | null = null;
let cachedInternalItems: IndexItem[] = INTERNAL_ITEMS;

const getInternalItems = () => {
  const pluginItems = getPluginInternalItems();

  if (pluginItems !== cachedPluginItems) {
    cachedPluginItems = pluginItems;
    cachedInternalItems = [...INTERNAL_ITEMS, ...pluginItems];
  }

  return cachedInternalItems;
};

type InternalSearchScope = "all" | "plugins";

const getInternalSearchScope = (query: string): InternalSearchScope => {
  const trimmed = query.trimStart();

  if (trimmed.startsWith("/")) {
    return "plugins";
  }

  return "all";
};

const getItemsForScope = (scope: InternalSearchScope): IndexItem[] => {
  switch (scope) {
    case "plugins":
      return getPluginInternalItems();
    case "all":
      return getInternalItems();
  }
};

type NormalizedInternalItem = {
  title: string;
  aliases: string[];
  tags: string[];
};

const normalizedItemCache = new WeakMap<IndexItem, NormalizedInternalItem>();
const emptySearchResultsCache = new WeakMap<IndexItem[], SearchResult[]>();

const getNormalizedInternalItem = (item: IndexItem) => {
  const cached = normalizedItemCache.get(item);

  if (cached) return cached;

  const normalized = {
    title: item.title.toLowerCase(),
    aliases: item.metadata.aliases.map((alias) => alias.toLowerCase()),
    tags: item.metadata.tags.map((tag) => tag.toLowerCase()),
  };
  normalizedItemCache.set(item, normalized);

  return normalized;
};

const getInternalSearchScore = (item: IndexItem, normalizedQuery: string) => {
  const normalizedItem = getNormalizedInternalItem(item);

  if (normalizedItem.title.includes(normalizedQuery)) {
    return 3;
  }

  if (normalizedItem.aliases.some((alias) => alias.includes(normalizedQuery))) {
    return 2;
  }

  if (normalizedItem.tags.some((tag) => tag.includes(normalizedQuery))) {
    return 1;
  }

  return 0;
};

export const searchInternalItems = (
  query: string,
  requiredTags: string[] = [],
): SearchResult[] => {
  const scope = getInternalSearchScope(query);
  const normalized = query.trim().replace(/^[:/]/, "").trim().toLowerCase();
  const normalizedRequiredTags = requiredTags.map((tag) => tag.toLowerCase());
  const scopedItems = getItemsForScope(scope);
  const internalItems =
    normalizedRequiredTags.length === 0
      ? scopedItems
      : scopedItems.filter((item) => {
          const itemTags = getNormalizedInternalItem(item).tags;

          return normalizedRequiredTags.every((requiredTag) =>
            itemTags.some((itemTag) => itemTag.startsWith(requiredTag)),
          );
        });

  if (!normalized) {
    if (normalizedRequiredTags.length > 0) {
      return internalItems.map((item) => ({ item, score: 0 }));
    }

    const cached = emptySearchResultsCache.get(internalItems);

    if (cached) return cached;

    const results = internalItems.map((item) => ({ item, score: 0 }));
    emptySearchResultsCache.set(internalItems, results);

    return results;
  }

  const rankedResults: SearchResult[][] = [[], [], [], []];

  for (const item of internalItems) {
    const score = getInternalSearchScore(item, normalized);

    if (score > 0) rankedResults[score].push({ item, score });
  }

  return [...rankedResults[3], ...rankedResults[2], ...rankedResults[1]];
};
