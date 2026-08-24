# Running Commands

Glimpse can turn searchable items into command launchers by setting `command`.

Command items appear in search results like any other document. When you select one and press `Enter`, Glimpse executes the configured command if it is allowed by the command security settings.

## Markdown Command Item

```yaml
---
title: Git
tags:
  - command
  - dev
aliases:
  - git cli
command: git
---

# Git
```

Search for `Git`, select the item, and press `Enter` to run:

```bash
git
```

## Glimpse JSON Command Item

```json
{
  "items": [
    {
      "title": "Git",
      "desc": "Run the Git command-line tool",
      "iframe": false,
      "tags": ["command", "dev"],
      "aliases": ["git cli"],
      "command": "git"
    }
  ]
}
```

Save this as a `.gjson` file inside a Target Group.

## Passing Arguments

Use `>` to pass arguments to the selected command.

```text
Git > status
```

This runs:

```bash
git status
```

Another example:

```text
Git > log --oneline
```

This runs:

```bash
git log --oneline
```

Everything to the right of `>` is appended to the command argument string.

## Security

Command execution is controlled by Glimpse's command security settings:

- command policy mode
- whitelist
- blacklist
- trusted directories

If a command is blocked, Glimpse shows an error instead of executing it.

## Common Use Cases

- Git commands
- project scripts
- local CLI tools
- documentation generators
- frequently used shell utilities
