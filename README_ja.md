# Glimpse

[English](README.md)

[![Release](https://img.shields.io/github/v/release/cromon-code/glimpse?display_name=tag)](https://github.com/cromon-code/glimpse/releases)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4CAF50)](#対応プラットフォーム)
[![Status](https://img.shields.io/badge/Status-Beta-orange)](https://github.com/cromon-code/glimpse)

> ローカルの情報へ、すばやくアクセスするための検索ランチャー。

Glimpse は、ローカルにある知識をすばやく検索、プレビュー、オープンするためのキーボードファーストなデスクトップランチャーです。

Markdown、Glimpse JSON インデックス (`.gjson`)、リンク、コマンド、Internal Page、プラグイン提供ツールを 1 つの検索ボックスから扱えます。作業メモ、プロジェクト資料、スニペット、ブックマーク、コマンド集を自分のマシンに置いて管理している人向けに作っています。

## ステータス

Glimpse は現在 beta 版です。

基本的な検索とプレビューの流れは利用できますが、一部の機能、設定、対応ファイル形式、プラグイン API は今後変更される可能性があります。重要なファイルはバックアップしたうえで利用してください。

## 主な機能

- 高速なインクリメンタルローカル検索
- Markdown、Glimpse JSON、画像、Raw file のライブプレビュー
- 複数の検索結果を開いておけるプレビュータブ
- frontmatter メタデータ対応 (`title`, `tags`, `aliases`, `star`, `hidden`, `url`, `command`)
- 絞り込みしやすい検索クエリ構文
- キーボード中心の操作
- 複数フォルダを検索対象にできる Target Group
- Settings、Help、Shortcuts、診断、プラグイン管理などの組み込み Internal Page
- カスタム CSS テーマ
- 明示的な信頼確認を備えたローカルプラグイン機構

## 向いている用途

Glimpse は次のような用途に向いています。

- Markdown ノートや Obsidian vault をすばやく検索する
- エディタを開かずに作業ドキュメントを確認する
- よく使うファイル、リンク、コマンド集をすぐ開く
- プロジェクトメモ、スニペット、軽量なナレッジベースを検索可能にする
- ローカルプラグインでランチャーを拡張する

Glimpse は大規模なナレッジマネジメントスイートを目指していません。目的はシンプルです。必要な情報へできるだけ速く到達できるようにすることです。

## インストール

最新ビルドは [Releases](https://github.com/cromon-code/glimpse/releases) からダウンロードできます。

### 対応プラットフォーム

Glimpse は Windows、macOS、Linux で動作するように設計しています。

動作確認済み:

- [x] Windows 11
- [x] Fedora Linux
- [ ] macOS は予定していますが、まだ十分に検証していません

## クイックスタート

1. Glimpse を起動します。
2. `Documents/Notes`、`Documents/Projects`、Obsidian vault などのフォルダを検索対象に追加します。
3. 検索ボックスに入力します。
4. 検索結果を選ぶと、すぐにプレビューされます。
5. `Ctrl + T` で現在のプレビューをタブとして保持できます。
6. `:settings`、`:help`、`:plugin` のような Internal Page クエリで組み込みページを開けます。
7. `numeric calculator > 1 + 2` のように `>` を付けると、選択したコマンドやプラグインページアクションへ引数を渡せます。

詳しくは [Quick Start](docs/ja/intro/quick-start.md) を参照してください。

## プラグイン

Glimpse はローカルのフロントエンド専用プラグインに対応しています。

プラグインは Internal Page、Action、Viewer を追加できます。プラグインは自動では読み込まれません。インストール後、Glimpse がコードを実行する前にユーザーが信頼する必要があります。

サンプルプラグインは [plugins](plugins) ディレクトリにあります。

- Numeric calculator
- Date calculator
- Unit converter
- PDF viewer
- CSV viewer
- Office documents viewer

詳細は [プラグインドキュメント](docs/ja/dev/plugins.md) を参照してください。

## ドキュメント

- [Glimpse とは](docs/ja/overview.md)
- [Quick Start](docs/ja/intro/quick-start.md)
- [Search](docs/ja/intro/search.md)
- [Preview](docs/ja/preview/overview.md)
- [Settings](docs/ja/internal/settings.md)
- [Roadmap](docs/ja/others/roadmap.md)
- [FAQ](docs/ja/others/faq.md)

英語ドキュメントは [docs](docs) にあります。

## 開発

必要なもの:

- Node.js
- pnpm
- Rust
- 各プラットフォーム向けの Tauri 前提環境

依存関係をインストール:

```sh
pnpm install
```

フロントエンド開発サーバーを起動:

```sh
pnpm dev
```

Tauri アプリとして起動:

```sh
pnpm tauri dev
```

ビルドとテスト:

```sh
pnpm build
pnpm test
cargo check --manifest-path src-tauri/Cargo.toml
```

## ロードマップ

今後の予定:

- Trash / Restore ワークフロー
- 検索ランキングとメタデータ処理の改善
- Audio、Video、PDF、Office documents などのプレビュー改善
- プラグイン配布と更新フロー
- カスタム Viewer、Parser、Indexing 向けの拡張ポイント

詳しくは [roadmap](docs/ja/others/roadmap.md) を参照してください。

## コントリビューション

バグ報告、機能要望、Pull Request は GitHub Issues および Pull Requests で受け付けています。

Glimpse が有用だと感じた場合は、リポジトリへの star が開発継続とプロジェクトの周知に役立ちます。

## サポート

Glimpse が役に立ったと感じたら、開発を支援できます。

[Buy Me a Coffee](https://www.buymeacoffee.com/cromon)

## ライセンス

Glimpse は MIT License のもとで公開されています。詳しくは [LICENSE](LICENSE) を参照してください。
