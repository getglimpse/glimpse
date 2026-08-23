# インデックス作成

このページでは、現在の indexing 実装をまとめます。

## 責務

indexer は、設定された Target Group folder と検索可能アイテムを同期します。

担当する処理:

- 初回 scan
- realtime file watching
- incremental update
- rename handling
- delete handling
- missing source path の cleanup

## 主要モジュール

```text
src-tauri/src/store/indexer/
|-- mod.rs
|-- scan.rs
|-- watch.rs
|-- parser_dispatch.rs
`-- runtime.rs
```

## 流れ


<img class="diagram" src="../../assets/diagrams/indexing_1.svg" alt="Indexing flow">

1. indexing 対象の fs scope と、対応 `.glimpse/` artifacts を決定
2. full/incremental scan、または fs change から indexing を開始
3. source file type と indexing rules に基づいて parser を選択
4. source file を 0 件以上の searchable item に変換
5. title、metadata、open action などを持つ検索可能アイテムを取得
6. SQLite item store と derived search index を更新し、検索で使える状態に変更

## 対応 parser

Parser dispatch は file extension に基づいて行われます。

| File type | Parser | Notes |
| --------- | ------ | ----- |
| `.md` | Markdown parser | 1 件の Markdown preview item を生成 |
| `.gjson` | Glimpse JSON parser | 0 件以上の item を生成 |
| image extensions | Image parser | image syntax を含む 1 件の Markdown preview item を生成 |
| PDF, Office, audio, video | metadata-only parser | body を読まずに file metadata を index |
| other files | Raw parser | 可能な場合は 1 件の raw preview item を生成 |

壊れた `.gjson` ファイルは raw preview に fallback します。これにより、解析に失敗してもファイル自体は検索結果に表示できます。

## Indexing Filter

indexing の挙動は `IndexingSettings` で制御されます。

default には次が含まれます。

- hidden file を無視する
- `.glimpse/**` を無視する
- `.git/**` を無視する
- `node_modules/**` を無視する
- `target/**` を無視する
- `dist/**` を無視する
- `*.log` を無視する
- `.trash/**` を無視する
- 設定された上限を超える large non-metadata-only file を skip する
- `exe`, `dll`, `zip`, `7z`, `db`, `sqlite` などの executable/archive/database extension を除外する

metadata-only file type は body を読まないため、大きいファイルでも許可されます。

## Target Groups

indexer は current Target Group に対して動作します。Target Group は複数の directory を持てます。

Target Group を切り替えると、current search source と watcher set が変わります。

## Source Identity

filesystem-backed item は、次から導出される安定した source ID を使います。

```text
group name + target index + relative path
```

`.gjson` ファイルでは、各 item ID に item index が追加されます。

```text
docs/api.gjson::0
docs/api.gjson::1
```

これにより、scan、watch、update、cleanup の各 path が同じ logical item を一貫して扱えます。
