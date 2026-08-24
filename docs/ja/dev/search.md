# 検索アーキテクチャ

検索は大きく次の責務に分かれます。

- frontend input parsing
- SQLite による durable item storage
- active search backend による full-text retrieval

production backend は Tantivy + Lindera です。SQLite は item metadata、preview、open action、stats、cleanup query の canonical store です。Tantivy は full-text search のための再構築可能な inverted index として扱います。

## Frontend Parsing

`src/features/search/parseSearchInput.ts` は UI input を次の形に解析します。

```ts
{
  query: string;
  tags: string[];
  commandArgs: string | null;
  hidden: boolean;
}
```

frontend は command prefix と UI routing を担当します。

- `>` command argument mode
- `!` hidden-item search
- `#tag` tag collection
- `:` と `/` の internal page routing

backend は `search_items` から `SearchRequest` を受け取ります。

## Backend Query Model

backend query parsing は `src-tauri/src/search/query.rs` から始まります。

user text は一度だけ `StructuredQuery` に変換されます。

```text
StructuredQuery
|-- SearchTerm::Text(QueryToken)
`-- SearchTerm::Tag(QueryToken)
```

backend はこの structured query を各 backend の native query に変換します。

- SQLite FTS5 は `MATCH` syntax に変換します。
- Tantivy は `BooleanQuery`、`BoostQuery`、`PhrasePrefixQuery`、`TermQuery`、`PhraseQuery` を直接組み立てます。

Tantivy query construction は index tokenizer を通して term を作成し、lowercase normalization と Lindera tokenization を迂回しないようにします。

## Storage And Index Roles

SQLite は indexed item の source of truth です。

SQLite が保持するもの:

- item identity
- title
- source path
- updated timestamp
- full scan freshness check 用の source fingerprints
- preview payloads and preview URLs
- open actions
- star / hidden / boost metadata
- tags and aliases
- stats and tag-cloud queries
- source-path cleanup queries

Tantivy が保持するもの:

- full-text inverted index
- tokenized title / tag / alias / body fields
- searchable body text
- SQLite から複製される ranking inputs: star、hidden、updated timestamp、boost

Tantivy は canonical item data を持ちません。Search hits は ID と score を返し、最終的な `SearchResult` は SQLite から hydrate します。

Target Group ごとの derived search artifacts は、その primary target directory の下に保存されます。

- `.glimpse/index.db`
- `.glimpse/tantivy/`

Target Group switching では、current SQLite connection、Tantivy reader/writer state、watcher を切り替えます。valid artifacts がある場合、full scan は不要です。

## Consistency Strategy

検索整合性の基本方針は SQLite-first、Tantivy-second です。

Upsert:

1. Open SQLite transaction: canonical item-store write を開始します。
2. Write `IndexItem` rows: replacement item metadata、preview、open action、tags、aliases を保存します。
3. Commit SQLite: Tantivy に触る前に canonical item state を durable にします。
4. Open Tantivy writer: derived full-text index update を準備します。
5. Delete old Tantivy docs: 対象 item ID の古い document を削除します。
6. Add replacement docs: 新しい item / chunk documents を index します。
7. Commit Tantivy: derived search update を durable にします。
8. Reload reader: commit 済みの Tantivy changes を search に公開します。

Full scan 中の source replacement:

1. Read affected SQLite IDs: source の既存 item ID を削除前に capture します。
2. Open SQLite transaction: source-local replacement を開始します。
3. Delete rows for `source_id`: 同じ source から生成された stale items を削除します。
4. Write parsed replacement items: 新しく parse した items を insert します。
5. Record source fingerprint: 次回 skip check 用の freshness metadata を保存します。
6. Commit SQLite: 新しい source-derived state を canonical にします。
7. Open Tantivy writer: derived index replacement を準備します。
8. Delete captured old docs: capture 済み ID の Tantivy document を削除します。
9. Add replacement docs: 新しい item / chunk documents を index します。
10. Commit and reload Tantivy: derived search state を公開します。

Delete:

1. Read affected SQLite IDs: canonical rows を削除する前に item ID を capture します。
2. Open SQLite transaction: canonical delete を開始します。
3. Delete item-store rows: item metadata、preview、open action、tags、aliases を削除します。
4. Commit SQLite: canonical delete を durable にします。
5. Open Tantivy writer: derived index cleanup を準備します。
6. Delete captured Tantivy docs: capture 済み item ID の documents を削除します。
7. Commit Tantivy: derived cleanup を durable にします。
8. Reload reader: delete を search に公開します。

SQLite commit が Tantivy commit より先です。Tantivy は一時的に stale になってもよいですが、canonical item data が Tantivy だけに存在する状態にはしません。

## Read Path

search は Tantivy で候補を取り、SQLite で hydrate します。

1. `SearchRequest`: frontend から structured search request を受け取ります。
2. `StructuredQuery`: backend search terms と tag filters を一度だけ parse します。
3. Tantivy query: structured query を active full-text backend に compile します。
4. Hit IDs and scores: Tantivy から ranking 済み candidate item IDs を受け取ります。
5. SQLite item-store hydration: canonical item metadata、preview payloads、open actions を読み込みます。
6. `SearchResult[]`: item-level results を frontend に返します。

Tantivy が返した ID が SQLite に存在しない場合、その hit は hydration 時に skip します。空 query の recent items は Tantivy を使わず SQLite から直接取得します。

## Snippet API Contract

Tantivy indexing が chunk-level になっても、search results は item-level のままです。backend は optional snippets を付け、なぜ item が match したかを説明できます。

snippet fragments は HTML ではなく plain text です。frontend が `matched` に基づいて highlight rendering を担当します。

Tantivy snippets は stored Tantivy hit fields から生成します。大きな SQLite preview body を hydration して snippet を作る設計にはしません。

## Chunk Boundary

Tantivy indexing は `src-tauri/src/search/tantivy/chunk.rs` を通ります。

chunker は 1 つの `IndexItem` から 1 件以上の `IndexChunk` を生成します。短い body は 1 chunk のままです。長い body は 8 KiB 前後を目安に、512 byte overlap を持つ chunk に分割します。

boundary selection は Markdown heading、paragraph break、line break、sentence terminator、whitespace の順に優先し、最後に UTF-8 character boundary に fallback します。

## Item And Chunk Documents

Tantivy には 2 種類の logical document があります。

- `item`
- `chunk`

item documents は title、aliases、tags、ranking inputs を持ちます。chunk documents は body chunk text、snippet 用の stored `chunk_text`、chunk ordinal / byte offsets、item からコピーされた ranking inputs と tag filter を持ちます。

search results は item-level のままです。item document と chunk document の hits は SQLite hydration 前に item ID へ collapse します。

## Doc-Kind-Aware Querying

Tantivy query construction は `doc_kind` を意識します。

plain text terms は item branch と chunk branch に compile されます。

- item branch: `doc_kind:item` と title、aliases、tag display text
- chunk branch: `doc_kind:chunk` と body text、minimal item context

tag-only query は item documents だけを対象にします。mixed tag/text query では chunk documents の `tags_filter` を使い、body match と tag filter を両立します。

## Snippet Builder

Tantivy snippets は `src-tauri/src/search/tantivy/snippet.rs` で作ります。

builder は Tantivy hit document が使える間に snippet candidate を作成します。

- chunk documents は stored `chunk_text` から `body` snippets を作る
- body snippets は chunk ordinal と byte offsets を含む
- item documents は `alias`、`tag`、`title` snippets を作れる
- title snippets は title-only hit の fallback として使う

hit accumulator は item-level deduplication の間、最良の snippet candidate を保持します。

## Snippet Navigation

body snippets は `chunk.ordinal`、`chunk.startByte`、`chunk.endByte` を持てます。frontend はこの original-body byte offsets を使い、result-list snippet から source preview の該当範囲へ移動します。

Markdown preview では、stored chunk offsets が raw preview body を指すため、reveal 前に raw mode へ切り替えます。

## TopDocs Fetch Width

Tantivy search は最初に `requested_limit * 4` の raw `TopDocs` hits を取得し、item-level に deduplicate します。

chunk indexing では同じ item から複数 hit が出るため、unique candidates が足りない場合は raw hit width を段階的に増やします。十分な candidate が集まった、result set が尽きた、または configured maximum fetch width に達した時点で止めます。

## Failure Handling

想定する failure behavior:

- SQLite write fails: operation を abort し、Tantivy は変更しない。
- SQLite commit succeeds, Tantivy write fails: SQLite を canonical とし、Tantivy は reindex / recovery まで stale でよい。
- Tantivy commit succeeds, reader reload fails: index は durable だが、current reader は次回 reload / index switch まで変更を見ない可能性がある。
- Search hit hydration misses SQLite rows: その hit を skip する。

## Recovery

indexer は source files から derived search state を rebuild できます。

recovery では active target group の derived artifacts を再作成します。

- `.glimpse/index.db`
- `.glimpse/tantivy/`

canonical item data を Tantivy から復旧しようとしてはいけません。Tantivy は search と ranking に必要な fields だけを持ち、full preview / open-action state は持ちません。

## Lifecycle Ownership

Tantivy writer lifecycle は `src-tauri/src/search/tantivy/writer.rs` に集約します。

この module だけが次を担当します。

- `IndexWriter` の作成
- Tantivy documents の変更
- `commit()` の呼び出し
- commit 後の reader reload

search code は query ごとに reader reload を強制せず、current reader を使います。

## Invariants

検索コードを変更するときは、次の invariants を守ります。

- SQLite item store が canonical。
- Tantivy chunk document IDs は SQLite item IDs と一致する。
- upsert は replacement を追加する前に古い Tantivy document を削除する。
- delete は SQLite rows を削除する前に SQLite IDs を capture する。
- Tantivy mutation の前に SQLite commit が成功している。
- Tantivy commit 後に reader reload する。
- 同じ item の複数 Tantivy hits は SQLite hydration 前に collapse する。
- search results は frontend に返す前に SQLite から hydrate する。
- empty query / recent-items results は SQLite から取得する。
- stats と tag cloud は Tantivy ではなく SQLite から取得する。

## Legacy SQLite FTS5 Backend

`src-tauri/src/search/sqlite/` は legacy SQLite FTS5 backend として残っています。

repository module は FTS5 `search_index` table の同期に限定します。generic item persistence は `src-tauri/src/store/item_repository.rs` に置きます。

legacy backend でも canonical-store rule は同じです。item rows が durable state であり、FTS5 table は derived search state です。
