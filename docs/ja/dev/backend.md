# バックエンド

バックエンドは `src-tauri/src` 配下の Rust で実装されています。

Tauri IPC command の公開、ローカル永続化、検索 index の管理、ファイルシステムとコマンド実行の安全境界を担当します。

## モジュール

```text
src-tauri/src/
|-- app_state.rs
|-- commands/
|-- lib.rs
|-- models/
|-- search/
|-- shortcuts.rs
|-- store/
`-- utils/
```

## IPC Commands

Command は `lib.rs` で明示的に登録されます。

現在の command group:

| Module | Examples | Responsibility |
| ------ | -------- | -------------- |
| `about` | `get_about_info` | アプリ metadata |
| `action` | `run_item_command` | command item action |
| `command_log` | `get_command_execution_logs` | command history log |
| `file` | `read_text_file`, `read_binary_file`, `create_markdown_file` | file access と Markdown edit |
| `indexing` | `get_indexing_stats`, `full_scan`, `cleanup_missing_source_paths` | index maintenance |
| `open` | `open_source_file`, `reveal_in_explorer` | OS の file open |
| `plugins` | `install_plugin_from_path`, `set_plugin_trust` | plugin lifecycle と trust |
| `preview` | `get_preview` | lazy preview lookup |
| `search` | `search_items` | search execution |
| `settings` | `get_settings`, `set_settings`, `switch_next_target_group` | settings persistence |
| `stats` | `get_stats` | app statistics |
| `themes` | `get_custom_themes`, `open_themes_folder` | custom CSS themes |

Command は薄く保ちます。共有ロジックは `search/`、`store/`、`utils/` に置きます。

## Managed State

バックエンドは Tauri managed state に共有値を保持します。

- app data directory
- settings path
- SQLite connection
- SQLite search engine
- indexing stats
- indexing runtime

command と background task の両方から触る値は `Arc<Mutex<_>>` で包まれています。

## 永続化

runtime data はローカルに保存されます。

```text
<app_data_dir>/settings.json
<app_data_dir>/plugins/
<app_data_dir>/themes/
<app_data_dir>/logs/command-executions.jsonl
<default_workspace>/.glimpse/index.db
```

default workspace は初回起動時にユーザーの Documents folder 配下へ作成されます。

## 安全境界

バックエンドの安全性は主に次で担保します。

- file access に対する Target Group path constraint
- plugin file API に対する active-tab / target-group scope
- plugin trust fingerprint
- command action sanitization
- command lookup、blacklist/whitelist policy、trusted directories

新しい command からこれらの helper を迂回しないでください。
