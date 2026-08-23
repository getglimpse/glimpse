# クイックスタート

このページでは、Markdown ファイルを作成し、検索、プレビュー、Preview Tabs、Internal Pages を試します。

## 1. Markdown ファイルを作成する

ワークスペースに次のファイルを作成します。

```text
~/Documents/Glimpse/Rust.md
```

内容:

```md
---
tags:
  - rust
  - programming
aliases:
  - rs
---

# Rust

Rust is a systems programming language.
```

保存すると、Glimpse は自動でインデックスを更新します。

## 2. 検索する

検索ボックスに入力します。

```text
rust
```

`Rust` ドキュメントが検索結果に表示されます。`rs` でも aliases によって検索できます。

## 3. プレビューする

検索結果を選択すると、Preview パネルに内容が表示されます。

`Enter` を押して外部エディタを開く前に、内容を確認できます。

## 4. Preview Tab に固定する

現在の Preview を保持するには、次を押します。

```text
Ctrl + T
```

## 5. Internal Pages を開く

Internal Pages は `:` で検索します。

```text
:settings
:help
:plugin
```

プラグイン提供の計算ページに引数を渡す場合:

```text
numeric calculator > 1 + 2
```

## 6. Target Group を使う

`Documents/Notes`、`Documents/Projects`、Obsidian vault などを Target Group に追加すると、複数のフォルダーをまとめて検索できます。

`.gjson` ファイルを追加すると、ブックマークやコマンド集のような複数アイテムも検索対象にできます。
