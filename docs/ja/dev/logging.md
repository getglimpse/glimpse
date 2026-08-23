# ログ

Glimpse は `tracing` による Rust の structured logging を使います。

ログは開発、診断、release smoke testing を目的としています。

## バックエンドログ

backend module は `tracing` macro を使います。

- `debug!`
- `info!`
- `warn!`
- `error!`

主な logging area:

- startup と app setup
- settings の load/save/watch
- indexing runtime state
- scan と watch event
- parser dispatch
- SQLite search operation
- command execution policy
- plugin discovery、install、trust、source loading

## コマンド実行ログ

command execution history は JSON Lines として別に永続化されます。

```text
<app_data_dir>/logs/command-executions.jsonl
```

関連 command:

- `get_command_execution_logs`
- `open_command_logs_file`

アプリ内の Command History page は、フロントエンドが追跡する最近の command と plugin action の実行を表示します。一方、backend command logs は command execution record を永続化します。

## フロントエンド診断

フロントエンドコードは、失敗した IPC call には `console.error` を使い、ユーザーに見える error には toast message を使います。

`src/utils/debugPerf.ts` は、search、indexing、Target Group switching path 周辺で使う軽量な performance timing を提供します。

## ガイドライン

- path、id、count、error message などの context field を記録する。
- file content や sensitive command argument は、debug に明示的に必要な場合を除いて log に出さない。
- ユーザー向け message は簡潔にし、運用上の詳細は log に置く。
