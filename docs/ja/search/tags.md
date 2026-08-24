# Tag Search

Tag Search は、Metadata に設定されたタグを利用して、検索結果を絞り込む機能です。

大量のドキュメントを管理している場合でも、カテゴリごとに目的のドキュメントを見つけやすくなります。

## タグを設定する

Markdown の Frontmatter に `tags` を記述します。

```yaml
---
title: Rust

tags:
  - rust
  - programming
  - systems
---

# Rust

Rust is a systems programming language.
```

1つのドキュメントには、複数のタグを設定できます。

## 通常検索

タグは通常の検索対象にも含まれます。

例えば、

```text
rust
```

と検索すると、

* タイトル
* エイリアス
* 本文
* タグ

が検索対象になります。

そのため、

```yaml
---
tags:
  - rust
---
```

が設定されているドキュメントは、通常検索でも検索結果に表示されます。

## Tag Search

タグだけを対象に検索する場合は、先頭に `#` を付けます。

```text
#rust
```

例えば、

```yaml
---
tags:
  - rust
---
```

が設定されているドキュメントだけが検索結果に表示されます。

### 例

次のドキュメントがあるとします。

```yaml
---
title: Rust Book
tags:
  - rust
  - study
---
```

```yaml
---
title: Rust API
tags:
  - rust
  - work
---
```

```yaml
---
title: Meeting Notes
tags:
  - work
---
```

```text
#rust
```

検索結果:

```text
Rust Book
Rust API
```

```text
#work
```

検索結果:

```text
Rust API
Meeting Notes
```

## 通常検索との違い

| 入力      | 動作                      |
| ------- | ----------------------- |
| `rust`  | タイトル、本文、タグ、エイリアスを検索     |
| `#rust` | `rust` タグを持つドキュメントだけを表示 |

## タグの活用例

### 用途ごとに分類する

```yaml
tags:
  - work
```

```yaml
tags:
  - personal
```

```yaml
tags:
  - study
```

### 技術ごとに分類する

```yaml
tags:
  - rust
```

```yaml
tags:
  - react
```

```yaml
tags:
  - tauri
```

### 状態を管理する

```yaml
tags:
  - todo
```

```yaml
tags:
  - draft
```

```yaml
tags:
  - archive
```

## Target Groups

Tag Search は、現在アクティブな Target Group を対象に実行されます。

例えば、現在の Target Group が **Work** の場合、

```text
#rust
```

は Work グループ内の `rust` タグを持つドキュメントだけを検索します。

他の Target Group を検索したい場合は、Target Group を切り替えてください。

## まとめ

通常検索では、タイトルや本文だけでなくタグも検索対象になります。

一方、Tag Search はタグを持つドキュメントだけを対象とするため、カテゴリごとに検索結果を絞り込みたい場合に利用できます。
