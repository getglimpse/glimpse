//! SQL statements for the durable indexed item store.

/// Selects the most recently updated items.
///
/// Used when the search query is empty.
pub const SELECT_RECENT_ITEMS: &str = r#"
SELECT
    i.id,
    i.title,
    i.source_path,
    COALESCE(m.star, 0) AS star,
    COALESCE(m.hidden, 0) AS hidden,
    i.updated_at,
    i.preview_type,
    NULL AS preview_content,
    i.preview_url,
    i.item_url,
    i.item_command,
    i.default_action,
    0.0 AS rank,
    '' AS tags_str,
    '' AS aliases_str
FROM items i
LEFT JOIN item_metadata m
    ON m.item_id = i.id
WHERE COALESCE(m.hidden, 0) = ?
ORDER BY
    star DESC,
    i.updated_at DESC
LIMIT ?
"#;

pub const SELECT_PREVIEW_BY_ID: &str = r#"
SELECT
    preview_type,
    preview_content,
    preview_url
FROM items
WHERE id = ?
"#;

pub const SELECT_ITEM_SUMMARY_BY_ID: &str = r#"
SELECT
    i.id,
    i.title,
    i.source_path,
    COALESCE(m.star, 0) AS star,
    COALESCE(m.hidden, 0) AS hidden,
    i.updated_at,
    i.preview_type,
    CASE
        WHEN i.preview_type = 'pluginViewer' THEN i.preview_content
        ELSE NULL
    END AS preview_content,
    i.preview_url,
    i.item_url,
    i.item_command,
    i.default_action,
    ?2 AS rank,
    COALESCE(
        (
            SELECT GROUP_CONCAT(t.tag, ' ')
            FROM item_tags t
            WHERE t.item_id = i.id
        ),
        ''
    ) AS tags_str,
    COALESCE(
        (
            SELECT GROUP_CONCAT(a.alias, ' ')
            FROM item_aliases a
            WHERE a.item_id = i.id
        ),
        ''
    ) AS aliases_str
FROM items i
LEFT JOIN item_metadata m
    ON m.item_id = i.id
WHERE i.id = ?1
"#;

pub const UPSERT_ITEM: &str = r#"
INSERT OR REPLACE INTO items (
    id,
    title,
    source_path,
    updated_at,
    preview_type,
    preview_content,
    preview_url,
    item_url,
    item_command,
    default_action
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"#;

pub const UPSERT_ITEM_METADATA: &str = r#"
INSERT OR REPLACE INTO item_metadata (
    item_id,
    star,
    hidden,
    boost,
    updated_at
)
VALUES (?, ?, ?, ?, ?)
"#;

pub const DELETE_ITEM_TAGS: &str = r#"
DELETE FROM item_tags
WHERE item_id = ?
"#;

pub const INSERT_ITEM_TAG: &str = r#"
INSERT OR IGNORE INTO item_tags (
    item_id,
    tag
)
VALUES (?, ?)
"#;

pub const DELETE_ITEM_ALIASES: &str = r#"
DELETE FROM item_aliases
WHERE item_id = ?
"#;

pub const INSERT_ITEM_ALIAS: &str = r#"
INSERT OR IGNORE INTO item_aliases (
    item_id,
    alias
)
VALUES (?, ?)
"#;

pub const DELETE_ITEM: &str = r#"
DELETE FROM items
WHERE id = ?
"#;

pub const DELETE_SOURCE_FINGERPRINT_BY_SOURCE_ID: &str = r#"
DELETE FROM source_fingerprints
WHERE source_id = ?1
"#;

pub const DELETE_SOURCE_FINGERPRINT_BY_SOURCE_PATH: &str = r#"
DELETE FROM source_fingerprints
WHERE source_path = ?1
"#;

pub const DELETE_ITEMS_BY_SOURCE_ID: &str = r#"
DELETE FROM items
WHERE id = ?
   OR id LIKE ?
"#;

pub const DELETE_ITEMS_BY_SOURCE_PATH: &str = r#"
DELETE FROM items
WHERE source_path = ?1
"#;

pub const LIST_SOURCE_PATHS: &str = r#"
SELECT DISTINCT source_path
FROM items
WHERE source_path IS NOT NULL
  AND source_path != ''
UNION
SELECT source_path
FROM source_fingerprints
WHERE source_path IS NOT NULL
  AND source_path != ''
"#;

pub const LIST_ITEM_IDS_BY_SOURCE_ID: &str = r#"
SELECT id
FROM items
WHERE id = ?1
   OR id LIKE ?2
"#;

pub const LIST_ITEM_IDS_BY_SOURCE_PATH: &str = r#"
SELECT id
FROM items
WHERE source_path = ?1
"#;

pub const UPSERT_SOURCE_FINGERPRINT: &str = r#"
INSERT OR REPLACE INTO source_fingerprints (
    source_path,
    source_id,
    modified_at,
    size_bytes,
    item_count,
    content_hash,
    updated_at
)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
"#;

pub const COUNT_UNCHANGED_SOURCE_ITEMS: &str = r#"
SELECT
    f.item_count,
    COUNT(i.id) AS actual_count
FROM source_fingerprints f
LEFT JOIN items i
    ON i.source_path = f.source_path
   AND (i.id = f.source_id OR i.id LIKE ?5)
WHERE f.source_path = ?1
  AND f.source_id = ?2
  AND f.modified_at = ?3
  AND f.size_bytes = ?4
  AND f.content_hash IS NULL
GROUP BY f.item_count
"#;

pub const SELECT_TAG_CLOUD: &str = r#"
SELECT
    t.tag,
    COUNT(*) AS count
FROM item_tags t
LEFT JOIN item_metadata m
    ON m.item_id = t.item_id
WHERE COALESCE(m.hidden, 0) = 0
GROUP BY
    t.tag
ORDER BY
    count DESC,
    t.tag ASC
"#;
