# Metadata

Metadata controls how Glimpse displays, searches, filters, and opens indexed items.

Markdown files use frontmatter. Glimpse JSON index files (`.gjson`) define metadata on each item.

## Markdown Fields

| Field       | Description                                  |
| ----------- | -------------------------------------------- |
| `title`     | Title shown in search results                 |
| `tags`      | Tags used for search and filtering; string or array |
| `aliases`   | Alternative searchable names; string or array |
| `star`      | Prioritizes the item in search results         |
| `hidden`    | Hides the item from standard search results    |
| `desc` / `description` | Searchable description text        |
| `url`       | Optional HTTP/HTTPS URL associated with the item |
| `iframe`    | Whether `url` should be shown as an iframe preview |
| `command`   | Optional command associated with the item      |
| `defaultAction` | Optional default Enter action: `command` or `url` |

## Markdown Example

```yaml
---
title: Rust Notes
tags: ["rust", "programming"]
aliases: rs
star: true
---

# Rust

Rust is a systems programming language.
```

## Glimpse JSON Fields

| Field      | Description                                  |
| ---------- | -------------------------------------------- |
| `title`    | Required title shown in search results        |
| `url`      | Optional external URL                         |
| `desc` / `description` | Optional searchable preview text; `description` wins |
| `iframe`   | Whether `url` should be shown as an iframe preview |
| `tags`     | Tags used for search and filtering; string or array |
| `aliases`  | Alternative searchable names; string or array |
| `star`     | Prioritizes the item in search results        |
| `hidden`   | Hides the item from standard search results   |
| `boost`    | Search ranking multiplier                     |
| `command`  | Optional command associated with the item     |
| `defaultAction` | Optional default Enter action: `command` or `url` |

## Glimpse JSON Example

```json
{
  "items": [
    {
      "title": "Rust Book",
      "url": "https://doc.rust-lang.org/book/",
      "desc": "Official Rust book",
      "iframe": true,
      "tags": ["rust", "docs"],
      "aliases": "rustbook",
      "star": true,
      "hidden": false,
      "boost": 1.5
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

## Actions

Actions let an item open a URL or run a command when you press `Enter`.

### External URL

```yaml
---
title: Rust Website
url: https://www.rust-lang.org
---
```

### Command

```yaml
---
title: Git
command: git
---
```

Command execution is subject to Glimpse security settings.

When both `url` and `command` are present, `Enter` runs `command` by default.
Set `defaultAction: url` to prefer opening the URL.

## Summary

Use Markdown frontmatter for note-level metadata. Use `.gjson` files when one file should create multiple searchable items such as bookmarks, tools, links, or command launchers.
