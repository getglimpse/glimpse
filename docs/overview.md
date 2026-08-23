# What Is Glimpse?

**Glimpse** is a fast local search launcher.

It lets you search Markdown files, Glimpse JSON indexes (`.gjson`), commands, internal pages, images, and other local files from a single search bar, so you can quickly access the information you need.

Glimpse is not designed to be a large-scale knowledge management system. Instead, it focuses on helping you find notes you want to revisit, frequently used commands, research, and working documents with as little effort as possible.

## Key Features

### Fast Incremental Search

Search results update in real time as you type.

You can search across Markdown files, `.gjson` indexes, internal pages, commands, images, metadata-only file references, and raw file previews.

In addition to titles and body text, Glimpse can use metadata such as custom titles, tags, and aliases.

Even with thousands or tens of thousands of items, you can quickly access the information you are looking for.

### Preview

You can preview search results directly within the application.

Markdown previews support the following elements:

- Headings
- Lists
- Tables
- Code blocks
- Inline code
- Images
- Blockquotes

This allows you to review search results immediately without opening an external editor.

### Preview Tabs

You can keep multiple search results open as tabs.

For example, you can open:

- API references
- Working notes
- TODO lists
- Command lists

You can then switch between tabs while you work.

### Metadata

You can add searchable information using Markdown frontmatter.

```yaml
---
title: Rust
tags:
  - rust
  - programming
aliases:
  - r
---
# Rust
```

By defining titles, tags, aliases, and other metadata, you can make documents easier to find.

### Glimpse JSON Index

You can add searchable items from `.gjson` files.

Collections such as bookmarks, command lists, and internal documentation can be managed together and searched in the same way as Markdown files.

### Command Launcher

You can search built-in pages and trusted plugin pages directly from the search bar.

```text
:settings

:about

:plugin
```

You can open settings, plugin management, and other app pages using only the keyboard. Command launcher items and plugin page actions can also receive arguments with `>`.

### Real-Time Indexing

Glimpse monitors configured folders in real time.

The following changes are automatically reflected in the search index:

- File creation
- File updates
- File renaming
- File deletion

In most cases, you do not need to manually rebuild the index.

## Who Glimpse Is For

Glimpse is well suited for people who:

- Manage a large collection of Markdown notes
- Want to search an Obsidian vault quickly
- Need immediate access to working notes
- Prefer a keyboard-first workflow
- Want to use frequently used commands through a launcher

## The Glimpse Philosophy

Glimpse prioritizes fast access to the information you need.

Rather than adding complex features and settings, it is designed to keep the workflow of searching, reviewing, and opening information as quick and straightforward as possible.
