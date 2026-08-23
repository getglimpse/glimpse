//! SQL statements used by the SQLite FTS5 search backend.
//!
//! Generic item persistence SQL lives in `store::item_sql`. This module only
//! keeps SQL that is specific to SQLite FTS5 search and fallback behavior.

/// Selects items matching a SQLite FTS5 query.
///
/// Ranking is calculated using SQLite BM25 and multiplied by the item's
/// metadata boost value.
///
/// Column order must match `mapper::map_search_result`.
pub const SELECT_MATCHED_ITEMS: &str = r#"
SELECT
    i.id,
    i.title,
    i.source_path,
    COALESCE(m.star, 0) AS star,
    COALESCE(m.hidden, 0) AS hidden,
    i.updated_at,
    i.preview_type,
    i.preview_content,
    i.preview_url,
    i.open_type,
    i.open_url,
    i.open_command_path,
    (-bm25(search_index)) * COALESCE(NULLIF(m.boost, 0), 1.0) AS rank,
    COALESCE(s.tags, '') AS tags_str,
    COALESCE(s.aliases, '') AS aliases_str
FROM search_index s
JOIN items i
    ON i.id = s.id
LEFT JOIN item_metadata m
    ON m.item_id = i.id
WHERE search_index MATCH ?
  AND COALESCE(m.hidden, 0) = ?
ORDER BY
    star DESC,
    rank DESC,
    i.updated_at DESC
LIMIT ?
"#;

/// Deletes an item from the FTS5 search index.
///
/// FTS rows are deleted before reinsertion because FTS5 tables are handled
/// separately from normal item upserts.
pub const DELETE_SEARCH_INDEX: &str = r#"
DELETE FROM search_index
WHERE id = ?
"#;

/// Deletes FTS5 rows by source item ID.
///
/// Used for source-level refresh/delete. Markdown uses exact IDs, while JSON
/// index files use prefixed IDs such as `docs/links.json::0`.
pub const DELETE_SEARCH_INDEX_BY_SOURCE_ID: &str = r#"
DELETE FROM search_index
WHERE id = ?
   OR id LIKE ?
"#;

pub const DELETE_SEARCH_INDEX_BY_SOURCE_PATH: &str = r#"
DELETE FROM search_index
WHERE id IN (
    SELECT id
    FROM items
    WHERE source_path = ?1
)
"#;

/// Inserts an item into the FTS5 search index.
pub const INSERT_SEARCH_INDEX: &str = r#"
INSERT INTO search_index (
    id,
    title,
    tags,
    aliases,
    preview_content
)
VALUES (?, ?, ?, ?, ?)
"#;

/// Selects a bounded candidate set for in-memory fuzzy filtering.
///
/// Fuzzy scoring is performed in Rust after these rows are loaded.
///
/// Column order must match `mapper::map_search_result`.
pub const SELECT_FUZZY_CANDIDATES: &str = r#"
SELECT
    i.id,
    i.title,
    i.source_path,
    COALESCE(m.star, 0) AS star,
    COALESCE(m.hidden, 0) AS hidden,
    i.updated_at,
    i.preview_type,
    i.preview_content,
    i.preview_url,
    i.open_type,
    i.open_url,
    i.open_command_path,
    0.0 AS rank,
    COALESCE(s.tags, '') AS tags_str,
    COALESCE(s.aliases, '') AS aliases_str
FROM items i
LEFT JOIN item_metadata m
    ON m.item_id = i.id
LEFT JOIN search_index s
    ON s.id = i.id
WHERE COALESCE(m.hidden, 0) = ?
ORDER BY
    star DESC,
    i.updated_at DESC
LIMIT ?
"#;
