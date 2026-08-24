# Search Architecture

Search is split into three responsibilities:

- frontend input parsing
- durable item storage in SQLite
- full-text retrieval in the active search backend

The production backend is Tantivy + Lindera. SQLite remains the durable item
store for item metadata, previews, open actions, stats, and cleanup queries.
Tantivy is a rebuildable inverted index used for full-text search.

## Frontend Parsing

`src/features/search/parseSearchInput.ts` parses UI input into:

```ts
{
  query: string;
  tags: string[];
  commandArgs: string | null;
  hidden: boolean;
}
```

The frontend handles command prefixes and UI routing:

- `>` command argument mode
- `!` hidden-item search
- `#tag` tag collection
- `:` and `/` internal page routing

The backend receives a `SearchRequest` from `search_items`.

## Backend Query Model

Backend query parsing starts in `src-tauri/src/search/query.rs`.

User text is parsed once into `StructuredQuery`:

```text
StructuredQuery
|-- SearchTerm::Text(QueryToken)
`-- SearchTerm::Tag(QueryToken)
```

Backends then compile or render the structured query into their native format:

- SQLite FTS5 renders it into `MATCH` syntax.
- Tantivy builds `BooleanQuery`, `BoostQuery`, `PhrasePrefixQuery`,
  `TermQuery`, and `PhraseQuery` objects directly.

Tantivy query construction must use the index tokenizer before creating terms,
so lowercase normalization and Lindera tokenization are not bypassed.

## Storage And Index Roles

SQLite is the source of truth for indexed items.

SQLite owns:

- item identity
- title
- source path
- updated timestamp
- source fingerprints for full-scan freshness checks
- preview payloads and preview URLs
- open actions
- star/hidden/boost metadata
- tags and aliases
- stats and tag-cloud queries
- source-path cleanup queries

Tantivy owns:

- full-text inverted index
- tokenized title/tag/alias/body fields
- searchable body text
- ranking inputs duplicated from SQLite: star, hidden, updated timestamp, boost

Tantivy does not own canonical item data. Search hits return IDs and scores;
the final `SearchResult` is hydrated from SQLite.

Each target group keeps its derived search artifacts under that group's primary
target directory:

- `.glimpse/index.db`
- `.glimpse/tantivy/`

Target group switching should reuse those local artifacts. It must switch the
current SQLite connection, switch the Tantivy reader/writer state, and restart
the watcher; it should not run a full scan.

Foreground runtime switches are serialized only for the short section that
mutates the shared current SQLite connection, Tantivy state, and watcher. A
manual full scan runs against target-local temporary artifacts instead of the
shared current engine. When it finishes, the runtime swaps the temporary
SQLite/Tantivy artifacts into the target group's `.glimpse/` directory only if
that target is still current. Target switching aborts any running manual full
scan and does not wait for the scan loop to finish, so a scan that started for
one target cannot write later batches into another target group's active
runtime.

Full scans happen only at these lifecycle points:

- manual full scan button: scan the current target group
- app startup: scan the current target group, then asynchronously warm active
  non-current target groups one by one

Normal full scans do not delete every existing item in the current target
before reindexing. They remove only missing or out-of-scope source paths, then
skip unchanged source files before parser dispatch. SQLite stores a
`source_fingerprints` row per parsed source with canonical `source_path`,
derived `source_id`, filesystem `modified_at`, `size_bytes`, indexed
`item_count`, and a reserved nullable `content_hash`. A source is considered
unchanged only when the current fingerprint matches the stored row and the
stored `item_count` still matches the actual rows for that source. Changed
sources are parsed and replaced source-by-source: existing rows for the derived
`source_id` are deleted, parsed replacement rows are inserted, and the source
fingerprint is updated in the same SQLite transaction. Tantivy applies the same
source replacement by deleting captured old item IDs and adding replacement
documents in one writer commit. This avoids surfacing large "deleted" counts
when files have not changed, while removing stale `.gjson` sub-items when a
source file still exists but its item list shrinks.

Startup warming repopulates each active target group's `.glimpse/` artifacts
and loads the warmed Tantivy index into the runtime engine cache so the first
later switch to that target can reuse the cached state. If the user starts a
manual full scan or switches target groups while startup warming is still
running, the background warm task is aborted so foreground index work does not
contend with it.

Startup warm progress is exposed through `IndexingStats.startupWarm`. The
frontend polls indexing stats during startup, shows a compact running indicator
in the status bar, and surfaces detailed state on the Debug page. The warm state
tracks status, current target group, completed group count, total group count,
and the last abort/error reason when applicable.

Search runs against the current target group. To search another target group,
the user switches target groups and keeps the same query.

## Consistency Strategy

The consistency model is SQLite-first, Tantivy-second.

For upserts:

1. Open SQLite transaction: start the canonical item-store write.
2. Write `IndexItem` rows: persist the replacement item metadata, preview, open action, tags, and aliases.
3. Commit SQLite: make the canonical item state durable before touching Tantivy.
4. Open Tantivy writer: prepare the derived full-text index update.
5. Delete old Tantivy docs: remove previous documents for the affected item IDs.
6. Add replacement docs: index the new item and chunk documents.
7. Commit Tantivy: make the derived search update durable.
8. Reload reader: expose the committed Tantivy changes to search.

For source replacements during full scan:

1. Read affected SQLite IDs: capture the existing item IDs for the source before deleting rows.
2. Open SQLite transaction: start the source-local replacement.
3. Delete rows for `source_id`: remove stale items produced by the same source.
4. Write parsed replacement items: insert the newly parsed items.
5. Record source fingerprint: store freshness metadata for future skip checks.
6. Commit SQLite: make the new source-derived state canonical.
7. Open Tantivy writer: prepare the derived index replacement.
8. Delete captured old docs: remove Tantivy documents for the previously captured IDs.
9. Add replacement docs: index the new item and chunk documents.
10. Commit and reload Tantivy: publish the derived search state.

For deletes:

1. Read affected SQLite IDs: capture the item IDs before deleting canonical rows.
2. Open SQLite transaction: start the canonical delete.
3. Delete item-store rows: remove the item metadata, preview, open action, tags, and aliases.
4. Commit SQLite: make the canonical delete durable.
5. Open Tantivy writer: prepare the derived index cleanup.
6. Delete captured Tantivy docs: remove documents for the captured item IDs.
7. Commit Tantivy: make the derived cleanup durable.
8. Reload reader: expose the delete to search.

SQLite commits before Tantivy commits because SQLite is the durable canonical
store. Tantivy is allowed to lag temporarily, but it must never become the only
place where canonical item data exists.

## Read Path

Search reads from Tantivy first, then SQLite.

1. `SearchRequest`: receives the structured frontend search request.
2. `StructuredQuery`: parses backend search terms and tag filters once.
3. Tantivy query: compiles the structured query into the active full-text backend.
4. Hit IDs and scores: returns ranked candidate item IDs from Tantivy.
5. SQLite item-store hydration: loads canonical item metadata, preview payloads, and open actions.
6. `SearchResult[]`: returns item-level results to the frontend.

If Tantivy returns an ID that no longer exists in SQLite, hydration skips that
hit. This handles short-lived inconsistency after a partial delete/update and
keeps stale index entries from leaking full item data to the UI.

Empty queries do not use Tantivy. They read recent items directly from SQLite.

## Snippet API Contract

Search results stay item-level even when Tantivy indexing becomes chunk-level.
Backends may attach optional snippets to explain why an item matched:

```ts
type SearchResult = {
  item: IndexItem;
  score: number;
  snippets?: SearchSnippet[];
};

type SearchSnippet = {
  source: "body" | "title" | "alias" | "tag";
  fragments: Array<{
    text: string;
    matched: boolean;
  }>;
  chunk?: {
    ordinal: number;
    startByte: number;
    endByte: number;
  };
};
```

Snippet fragments are plain text, not HTML. The frontend owns rendering and
highlight styling based on `matched`.

Snippets are optional. Empty-query recent items, legacy SQLite search results,
and any backend that cannot produce snippets cheaply should omit the field.

Tantivy snippets should be produced from stored Tantivy hit fields, not by
hydrating large SQLite preview bodies. SQLite hydration remains responsible for
canonical item metadata, preview payloads, and open actions.

## Chunk Boundary

Tantivy indexing goes through `src-tauri/src/search/tantivy/chunk.rs`.

The chunker emits one or more `IndexChunk` values per `IndexItem`. Short bodies
remain a single chunk. Longer bodies are split around an 8 KiB target size with
a 512 byte overlap so terms near a boundary can still produce useful matches
and snippets. Boundary selection prefers Markdown heading starts, then paragraph
breaks, then line breaks, then sentence terminators such as Japanese `。` and
English `.`, then whitespace before falling back to a hard UTF-8 character
boundary.

Chunk byte offsets always refer to the original preview body. A chunk's
`chunk_text` must equal `body[chunk_start_byte..chunk_end_byte]`.

Every chunk document stores the canonical SQLite item ID in the Tantivy `id`
field. Deletes still remove all Tantivy documents for an item by deleting that
item ID term.

The Tantivy schema is chunk-aware. Chunk documents store:

- `doc_kind`
- `chunk_text`
- `chunk_ordinal`
- `chunk_start_byte`
- `chunk_end_byte`
- `tags_filter`
- `chunk_item_context`

`chunk_text` exists for future snippet generation and should not be treated as
canonical preview storage.

## Item And Chunk Documents

Tantivy uses two logical document kinds:

- `item`
- `chunk`

Item documents own item-level searchable text:

- title
- aliases
- tags
- ranking inputs: star, hidden, updated timestamp, boost

Chunk documents own body-level searchable text:

- body chunk text
- stored `chunk_text` for snippet generation
- chunk ordinal and byte offsets
- ranking inputs copied from the item
- exact tag filter values copied from the item
- minimal item context copied from the item: title, aliases, and tags

Chunk documents copy title, aliases, and tags into `chunk_item_context` so a
query that combines item-level and body-level text, such as `title-term
body-term`, can match one chunk document. This context field is not stored and
is not used for snippets.

Title-only, alias-only, and tag-display-only queries should still be satisfied
by item documents. Chunk documents are only allowed to satisfy plain-text
queries when at least one plain-text term also matches the chunk body. This
prevents item-level-only searches from producing one hit per chunk and
distorting `TopDocs` ranking.

Chunk documents still carry the canonical SQLite item ID in `id`. This keeps
delete-by-item simple: deleting the item ID term removes both the item document
and all chunk documents for that item.

`tags_filter` is copied onto chunk documents so mixed queries such as
`#tag body term` can constrain body matches without joining against SQLite or
requiring tag text to be duplicated into body chunks.

Search results remain item-level. Hits from item documents and chunk documents
are accumulated by item ID before SQLite hydration.

## Doc-Kind-Aware Querying

Tantivy query construction is aware of `doc_kind`.

Plain text terms are compiled into two branches:

- item branch: `doc_kind:item` plus title, aliases, and tag display text
- chunk branch: `doc_kind:chunk` plus body text and minimal item context

The item and chunk branches are combined as alternatives for the full query.
Within the chunk branch, every plain-text term may match either the chunk body
or `chunk_item_context`, but at least one plain-text term must match the chunk
body.

Tag-only queries target item documents only. This avoids returning one match per
body chunk for a simple `#tag` search.

Mixed tag and text queries also allow chunk documents through `tags_filter`, so
queries such as `#tag body-term` can match body chunks while still respecting
the tag filter.

Queries that span item-level and body-level text, such as `title-term
body-term` or `alias-term body-term`, match chunk documents through
`chunk_item_context` and return body snippets from the matching chunk.

Search hits are collapsed back to item IDs before SQLite hydration. If multiple
chunks for the same item match a query, the best adjusted score for that item is
kept and the UI still receives item-level results.

## Snippet Builder

Tantivy snippets are built in `src-tauri/src/search/tantivy/snippet.rs` while
the stored Tantivy hit document is still available.

The builder currently emits at most one snippet candidate per Tantivy hit:

- chunk documents produce `body` snippets from stored `chunk_text`
- body snippets include chunk ordinal and byte offsets
- item documents can produce `alias`, `tag`, or `title` snippets
- title snippets are fallback snippets for title-only item hits

The hit accumulator carries the best snippet candidate through item-level
deduplication. SQLite hydration then attaches the retained snippets to the
returned `SearchResult`.

Snippet candidates prefer body evidence first, then aliases, tags, and finally
title. Title is last because the title is already visible in the result row, but
title-only hits still get a highlighted explanation instead of an empty snippet
area.

Snippet fragments are bounded, plain text, and mark only the matched span with
`matched: true`. The backend does not emit HTML.

## Snippet Navigation

Body snippets may include `chunk.ordinal`, `chunk.startByte`, and
`chunk.endByte`. The frontend uses these original-body byte offsets to navigate
from a result-list snippet back to the source preview.

Clicking a body snippet activates the live preview tab. Markdown previews switch
to raw mode before reveal because the stored chunk offsets refer to the raw
preview body, not rendered Markdown nodes. Raw previews convert UTF-8 byte
offsets to JavaScript string indexes, highlight the byte range, and scroll it
into view.

Snippets without chunk metadata still select the row and activate the live
preview, but they do not perform a range reveal.

## TopDocs Fetch Width

Tantivy search initially fetches `requested_limit * 4` raw `TopDocs` hits and
collects the same number of unique item-level candidates before final
hydration/truncation when enough raw hits are available.

Because chunk indexing can produce many Tantivy hits for the same item, the
engine expands the raw hit width when item-level deduplication leaves too few
unique candidates. Expansion doubles the width each retry and stops when:

- enough unique item candidates were collected
- Tantivy returned fewer raw hits than requested, meaning the result set was
  exhausted
- the configured maximum fetch width was reached

The maximum is capped to keep broad queries bounded. This makes chunk-heavy
indexes less likely to under-fill item-level search results or let duplicate
chunks hide boosted/starred candidates without making every query pay the
largest possible `TopDocs` cost.

## Failure Handling

The intended failure behavior is:

- SQLite write fails: abort the operation; do not mutate Tantivy.
- SQLite commit succeeds, Tantivy write fails: SQLite remains canonical;
  Tantivy may be stale until reindex/recovery.
- Tantivy commit succeeds, reader reload fails: the index is durable but the
  current reader may not see it until the next successful reload or index switch.
- Search hit hydration misses SQLite rows: skip those hits.

This is eventual consistency between SQLite and Tantivy, with SQLite as the
authoritative state.

## Recovery

The indexer can rebuild derived search state from source files.

Recovery should recreate both derived artifacts for the active target group:

- `.glimpse/index.db`
- `.glimpse/tantivy/`

After recovery, a full scan repopulates SQLite first and then Tantivy through
the normal write path.

Do not attempt to recover canonical item data from Tantivy. Tantivy stores only
the fields needed for search and ranking, not full preview/open-action state.

Tantivy also stores its own schema version marker inside `.glimpse/tantivy/`.
When the marker is missing, invalid, or different from the compiled schema
version, the Tantivy index directory is recreated and then repopulated by the
normal indexing path.

## Lifecycle Ownership

Tantivy writer lifecycle is centralized in
`src-tauri/src/search/tantivy/writer.rs`.

Only that module should:

- create `IndexWriter`
- mutate Tantivy documents
- call `commit()`
- reload the reader after commit

Search code should use the current reader without forcing a reload on every
query. Reader visibility is advanced by successful writer commits.

## Invariants

Keep these invariants true when changing search code:

- SQLite item store is canonical.
- Tantivy chunk document IDs match SQLite item IDs exactly.
- Upsert deletes the old Tantivy document before adding the replacement.
- Delete captures SQLite IDs before deleting SQLite rows.
- A successful SQLite commit is required before a Tantivy mutation.
- A successful Tantivy commit is followed by reader reload.
- Multiple Tantivy hits for the same item are collapsed before SQLite hydration.
- Search results are hydrated from SQLite before returning to the frontend.
- Empty query/recent-items results come from SQLite.
- Stats and tag cloud come from SQLite, not Tantivy.

## Legacy SQLite FTS5 Backend

`src-tauri/src/search/sqlite/` remains as the legacy SQLite FTS5 backend.

Its repository module is intentionally limited to synchronizing the FTS5
`search_index` table. Generic item persistence lives in
`src-tauri/src/store/item_repository.rs`.

The legacy backend follows the same canonical-store rule: item rows are durable
state; the FTS5 table is derived search state.
