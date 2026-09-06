# Glimpse

[日本語](README_ja.md)

[![Release](https://img.shields.io/github/v/release/getglimpse/glimpse?display_name=tag)](https://github.com/getglimpse/glimpse/releases)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4CAF50)](#platforms)
[![Status](https://img.shields.io/badge/Status-Beta-orange)](https://github.com/getglimpse/glimpse)

> Fast local search with instant preview.

Glimpse is a keyboard-first desktop launcher for quickly finding, previewing, and opening local knowledge.

Search Markdown files, Glimpse JSON indexes (`.gjson`), links, commands, internal pages, and plugin-provided tools from one search box. Glimpse is built for people who keep working notes, project documents, snippets, bookmarks, and command references on their own machine.

## Status

Glimpse is currently in beta.

The core workflow is usable, but some features, settings, file formats, and plugin APIs may still change. Please keep backups of important files and report issues if something does not work as expected.

## Features

- Fast incremental local search
- Live Markdown, Glimpse JSON, image, and raw file preview
- Preview tabs for keeping multiple results open
- Frontmatter metadata support (`title`, `tags`, `aliases`, `star`, `hidden`, `url`, `command`)
- Query syntax for more focused searches
- Keyboard-first navigation
- Target groups for searching multiple folders
- Built-in internal pages for settings, help, shortcuts, diagnostics, and plugin management
- Custom CSS themes
- Local and remote plugin system with explicit trust checks

## Use Cases

Glimpse is useful for:

- Searching Markdown notes and Obsidian vaults
- Quickly previewing working documents without opening an editor
- Opening frequently used files, links, and command references
- Keeping project notes, snippets, and lightweight knowledge bases searchable
- Extending the launcher with local or remote plugins

Glimpse is not trying to be a full knowledge management suite. Its goal is simple: help you reach the information you need as quickly as possible.

## Installation

Download the latest build from the [Releases](https://github.com/getglimpse/glimpse/releases) page.

### Platforms

Glimpse is designed for Windows, macOS, and Linux.

Tested environments:

- [x] Windows 11
- [x] Fedora Linux
- [ ] macOS, planned but not yet fully tested

## Quick Start

1. Launch Glimpse.
2. Add a folder such as `Documents/Notes`, `Documents/Projects`, or an Obsidian vault as a search source.
3. Start typing in the search box.
4. Select a result to preview it instantly.
5. Press `Ctrl + T` to keep the current preview open as a tab.
6. Type internal-page queries such as `:settings`, `:help`, or `:plugin` to open built-in pages.
7. Use `>` after a selected command or plugin page action to pass arguments, such as `numeric calculator > 1 + 2`.

For more details, see the [Quick Start](docs/intro/quick-start.md) guide.

## Plugins

Glimpse supports frontend-only plugins installed from local folders, local
`.glimpse-plugin.zip` archives, or the official remote plugin registry.

Plugins can add internal pages, actions, and viewers. They are not loaded automatically; installed plugins must be trusted before Glimpse runs their code.

Remote plugins are listed on Plugin Page. Glimpse downloads the release archive,
verifies its SHA-256 checksum, installs it, and then waits for the user to trust
and enable the plugin. Installing or updating a plugin clears the previous trust
record.

See the user guide for [using plugins](docs/plugins.md).

Free public plugins and the official registry live in the [getglimpse/plugins](https://github.com/getglimpse/plugins) repository. Plugin specifications and author-facing implementation notes live in [getglimpse/plugin-template](https://github.com/getglimpse/plugin-template).

- Numeric calculator
- Date calculator
- Unit converter
- PDF viewer
- CSV viewer
- File converter
- Office documents viewer

New plugin templates live in [getglimpse/plugin-template](https://github.com/getglimpse/plugin-template).
Release archives can be created with `pnpm plugins:package`.

The main `docs/` directory is user documentation. Detailed plugin author documentation is maintained in `getglimpse/plugin-template`.

## Documentation

- [What Is Glimpse?](docs/overview.md)
- [Quick Start](docs/intro/quick-start.md)
- [Search](docs/intro/search.md)
- [Preview](docs/preview/overview.md)
- [Plugins](docs/plugins.md)
- [Settings](docs/internal/settings.md)
- [Roadmap](docs/others/roadmap.md)
- [FAQ](docs/others/faq.md)

Japanese documentation is available in [docs/ja](docs/ja).

## Development

Requirements:

- Node.js
- pnpm
- Rust
- Tauri prerequisites for your platform

Install dependencies:

```sh
pnpm install
```

Run the frontend dev server:

```sh
pnpm dev
```

Run the Tauri app:

```sh
pnpm tauri dev
```

Build and test:

```sh
pnpm build
pnpm test
cargo check --manifest-path src-tauri/Cargo.toml
```

## Roadmap

Planned work includes:

- Trash and restore workflows
- Search ranking and metadata improvements
- Richer previews for audio, video, PDF, and Office documents
- Plugin distribution and update workflow refinements
- More extension points for custom viewers, parsers, and indexing features

See the [roadmap](docs/others/roadmap.md) for more information.

## Contributing

Bug reports, feature requests, and pull requests are accepted via GitHub Issues and Pull Requests.

If you find Glimpse useful, starring the repository helps support development and project visibility.

## Support

If Glimpse is useful to you, consider supporting its development:

[Buy Me a Coffee](https://www.buymeacoffee.com/cromon)

## License

Glimpse is licensed under the MIT License. See [LICENSE](LICENSE) for details.
