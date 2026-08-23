# Getting Started

This folder is your first Glimpse workspace.

## Create a Note

Create a file named:

```text
My Note.md
```

Add content:

```md
---
tags:
  - notes
aliases:
  - first note
star: true
---

# My Note

Hello Glimpse!
```

The file appears in search results automatically after it is indexed.

## Try Search

Search for:

```text
My Note
```

Then try the metadata:

```text
#notes
```

```text
first note
```

Starred items are prioritized in search results.

## Explore Built-In Pages

Internal Pages are searchable with `:`:

```text
:help
:settings
:history
:plugin
```

These pages open in the Preview panel like documents. Some pages also include in-app help.

## Organize Content

A simple workspace structure works well:

```text
Glimpse/
|-- Notes/
|-- Projects/
|-- Snippets/
|-- References/
`-- Tools/
```

Add more folders from **Settings -> Target Groups**. Use `*` before a query to search all Target Groups at once:

```text
*project plan
```

## Next

Open **Search.md**, **Metadata.md**, and **Commands.md** to try the v0.2.0 search and launcher features.
