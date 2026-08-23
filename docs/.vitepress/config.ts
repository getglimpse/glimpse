import { defineConfig } from "vitepress";

const introduction = [
  { text: "What Is Glimpse?", link: "/overview" },
  { text: "Installation", link: "/intro/installation" },
  { text: "First Launch and Workspace", link: "/intro/getting-started" },
  { text: "Quick Start", link: "/intro/quick-start" },
  { text: "Search Basics", link: "/intro/search" },
];

const development = [
  { text: "Developer Overview", link: "/dev/README" },
  { text: "Architecture", link: "/dev/architecture" },
  { text: "Frontend", link: "/dev/frontend" },
  { text: "Backend", link: "/dev/backend" },
  { text: "Search Architecture", link: "/dev/search" },
  { text: "Indexing", link: "/dev/indexing" },
  { text: "Parser", link: "/dev/parser" },
  { text: "Settings Architecture", link: "/dev/settings" },
  { text: "Plugin Architecture", link: "/dev/plugins" },
  { text: "Logging", link: "/dev/logging" },
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

const jaDevelopment = [
  { text: "開発者ドキュメント", link: "/ja/dev/README" },
  { text: "アーキテクチャ", link: "/ja/dev/architecture" },
  { text: "フロントエンド", link: "/ja/dev/frontend" },
  { text: "バックエンド", link: "/ja/dev/backend" },
  { text: "検索アーキテクチャ", link: "/ja/dev/search" },
  { text: "インデックス作成", link: "/ja/dev/indexing" },
  { text: "パーサー", link: "/ja/dev/parser" },
  { text: "設定アーキテクチャ", link: "/ja/dev/settings" },
  { text: "プラグインアーキテクチャ", link: "/ja/dev/plugins" },
  { text: "ログ", link: "/ja/dev/logging" },
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

const jaOthers = [
  { text: "FAQ", link: "/ja/others/faq" },
  { text: "Changelog", link: "/ja/others/changelog" },
  { text: "Roadmap", link: "/ja/others/roadmap" },
];

export default defineConfig({
  title: "Glimpse",
  description: "Fast local search with instant preview.",
  base: "/glimpse/",
  srcExclude: ["private/**"],
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      themeConfig: {
        nav: [
          { text: "Roadmap", link: "/others/roadmap" },
          { text: "Changelog", link: "/others/changelog" },
          { text: "GitHub", link: "https://github.com/cromon-code/glimpse" },
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
          { text: "GitHub", link: "https://github.com/cromon-code/glimpse" },
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
        { text: "開発者ガイド", items: jaDevelopment },
        { text: "その他", items: jaOthers },
      ],
      "/": [
        { text: "Introduction", items: introduction },
        { text: "Search", items: search },
        { text: "Preview", items: preview },
        { text: "Documents", items: documents },
        { text: "Internal Pages", items: internalPages },
        { text: "Developer Guide", items: development },
        { text: "Others", items: others },
      ],
    },
  },
});
