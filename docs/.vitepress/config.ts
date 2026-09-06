import { defineConfig } from "vitepress";

const introduction = [
  { text: "What Is Glimpse?", link: "/overview" },
  { text: "Installation", link: "/intro/installation" },
  { text: "First Launch and Workspace", link: "/intro/getting-started" },
  { text: "Quick Start", link: "/intro/quick-start" },
  { text: "Search Basics", link: "/intro/search" },
];

const search = [
  { text: "Query Syntax", link: "/search/syntax" },
  { text: "Target Groups", link: "/search/groups" },
  { text: "Tag Search", link: "/search/tags" },
];

const preview = [
  { text: "Overview", link: "/preview/overview" },
  { text: "Markdown Preview", link: "/preview/markdown" },
  { text: "Raw Preview", link: "/preview/raw" },
];

const documents = [
  { text: "Overview", link: "/documents/overview" },
  { text: "Metadata", link: "/documents/metadata" },
  { text: "Commands", link: "/documents/command" },
];

const internalPages = [
  { text: "Internal Pages", link: "/internal/overview" },
  { text: "Settings", link: "/internal/settings" },
];

const plugins = [
  { text: "Plugins", link: "/plugins" },
];

const others = [
  { text: "FAQ", link: "/others/faq" },
  { text: "Changelog", link: "/others/changelog" },
  { text: "Roadmap", link: "/others/roadmap" },
];

const jaIntroduction = [
  { text: "Glimpse とは", link: "/ja/overview" },
  { text: "インストール", link: "/ja/intro/installation" },
  { text: "初回起動とワークスペース", link: "/ja/intro/getting-started" },
  { text: "クイックスタート", link: "/ja/intro/quick-start" },
  { text: "検索の基本", link: "/ja/intro/search" },
];

const jaSearch = [
  { text: "クエリ構文", link: "/ja/search/syntax" },
  { text: "Target Groups", link: "/ja/search/groups" },
  { text: "タグ検索", link: "/ja/search/tags" },
];

const jaPreview = [
  { text: "概要", link: "/ja/preview/overview" },
  { text: "Markdown Preview", link: "/ja/preview/markdown" },
  { text: "Raw Preview", link: "/ja/preview/raw" },
];

const jaDocuments = [
  { text: "概要", link: "/ja/documents/overview" },
  { text: "メタデータ", link: "/ja/documents/metadata" },
  { text: "コマンド", link: "/ja/documents/command" },
];

const jaInternalPages = [
  { text: "Internal Pages", link: "/ja/internal/overview" },
  { text: "設定", link: "/ja/internal/settings" },
];

const jaPlugins = [
  { text: "プラグイン", link: "/ja/plugins" },
];

const jaOthers = [
  { text: "FAQ", link: "/ja/others/faq" },
  { text: "Changelog", link: "/ja/others/changelog" },
  { text: "Roadmap", link: "/ja/others/roadmap" },
];

export default defineConfig({
  title: "Glimpse",
  description: "Fast local search with instant preview.",
  base: "/glimpse/",
  srcExclude: ["private/**", "dev/**", "ja/dev/**"],
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      themeConfig: {
        nav: [
          { text: "Roadmap", link: "/others/roadmap" },
          { text: "Changelog", link: "/others/changelog" },
          { text: "GitHub", link: "https://github.com/getglimpse/glimpse" },
        ],
      },
    },
    ja: {
      label: "日本語",
      lang: "ja-JP",
      link: "/ja/",
      themeConfig: {
        nav: [
          { text: "Roadmap", link: "/ja/others/roadmap" },
          { text: "Changelog", link: "/ja/others/changelog" },
          { text: "GitHub", link: "https://github.com/getglimpse/glimpse" },
        ],
      },
    },
  },

  themeConfig: {
    sidebar: {
      "/ja/": [
        { text: "はじめに", items: jaIntroduction },
        { text: "検索", items: jaSearch },
        { text: "プレビュー", items: jaPreview },
        { text: "ドキュメント", items: jaDocuments },
        { text: "内部ページ", items: jaInternalPages },
        { text: "プラグイン", items: jaPlugins },
        { text: "その他", items: jaOthers },
      ],
      "/": [
        { text: "Introduction", items: introduction },
        { text: "Search", items: search },
        { text: "Preview", items: preview },
        { text: "Documents", items: documents },
        { text: "Internal Pages", items: internalPages },
        { text: "Plugins", items: plugins },
        { text: "Others", items: others },
      ],
    },
  },
});
