# Raw Preview

Raw Preview displays file contents without rendering or formatting.

Use it when you want to inspect the original source text, such as Markdown frontmatter, Markdown syntax, `.gjson` data, or other raw text.

## Markdown Example

Given:

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

Markdown Preview renders the document body. Raw Preview shows the file exactly as written, including frontmatter.

## Metadata Example

```yaml
---
title: Git
command: git
---
```

Raw Preview is useful when you need to check metadata fields directly.

## Glimpse JSON Example

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

Raw Preview shows `.gjson` files exactly as written.

## Preview Tabs

Like Markdown Preview, Raw Preview can be pinned as a Preview Tab with `Ctrl + T`.
