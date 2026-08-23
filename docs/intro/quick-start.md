# Quick Start

This guide will walk you through the basic features of Glimpse in just a few minutes.

You'll create a Markdown file, search for it, preview it, use Preview Tabs, and explore Internal Pages.

## Step 1. Create a Markdown File

Create a new file in your workspace:

```text id="a6z8vx"
~/Documents/Glimpse/Rust.md
```

Add the following content and save the file:

```md id="wd0n5f"
---
tags:
  - rust
  - programming

aliases:
  - rs
---

# Rust

Rust is a systems programming language.

## Features

- Fast
- Safe
- Concurrent
```

After saving the file, Glimpse automatically updates the search index. No manual indexing is required.

## Step 2. Search

Type the following into the search bar:

```text id="s9cb72"
rust
```

The **Rust** document should appear in the search results.

Titles, document content, tags, and aliases are all searchable.

For example, searching for:

```text id="x4vghm"
rs
```

will also find the same document.

## Step 3. Preview

Select **Rust** from the search results to display its contents in the Preview panel.

The Preview automatically updates as you change the selected search result, so there is no need to press `Enter` to open the file.

This lets you review documents before deciding whether to open them.

## Step 4. Preview Tabs

To keep the current preview open, press:

```text id="yd9x5q"
Ctrl + T
```

The current preview is added as a **Preview Tab**.

For example:

1. Search for `rust`
2. Press `Ctrl + T`
3. Search for `markdown`
4. Press `Ctrl + T`

You now have multiple documents open in separate tabs.

The live preview continues to follow the current search result, while documents added as Preview Tabs remain open until you close them.

## Step 5. Internal Pages

Glimpse includes built-in pages in addition to Markdown documents.

For example, type:

```text id="k3mx5s"
:settings

:help

:plugin
```

These commands open built-in pages such as settings, help, and plugin management.

Like Markdown documents, Internal Pages are displayed in the Preview panel.

## Step 6. Target Groups

You can add folders other than the default workspace as search sources.

For example:

```text id="v1n7rm"
Documents/Notes
Documents/Projects
Obsidian/Vault
```

By adding these folders to a **Target Group**, you can search across multiple locations at once.

In addition to Markdown files, you can also include `.gjson` indexes as search sources.

## Next Steps

You've now explored the following features:

- Searching Markdown files
- Searching with metadata
- Preview
- Preview Tabs
- Internal Pages
- Searching across multiple folders

For more detailed information, continue with the following guides:

- Search
- Metadata
- Preview
- Internal Pages
- Target Groups
- Glimpse JSON Index
- Command Launcher
