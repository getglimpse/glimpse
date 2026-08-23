# Markdown Preview

Glimpse では、Markdown ファイルをアプリ内で直接プレビューできます。

検索結果を選択すると、Preview が自動的に更新されるため、ファイルをエディターで開かなくても内容を確認できます。

## Live Preview

検索結果を上下キーで移動すると、

```text
Search Results       Preview

Rust          →      Rust.md

Markdown      →      Markdown.md

Commands      →      Commands.md
```

のように、Preview がリアルタイムで切り替わります。

`Enter` を押してファイルを開く必要はありません。

## 対応している Markdown

Glimpse は、一般的な Markdown 記法に対応しています。

### 見出し

```md
# Heading 1

## Heading 2

### Heading 3
```

見出しの階層を維持して表示されます。

### リスト

```md
- Apple
- Orange
- Banana
```

番号付きリストも利用できます。

```md
1. First
2. Second
3. Third
```

### 引用

```md
> This is quote.
```

引用として表示されます。

### テーブル

```md
| Name | Language |
|------|----------|
| Rust | Systems |
| Python | Script |
```

テーブルとして整形表示されます。

### インラインコード

```md
Use `cargo build`.
```

文中のコードを強調表示します。

### コードブロック

````md
```rust
fn main() {
    println!("Hello");
}
```
````

シンタックスハイライト付きで表示されます。

### 画像

Markdown の画像も表示できます。

```md
![sample](sample.png)
```

画像ファイルが存在する場合は、Preview 内に表示されます。

## Metadata

Markdown の Frontmatter は検索に利用されますが、Markdown Preview には表示されません。

例えば、

```yaml
---
title: Rust
tags:
  - rust

aliases:
  - rs
---

# Rust
```

Preview に表示されるのは、

```md
# Rust
```

以降の本文だけです。

Metadata を確認したい場合は、**Raw Preview** を利用してください。

## Markdown Preview と Raw Preview

| Preview          | 表示内容             |
| ---------------- | ---------------- |
| Markdown Preview | Markdown を整形して表示 |
| Raw Preview      | 元のテキストをそのまま表示    |

例えば、

```yaml
---
title: Rust
---

# Rust
```

Markdown Preview では、

```text
Rust
```

のように整形して表示されます。

一方、Raw Preview では Frontmatter を含めた元の Markdown がそのまま表示されます。

## Preview Tabs

現在表示している Preview は、`Ctrl + T` を押すことで Preview Tab として保持できます。

保持した Preview は、検索結果を変更しても表示されたままになります。

## まとめ

Markdown Preview は、検索結果の内容をすぐに確認するための標準プレビューです。

必要に応じて Preview Tabs や Raw Preview を組み合わせることで、複数のドキュメントを参照したり、Markdown の元データを確認したりできます。
