---
title: Metadata Example
aliases:
  - Metadata Demo
  - Example Metadata
  - starred example

tags:
  - example
  - metadata

boost: 10

star: true
hidden: false
---

# Metadata Example

This file demonstrates searchable metadata in Markdown frontmatter.

## Supported Fields

Common fields include:

- `title`: title shown in search results
- `tags`: searchable tags
- `aliases`: alternative searchable names
- `star`: prioritizes the item in search results
- `hidden`: hides the item from standard search
- `boost`: ranking hint
- `open.*`: optional open action

## Try These Searches

Aliases are searchable:

```text
Metadata Demo
```

Tags use `#`:

```text
#example
```

Starred items appear higher in search results:

```text
starred example
```

## Hidden Items

Use `hidden: true` for items that should not appear in normal searches:

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

Search hidden items across all Target Groups with `*!`:

```text
*!private
```

## Glimpse JSON

Use `.gjson` files for Glimpse JSON indexes. Ordinary `.json` files are indexed as raw files.
