# Raw Preview

Raw Preview は、ファイル内容をレンダリングせず、そのまま表示するプレビューモードです。

Markdown frontmatter、Markdown 記法、`.gjson` データ、その他 raw text を確認したい場合に使います。

## Markdown の例

```md
---
title: Rust
tags:
  - rust
aliases:
  - rs
---

# Rust

Rust is a systems programming language.
```

Markdown Preview では本文がレンダリングされますが、Raw Preview では frontmatter を含めて元の内容がそのまま表示されます。

## メタデータ確認

```yaml
---
title: Git
open.type: command
open.path: git
---
```

メタデータを直接確認したい場合に便利です。

## `.gjson` の例

```json
{
  "items": [
    {
      "title": "GitHub",
      "desc": "Source code hosting service",
      "url": "https://github.com"
    }
  ]
}
```

`.gjson` も元の JSON テキストとして確認できます。

## Preview Tabs

Raw Preview も `Ctrl + T` で Preview Tab に固定できます。
