# Metadata

Metadata controls how Glimpse displays, searches, filters, and opens indexed items.

Markdown files use frontmatter. Glimpse JSON index files (`.gjson`) define metadata on each item.

## Supported Fields

### Markdown Frontmatter

| Field       | Description                                  |
| ----------- | -------------------------------------------- |
| `title`     | Title shown in search results                 |
| `tags`      | Tags used for search and filtering            |
| `aliases`   | Alternative searchable names                  |
| `star`      | Prioritizes the item in search results         |
| `hidden`    | Hides the item from standard search results    |
| `open.type` | Optional open action type: `external` or `command` |
| `open.url`  | URL used when `open.type` is `external`        |
| `open.path` | Executable path used when `open.type` is `command` |

### Glimpse JSON (`.gjson`)

| Field      | Description                                  |
| ---------- | -------------------------------------------- |
| `title`    | Required title shown in search results        |
| `url`      | Optional external URL                         |
| `desc`     | Optional searchable preview text              |
| `iframe`   | Whether `url` should be shown as an iframe preview |
| `metadata` | Tags, aliases, star, hidden, and boost values |
| `open`     | Optional open action override                 |

## Markdown Example

```yaml
---
title: Rust Notes
tags:
  - rust
  - programming
aliases:
  - rs
star: true
---

# Rust

Rust is a systems programming language.
```

## Glimpse JSON Example

```json
{
  "items": [
    {
      "title": "Rust Book",
      "url": "https://doc.rust-lang.org/book/",
      "desc": "Official Rust book",
      "iframe": true,
      "metadata": {
        "tags": ["rust", "docs"],
        "aliases": ["book", "rustbook"],
        "star": true,
        "hidden": false,
        "boost": 1.5
      }
    }
  ]
}
```

Only files with the `.gjson` extension are parsed as Glimpse JSON indexes. Ordinary `.json` files are indexed as raw files.

## Hidden Items

Items with `hidden: true` are excluded from standard search results.

```yaml
---
title: Private Note
hidden: true
---
```

Search hidden items with `!`:

```text
!private
```

Use `*!private` to search hidden items across all Target Groups.

## Open Actions

Open actions let an item do something different when you press `Enter`.

### External URL

```yaml
---
title: Rust Website
open.type: external
open.url: https://www.rust-lang.org
---
```

### Command

```yaml
---
title: Git
open.type: command
open.path: git
---
```

Command execution is subject to Glimpse security settings.

## Summary

Use Markdown frontmatter for note-level metadata. Use `.gjson` files when one file should create multiple searchable items such as bookmarks, tools, links, or command launchers.
