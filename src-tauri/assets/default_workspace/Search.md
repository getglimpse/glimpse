---
tags:
  - example
  - search
aliases:
  - query syntax
  - search examples
---

# Search Examples

Try these searches in Glimpse.

## Standard Search

```text
markdown
```

Search matches titles, document content, tags, aliases, and other indexed text.

## Tag Search

```text
#example
```

## Global Search

Search all Target Groups instead of only the current one:

```text
*markdown
```

## Hidden Search

Search items marked with `hidden: true`:

```text
!private
```

Search hidden items across all Target Groups:

```text
*!private
```

## Internal Pages

```text
:help
:settings
:history
:plugin
```

Internal Pages appear in search results and open in Preview.

## Plugin Pages and Actions

Trusted plugins can add pages, actions, and viewers. Search plugin pages with `:` or plugin playground pages with `/`:

```text
:plugin
/calculator
```

Use `>` to pass arguments to supported pages and commands:

```text
numeric calculator > 1 + 2
```
