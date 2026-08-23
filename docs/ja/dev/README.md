# 開発者ドキュメント

このセクションは、Glimpse の実装を変更する人に向けた内部ドキュメントです。

ユーザー向けの挙動、導入手順、検索構文、FAQ は通常の `docs/` を参照してください。ここでは、実装の責務、データフロー、API 契約、運用時の確認項目を扱います。

## ドキュメントの位置づけ

- 公開向けの説明は `docs/` と `docs/ja/` に置きます。
- 英語版の実装方針、内部 API は `docs/dev/` に置きます。
- 日本語版の開発者ドキュメントは `docs/ja/dev/` に置きます。
- 開発者ドキュメントには、公開してよい技術説明だけを残します。

## まず読むもの

1. [アーキテクチャ](./architecture.md): 全体の責務分担と主要フロー。
2. [フロントエンド](./frontend.md): React 側の構成、IPC wrapper、preview、plugin runtime。
3. [バックエンド](./backend.md): Tauri commands、state、永続化、安全境界。
4. [検索](./search.md): query model、SQLite/Tantivy の役割、snippet、整合性。
5. [インデックス作成](./indexing.md): scan、watch、parser dispatch、target group。

## 目的別の置き場所

| 知りたいこと | 参照先 |
| --- | --- |
| 全体設計とデータフロー | [architecture.md](./architecture.md) |
| React component / hook / API wrapper の責務 | [frontend.md](./frontend.md) |
| Tauri command / store / state の責務 | [backend.md](./backend.md) |
| 検索 query、ranking、snippet、Tantivy index | [search.md](./search.md) |
| scan / watch / target group 切り替え | [indexing.md](./indexing.md) |
| Markdown / `.gjson` / metadata parser | [parser.md](./parser.md) |
| 設定モデル、default、watcher、trust | [settings.md](./settings.md) |
| plugin manifest、runtime API、viewer、trust | [plugins.md](./plugins.md) |
| backend log、command log、diagnostics | [logging.md](./logging.md) |

## 更新するタイミング

- IPC command、型、store schema、設定値を変えた。
- 検索、indexing、preview、plugin の挙動を変えた。
- 内部向け manual test に新しい確認項目が必要になった。
- ユーザー向け docs と実装 docs の説明が食い違った。
- 公開に向かない内容が混ざった場合は、公開 docs から外す。

## ソース構成

```text
src/
|-- api/               Tauri IPC のフロントエンドラッパー
|-- components/        共通 React UI
|-- contexts/          React provider
|-- features/          機能別のフロントエンドロジック
|-- hooks/             共通 React hooks
|-- i18n/              生成済み翻訳と手書き翻訳
|-- types/             フロントエンド側のドメイン型
|-- utils/             フロントエンドヘルパー
`-- views/             Internal Page と preview view

src-tauri/src/
|-- commands/          Tauri IPC commands
|-- models/            バックエンド側の共有ドメインモデル
|-- search/            検索エンジンの抽象化と実装
|-- store/             永続化、設定、プラグイン、インデックス作成
|-- utils/             パス、open action、コマンド安全性のヘルパー
`-- lib.rs             Tauri bootstrap
```

## 主要概念

- `IndexItem` はバックエンド、フロントエンド、プラグインで共通して使う検索可能な単位です。
- `Preview` はアイテムの表示方法を表します。Markdown、raw text、external URL、plugin viewer、Internal Page があります。
- `OpenAction` は `Enter` 実行時の動作を表します。external URL、command、plugin action があります。
- Target Group は標準検索とインデックス作成の対象になるファイルシステム範囲を定義します。
- `.gjson` ファイルは 1 つの JSON index file から 0 件以上の検索アイテムを作成します。
- プラグインはローカルのフロントエンド専用 bundle です。Glimpse がコードやスタイルを読み込む前に、ユーザーによる明示的な trust が必要です。

## ドキュメント更新ルール

実装を変更した場合は、次の順で必要なドキュメントを更新します。

1. 変更した API 付近の Rust doc comment または TypeScript comment。
2. `docs/dev` と `docs/ja/dev` の開発者ドキュメント。
3. manual verification や release work に影響する場合は `.private-docs` の運用メモ。
4. `docs/` のユーザー向けドキュメント。
5. 画面上の挙動が変わる場合は `docs/ja` の日本語ユーザー向けドキュメント。
6. ユーザーに見える変更の場合は changelog または release notes。

確認済みの挙動を記述してください。まだ実装されていない案は、意図的な未実装である場合だけ future work として扱います。
