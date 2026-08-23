# Backend

The backend is the Rust side of the Tauri app. It owns persistence, indexing, search, settings, plugin installation, and filesystem-facing operations.

## Modules

```text
src-tauri/src/
|-- commands/     IPC command handlers
|-- models/       Shared backend domain models
|-- search/       Search abstraction and backends
|-- store/        SQLite stores, settings, plugins, indexing
|-- utils/        Path, command, and open-action helpers
`-- lib.rs        Tauri bootstrap
```

Command modules should stay thin. Domain logic belongs in stores, search modules, parsers, and utilities.

## IPC Commands

Backend commands are grouped by domain:

| Module | Example commands | Responsibility |
| --- | --- | --- |
| `search` | `search_items` | Search requests and result hydration |
| `indexing` | `reindex`, `get_indexing_stats` | Scans, watcher state, indexing stats |
| `settings` | `get_settings`, `save_settings` | Settings persistence |
| `plugins` | `install_plugin_from_path`, `set_plugin_trust` | Plugin lifecycle and trust |
| `preview` | preview helpers | Preview payload support |
| `open` | open action commands | Opening files, URLs, and commands |
| `command_log` | command history commands | Command execution records |

Frontend code should use `src/api/*` wrappers instead of command names directly.

## Managed State

Shared backend state is initialized during Tauri startup and passed to commands through Tauri state.

It includes:

- app paths
- settings store
- active workspace or target group state
- SQLite connections
- search engine runtime
- indexing watcher
- plugin store

State changes that affect search artifacts or watchers should be serialized through the backend runtime APIs that own those resources.

## Persistence

SQLite is the durable store for indexed item metadata, preview payloads, open actions, settings-derived state, command logs, plugin records, and indexing freshness data.

Tantivy is a derived full-text index. It can be rebuilt from SQLite and source files.

## Safety Boundaries

The backend enforces boundaries for:

- filesystem paths
- trusted directories
- command lookup and allow/block policy
- plugin manifest validation
- plugin trust fingerprints
- plugin source and asset loading

Frontend UI should not be treated as the safety boundary. Backend commands must validate paths, scopes, and command policy before performing filesystem or process operations.
