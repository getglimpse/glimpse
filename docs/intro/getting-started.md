# First Launch and Workspace

When you launch Glimpse for the first time, a default workspace is created automatically.

By default, Glimpse creates a **Glimpse** folder inside your **Documents** directory and registers it as a search source.

## Initial Files

The default workspace contains starter files:

```text
Glimpse/
|-- Welcome.md
|-- Getting Started.md
|-- Markdown.md
|-- Metadata.md
|-- Commands.md
`-- Examples/
```

These files introduce the core workflow and provide examples of supported Markdown syntax and metadata.

## Search Sources

In addition to the default workspace, you can add other folders as search sources.

For example:

```text
Documents/Notes
Documents/Projects
Obsidian/Vault
```

Search sources are managed through Target Groups.

## Internal Pages

Built-in app pages are available as Internal Pages:

```text
:settings
:about
:plugin
```

## Updating The Index

Changes made within search source folders are reflected automatically:

- file creation
- file updates
- file renaming
- file deletion

In most cases, you do not need to manually rebuild the index.

## Next Steps

Once your workspace is ready, continue to [Quick Start](./quick-start.md).
