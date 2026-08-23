# Roadmap

このページでは、Glimpse の今後の開発予定を紹介します。

Roadmap に記載されている内容は、開発状況や優先度に応じて変更・延期・削除される場合があります。

## Development Philosophy

Glimpse は、「必要な情報へ最短で到達する」ことを最優先に開発しています。

新しい機能を追加する場合でも、

- 高速な検索
- ライブプレビュー
- シンプルな操作
- キーボード中心のワークフロー

を維持することを重視しています。

## Next

比較的早い段階で実装を検討している改善です。

### Search Improvements

検索体験をさらに改善します。

予定:

- 複数タグを使った検索ワークフローの改善
- 検索順位の改善
- Metadata を利用した ranking / filtering の改善
- Recent Searches
- tags / Target Groups / hidden item 向けの Search Presets
- 検索・インデックス診断の改善

### Plugin Workflow Improvements

ローカルプラグインを扱いやすくします。

予定:

- local `.glimpse-plugin.zip` install
- Plugin update flow
- Plugin reload / replacement flow の改善
- trust 状態や互換性の表示改善

## Planned

中長期的に検討している改善です。

### Preview Improvements

Preview で扱える体験を改善します。

今後の候補:

- 画像 preview の改善
- 音声 / 動画 preview の改善
- PDF viewer の改善
- より多くの plugin viewer

### Item Organization

検索結果を整理しやすくするための機能を検討します。

今後の候補:

- Starred / pinned items の管理
- hidden item の管理
- ignore / exclude した item の一覧
- archived item
- hidden / archived item の復元

Glimpse はファイル管理アプリではないため、元ファイルの削除・復元を中心にした Trash 機能は優先しません。

### Metadata Improvements

Metadata を拡張し、検索や整理をより柔軟にします。

今後の候補:

```yaml
---
title:
description:
tags:
aliases:
icon:
category:
---
```

### Plugins and Extensions

今後は Plugin の配布、互換性、より深い拡張ポイントを中心に検討します。

今後の候補:

- Remote extension store
- Plugin hot reload
- custom parser / search / indexing extension 向け API

## Low Priority

現在は優先度が低い機能です。

- 専用 Bookmark Manager
- 従来型の Saved Searches
- 元ファイルを対象にした Trash / recycle bin
- Cross-device sync
- Cloud-backed workspaces
- Advanced collaboration features

## Guiding Principle

今後も Glimpse は、

```text
Search
↓
Preview
↓
Ctrl + T
↓
Search Again
```

というワークフローを中心に改善を続けます。

高速な検索とライブプレビューを維持しながら、必要な機能を少しずつ追加していきます。
