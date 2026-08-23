---
title: Command Example
tags:
  - example
  - command
aliases:
  - git command
open.type: command
open.path: git
---

# Command Example

This file demonstrates command launchers with `open.*` metadata.

## Run the Command

Search for this file, select it, and press `Enter` to run `git`.

If `git` is not installed or command execution is blocked by your settings, Glimpse shows an error and records it in Command History.

## Pass Arguments

Use `>` to pass arguments to the selected command:

```text
Command Example > --version
```

This runs:

```text
git --version
```

## Security

Command execution is controlled by **Settings -> Security**:

- Command policy mode
- Whitelist
- Blacklist
- Trusted directories

Blocked commands show an error instead of running.

## History

Open the built-in Command History page to review recent command and plugin action runs:

```text
:history
```
