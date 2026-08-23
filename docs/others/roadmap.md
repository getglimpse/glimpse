# Roadmap

This page outlines the planned future development of Glimpse.

Items on this roadmap are subject to change, be postponed, or be removed as development progresses and priorities evolve.

## Development Philosophy

Glimpse is built around a single guiding principle:

**Reach the information you need as quickly as possible.**

Even as new features are added, Glimpse aims to preserve its core experience:

- Fast search
- Live Preview
- Simple interactions
- A keyboard-first workflow

## Next

These improvements are being considered for the near future.

### Search Improvements

Continue improving the search experience.

Planned improvements:

- Better multi-tag workflows
- Improved ranking heuristics
- Better use of metadata in ranking and filtering
- Recent Searches
- Search Presets for tags, Target Groups, and hidden items
- Better search and index diagnostics

### Plugin Workflow Improvements

Make local plugins easier to manage.

Planned improvements:

- Local `.glimpse-plugin.zip` install
- Plugin update flow
- Better plugin reload and replacement flow
- Clearer trust and compatibility status

## Planned

These features are being considered for the medium to long term.

### Preview Improvements

Improve the Preview experience across more file types.

Possible future additions include:

- Better image previews
- Audio and video preview improvements
- Better PDF viewer support
- More plugin viewers

Office Documents Viewer is already implemented as `office-documents-viewer-plugin`.

### Item Organization

Consider lightweight ways to organize search results.

Possible future additions:

- Starred / pinned item management
- Hidden item management
- Ignore / exclude item lists
- Archived items
- Restore hidden / archived items

Glimpse is not a file manager, so source-file Trash or recycle-bin behavior is not a near-term priority.

### Metadata Improvements

Extend Metadata to provide more flexible search and organization.

Possible future additions:

```yaml
---
title:
description:
tags:
aliases:
icon:
category:
---
```

### Plugins and Extensions

Future work will focus on plugin distribution, compatibility, and deeper extension points.

Possible additions include:

- Remote extension store
- Plugin hot reload
- Additional plugin APIs for custom parsers and search/indexing extensions

## Low Priority

These features are currently considered low priority.

- Dedicated Bookmark Manager
- Traditional Saved Searches
- Source-file Trash / recycle bin
- Cross-device sync
- Cloud-backed workspaces
- Advanced collaboration features

## Guiding Principle

Glimpse will continue to evolve around the following workflow:

```text
Search
↓
Preview
↓
Ctrl + T
↓
Search Again
```

Future development will continue to prioritize fast search and Live Preview while gradually introducing new capabilities without compromising the core workflow.
