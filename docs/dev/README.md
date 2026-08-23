# Developer Documentation

This section explains the public implementation details of Glimpse for contributors.

For user-facing behavior, installation steps, search syntax, and FAQ, see the regular `docs/` pages. The developer pages focus on module responsibilities, data flow, API contracts, and contributor verification.

## Scope

- User-facing documentation lives in `docs/` and `docs/ja/`.
- Public implementation notes and internal APIs live in `docs/dev/`.
- `docs/dev/` should contain only technical material that is safe to publish.

## Recommended Reading Order

1. [Architecture](./architecture.md): ownership boundaries and core flows.
2. [Frontend](./frontend.md): React structure, IPC wrappers, preview, and plugin runtime.
3. [Backend](./backend.md): Tauri commands, state, persistence, and safety boundaries.
4. [Search](./search.md): query model, SQLite/Tantivy roles, snippets, and consistency.
5. [Indexing](./indexing.md): scans, file watching, parser dispatch, and target groups.

## Where To Look

| Topic | Page |
| --- | --- |
| Overall architecture and data flow | [architecture.md](./architecture.md) |
| React components, hooks, and API wrappers | [frontend.md](./frontend.md) |
| Tauri commands, stores, and managed state | [backend.md](./backend.md) |
| Search queries, ranking, snippets, and Tantivy | [search.md](./search.md) |
| Scanning, watching, and target group switching | [indexing.md](./indexing.md) |
| Markdown, `.gjson`, and metadata parsers | [parser.md](./parser.md) |
| Settings model, defaults, watcher, and trust records | [settings.md](./settings.md) |
| Plugin manifest, runtime API, viewers, and trust | [plugins.md](./plugins.md) |
| Backend logs, command logs, and diagnostics | [logging.md](./logging.md) |

## When To Update These Docs

- You changed an IPC command, type, store schema, or setting.
- You changed search, indexing, preview, or plugin behavior.
- Internal manual verification needs a new check.
- User-facing docs and implementation docs disagree.
- Content is not appropriate for public docs and should be removed from this repo.

## Source Layout

```text
src/
|-- api/               Frontend wrappers around Tauri IPC commands
|-- components/        Shared React UI
|-- contexts/          React providers
|-- features/          Feature-specific frontend logic
|-- hooks/             Shared React hooks
|-- i18n/              Generated and handwritten translations
|-- types/             Frontend domain types
|-- utils/             Frontend helpers
`-- views/             Internal pages and preview views

src-tauri/src/
|-- commands/          Tauri IPC commands
|-- models/            Shared backend domain models
|-- search/            Search engine abstraction and implementations
|-- store/             Persistence, settings, plugins, and indexing
|-- utils/             Path, open action, and command-safety helpers
`-- lib.rs             Tauri bootstrap
```

## Core Concepts

- `IndexItem` is the searchable unit shared by the backend, frontend, and plugins.
- `Preview` describes how an item is displayed. Supported forms include Markdown, raw text, external URL, plugin viewer, and internal page.
- `OpenAction` describes what happens when the user presses `Enter`. Supported actions include external URL, command, and plugin action.
- A Target Group defines the filesystem scope used by normal search and indexing.
- A `.gjson` file creates zero or more searchable items from one JSON index file.
- Plugins are local frontend-only bundles. Glimpse requires explicit user trust before loading plugin code or styles.

## Documentation Update Rule

When an implementation changes, update docs in this order when relevant:

1. Rust doc comments or TypeScript comments near the changed API.
2. Developer documentation in `docs/dev`.
3. Private operational notes in `.private-docs` when the change affects manual verification or release work.
4. User-facing documentation in `docs/`.
5. Japanese user-facing documentation in `docs/ja` when visible behavior changes.
6. Changelog or release notes when the change is user-visible.

Document confirmed behavior. Treat unimplemented ideas as future work only when they are intentionally left for later.
