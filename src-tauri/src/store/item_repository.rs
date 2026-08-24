//! SQLite persistence functions for indexed items.
//!
//! This module contains low-level database operations used by search backends,
//! statistics commands, preview loading, and indexing cleanup.
//!
//! Responsibilities:
//!
//! - Persist [`IndexItem`] values into normalized SQLite tables.
//! - Delete indexed items.
//! - List indexed source paths.
//! - Collect application statistics.
//!
//! This module does not decide when indexing should happen.
//! It only performs database reads and writes requested by higher-level
//! services.

use crate::models::stats::{AppStats, TagCloudEntry};
use crate::models::{DefaultAction, IndexItem, Preview};
use crate::search::{SearchError, SearchResult, SourceFingerprint, SourceReplacement};
use crate::store::{item_mapper::map_search_result, item_sql as sql};
use chrono::Utc;
use rusqlite::{params, Connection, Transaction};

pub fn get_preview(conn: &Connection, id: &str) -> Result<Option<Preview>, SearchError> {
    let mut stmt = conn
        .prepare(sql::SELECT_PREVIEW_BY_ID)
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    let result = stmt.query_row([id], |row| {
        let preview_type: String = row.get(0)?;
        let preview_content: Option<String> = row.get(1)?;
        let preview_url: Option<String> = row.get(2)?;

        Ok(match preview_type.as_str() {
            "markdown" => Preview::Markdown {
                content: preview_content.unwrap_or_default(),
            },
            "raw" => Preview::Raw {
                content: preview_content.unwrap_or_default(),
            },
            "external" => Preview::External {
                url: preview_url.unwrap_or_default(),
            },
            "pluginViewer" => Preview::PluginViewer {
                plugin_id: preview_content.unwrap_or_default(),
                viewer_id: preview_url.unwrap_or_default(),
            },
            _ => Preview::Markdown {
                content: String::new(),
            },
        })
    });

    match result {
        Ok(preview) => Ok(Some(preview)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(SearchError::DbError(e.to_string())),
    }
}

pub fn get_item_summary(
    conn: &Connection,
    id: &str,
    score: f32,
) -> Result<Option<SearchResult>, SearchError> {
    let mut stmt = conn
        .prepare(sql::SELECT_ITEM_SUMMARY_BY_ID)
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    let result = stmt.query_row(params![id, score], map_search_result);

    match result {
        Ok(item) => Ok(Some(item)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(SearchError::DbError(error.to_string())),
    }
}

pub fn recent_items(
    conn: &Connection,
    limit: usize,
    hidden_only: bool,
) -> Result<Vec<SearchResult>, SearchError> {
    let mut stmt = conn
        .prepare(sql::SELECT_RECENT_ITEMS)
        .map_err(|error| SearchError::DbError(error.to_string()))?;

    let hidden_i64 = if hidden_only { 1_i64 } else { 0_i64 };
    let rows = stmt
        .query_map([hidden_i64, limit as i64], map_search_result)
        .map_err(|error| SearchError::DbError(error.to_string()))?;

    let mut results = Vec::new();

    for row in rows {
        results.push(row.map_err(|error| SearchError::DbError(error.to_string()))?);
    }

    Ok(results)
}

/// Persists an [`IndexItem`] into SQLite storage.
///
/// This function synchronizes:
///
/// - `items` table
/// - `item_metadata` table
/// - `item_tags` relation table
/// - `item_aliases` relation table
///
/// The caller provides a transaction so that all related writes succeed or
/// fail together.
pub fn upsert_item(tx: &Transaction, item: &IndexItem) -> Result<(), SearchError> {
    let (preview_type, preview_content, preview_url) = match &item.preview {
        Preview::Markdown { content } => ("markdown", Some(content.clone()), None),
        Preview::Raw { content } => ("raw", Some(content.clone()), None),
        Preview::External { url } => ("external", None, Some(url.clone())),
        Preview::PluginViewer {
            plugin_id,
            viewer_id,
        } => (
            "pluginViewer",
            Some(plugin_id.clone()),
            Some(viewer_id.clone()),
        ),
    };

    let default_action = item.default_action.as_ref().map(|action| match action {
        DefaultAction::Url => "url",
        DefaultAction::Command => "command",
    });

    tx.execute(
        sql::UPSERT_ITEM,
        params![
            item.id,
            item.title,
            item.source_path,
            item.updated_at.to_rfc3339(),
            preview_type,
            preview_content,
            preview_url,
            item.url.as_deref(),
            item.command.as_deref(),
            default_action,
        ],
    )
    .map_err(|e| SearchError::DbError(e.to_string()))?;

    tx.execute(
        sql::UPSERT_ITEM_METADATA,
        params![
            item.id,
            if item.metadata.star { 1 } else { 0 },
            if item.metadata.hidden { 1 } else { 0 },
            item.metadata.normalized_boost(),
            item.updated_at.to_rfc3339(),
        ],
    )
    .map_err(|e| SearchError::DbError(e.to_string()))?;

    tx.execute(sql::DELETE_ITEM_TAGS, params![item.id])
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    for tag in &item.metadata.tags {
        tx.execute(sql::INSERT_ITEM_TAG, params![item.id, tag])
            .map_err(|e| SearchError::DbError(e.to_string()))?;
    }

    tx.execute(sql::DELETE_ITEM_ALIASES, params![item.id])
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    for alias in &item.metadata.aliases {
        tx.execute(sql::INSERT_ITEM_ALIAS, params![item.id, alias])
            .map_err(|e| SearchError::DbError(e.to_string()))?;
    }

    Ok(())
}

/// Deletes an indexed item from SQLite.
///
/// Removes:
/// - item row
/// - source fingerprint when the item ID is also the source ID
///
/// Related metadata, tags, and aliases are expected to be removed through
/// SQLite foreign-key cascades from the `items` table.
pub fn delete_item(tx: &Transaction, id: &str) -> Result<(), SearchError> {
    tx.execute(sql::DELETE_ITEM, params![id])
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    tx.execute(sql::DELETE_SOURCE_FINGERPRINT_BY_SOURCE_ID, params![id])
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    Ok(())
}

/// Deletes all indexed items originating from the same source.
///
/// Markdown files generate a single item whose ID is the source ID.
///
/// JSON index files generate multiple items using the following pattern:
///
/// ```text
/// <source_id>::0
/// <source_id>::1
/// <source_id>::2
/// ```
///
/// Therefore this function removes:
///
/// - the exact source ID
/// - all IDs prefixed with `<source_id>::`
pub fn delete_items_by_source_id(tx: &Transaction, source_id: &str) -> Result<(), SearchError> {
    let pattern = format!("{}::%", source_id);

    tx.execute(sql::DELETE_ITEMS_BY_SOURCE_ID, params![source_id, pattern])
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    tx.execute(
        sql::DELETE_SOURCE_FINGERPRINT_BY_SOURCE_ID,
        params![source_id],
    )
    .map_err(|e| SearchError::DbError(e.to_string()))?;

    Ok(())
}

/// Deletes all indexed items originating from a source path.
///
/// Markdown sources typically produce one item, while `.gjson` files may
/// produce multiple items. All matching rows are removed together.
pub fn delete_items_by_source_path(tx: &Transaction, source_path: &str) -> Result<(), SearchError> {
    tx.execute(sql::DELETE_ITEMS_BY_SOURCE_PATH, params![source_path])
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    tx.execute(
        sql::DELETE_SOURCE_FINGERPRINT_BY_SOURCE_PATH,
        params![source_path],
    )
    .map_err(|e| SearchError::DbError(e.to_string()))?;

    Ok(())
}

/// Lists all indexed source paths.
///
/// Used by cleanup routines to compare indexed files against the current
/// filesystem state.
pub fn list_source_paths(conn: &Connection) -> Result<Vec<String>, SearchError> {
    let mut stmt = conn
        .prepare(sql::LIST_SOURCE_PATHS)
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    let mut paths = Vec::new();

    for row in rows {
        paths.push(row.map_err(|e| SearchError::DbError(e.to_string()))?);
    }

    Ok(paths)
}

pub fn list_item_ids_by_source_id(
    conn: &Connection,
    source_id: &str,
) -> Result<Vec<String>, SearchError> {
    let pattern = format!("{}::%", source_id);

    list_item_ids(
        conn,
        sql::LIST_ITEM_IDS_BY_SOURCE_ID,
        params![source_id, pattern],
    )
}

pub fn list_item_ids_by_source_path(
    conn: &Connection,
    source_path: &str,
) -> Result<Vec<String>, SearchError> {
    list_item_ids(
        conn,
        sql::LIST_ITEM_IDS_BY_SOURCE_PATH,
        params![source_path],
    )
}

pub fn unchanged_source_item_count(
    conn: &Connection,
    fingerprint: &SourceFingerprint,
) -> Result<Option<usize>, SearchError> {
    let source_id_pattern = format!("{}::%", fingerprint.source_id);
    let size_bytes = i64::try_from(fingerprint.size_bytes)
        .map_err(|error| SearchError::DbError(error.to_string()))?;

    let result = conn.query_row(
        sql::COUNT_UNCHANGED_SOURCE_ITEMS,
        params![
            fingerprint.source_path,
            fingerprint.source_id,
            fingerprint.modified_at.to_rfc3339(),
            size_bytes,
            source_id_pattern,
        ],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    );

    match result {
        Ok((fingerprint_item_count, actual_item_count))
            if fingerprint_item_count == actual_item_count =>
        {
            Ok(Some(fingerprint_item_count as usize))
        }
        Ok(_) | Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(SearchError::DbError(error.to_string())),
    }
}

pub fn upsert_source_fingerprint(
    conn: &Connection,
    fingerprint: &SourceFingerprint,
    item_count: usize,
) -> Result<(), SearchError> {
    let size_bytes = i64::try_from(fingerprint.size_bytes)
        .map_err(|error| SearchError::DbError(error.to_string()))?;
    let item_count =
        i64::try_from(item_count).map_err(|error| SearchError::DbError(error.to_string()))?;

    conn.execute(
        sql::UPSERT_SOURCE_FINGERPRINT,
        params![
            fingerprint.source_path,
            fingerprint.source_id,
            fingerprint.modified_at.to_rfc3339(),
            size_bytes,
            item_count,
            fingerprint.content_hash,
            Utc::now().to_rfc3339(),
        ],
    )
    .map_err(|error| SearchError::DbError(error.to_string()))?;

    Ok(())
}

pub fn replace_source_items(
    conn: &mut Connection,
    source_id: &str,
    items: &[IndexItem],
    fingerprint: Option<&SourceFingerprint>,
) -> Result<(), SearchError> {
    replace_sources(
        conn,
        &[SourceReplacement::new(
            source_id,
            items.to_vec(),
            fingerprint.cloned(),
        )],
    )
}

pub fn replace_sources(
    conn: &mut Connection,
    replacements: &[SourceReplacement],
) -> Result<(), SearchError> {
    let tx = conn
        .transaction()
        .map_err(|error| SearchError::DbError(error.to_string()))?;

    for replacement in replacements {
        delete_items_by_source_id(&tx, &replacement.source_id)?;

        for item in &replacement.items {
            upsert_item(&tx, item)?;
        }

        if let Some(fingerprint) = replacement.fingerprint.as_ref() {
            upsert_source_fingerprint_in_transaction(&tx, fingerprint, replacement.items.len())?;
        }
    }

    tx.commit()
        .map_err(|error| SearchError::DbError(error.to_string()))?;

    Ok(())
}

fn upsert_source_fingerprint_in_transaction(
    tx: &Transaction,
    fingerprint: &SourceFingerprint,
    item_count: usize,
) -> Result<(), SearchError> {
    let size_bytes = i64::try_from(fingerprint.size_bytes)
        .map_err(|error| SearchError::DbError(error.to_string()))?;
    let item_count =
        i64::try_from(item_count).map_err(|error| SearchError::DbError(error.to_string()))?;

    tx.execute(
        sql::UPSERT_SOURCE_FINGERPRINT,
        params![
            fingerprint.source_path,
            fingerprint.source_id,
            fingerprint.modified_at.to_rfc3339(),
            size_bytes,
            item_count,
            fingerprint.content_hash,
            Utc::now().to_rfc3339(),
        ],
    )
    .map_err(|error| SearchError::DbError(error.to_string()))?;

    Ok(())
}

fn list_item_ids<P>(conn: &Connection, sql: &str, params: P) -> Result<Vec<String>, SearchError>
where
    P: rusqlite::Params,
{
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    let rows = stmt
        .query_map(params, |row| row.get::<_, String>(0))
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    let mut ids = Vec::new();

    for row in rows {
        ids.push(row.map_err(|e| SearchError::DbError(e.to_string()))?);
    }

    Ok(ids)
}

/// Collects aggregate statistics about the indexed workspace.
///
/// These values are used by the frontend stats/debug views and are derived
/// directly from SQLite tables.
pub fn get_app_stats(conn: &Connection) -> Result<AppStats, SearchError> {
    Ok(AppStats {
        total_items: count(conn, "SELECT COUNT(*) FROM items")?,

        markdown_items: count(
            conn,
            "SELECT COUNT(*) FROM items WHERE preview_type = 'markdown'",
        )?,

        raw_items: count(
            conn,
            "SELECT COUNT(*) FROM items WHERE preview_type = 'raw'",
        )?,

        external_items: count(
            conn,
            "SELECT COUNT(*) FROM items WHERE preview_type = 'external'",
        )?,

        command_items: count(
            conn,
            "SELECT COUNT(*) FROM items WHERE item_command IS NOT NULL AND item_command != ''",
        )?,

        external_open_items: count(
            conn,
            "SELECT COUNT(*) FROM items WHERE item_url IS NOT NULL AND item_url != ''",
        )?,

        star_items: count(
            conn,
            r#"
            SELECT COUNT(*)
            FROM item_metadata
            WHERE star = 1
            "#,
        )?,

        tagged_items: count(
            conn,
            r#"
            SELECT COUNT(DISTINCT item_id)
            FROM item_tags
            "#,
        )?,

        alias_items: count(
            conn,
            r#"
            SELECT COUNT(DISTINCT item_id)
            FROM item_aliases
            "#,
        )?,
    })
}

/// Returns tag usage counts for visible indexed items.
pub fn get_tag_cloud(conn: &Connection) -> Result<Vec<TagCloudEntry>, SearchError> {
    let mut stmt = conn
        .prepare(sql::SELECT_TAG_CLOUD)
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TagCloudEntry {
                tag: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    let mut tags = Vec::new();

    for row in rows {
        tags.push(row.map_err(|e| SearchError::DbError(e.to_string()))?);
    }

    Ok(tags)
}

/// Executes a `COUNT(*)` query and returns the result.
///
/// This helper is intentionally small and only used for stats collection.
fn count(conn: &Connection, sql: &str) -> Result<i64, SearchError> {
    conn.query_row(sql, [], |row| row.get(0))
        .map_err(|e| SearchError::DbError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::Utc;

    use crate::models::{DefaultAction, IndexItem, Preview};
    use crate::test_utils::fixtures::create_test_db;

    fn sample_item() -> IndexItem {
        IndexItem::new(
            "item-1",
            "Rust Notes",
            Utc::now(),
            Preview::Markdown {
                content: "hello rust".to_string(),
            },
        )
        .with_tags(vec!["rust".to_string(), "tauri".to_string()])
        .with_aliases(vec!["rs".to_string(), "rustlang".to_string()])
        .set_star(true)
        .with_url("https://tauri.app".to_string())
    }

    #[test]
    fn inserts_item() {
        let mut conn = create_test_db();

        let tx = conn.transaction().unwrap();
        let item = sample_item();

        upsert_item(&tx, &item).unwrap();

        tx.commit().unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
            .unwrap();

        assert_eq!(count, 1);
    }

    #[test]
    fn inserts_metadata() {
        let mut conn = create_test_db();

        let tx = conn.transaction().unwrap();
        let item = sample_item();

        upsert_item(&tx, &item).unwrap();

        tx.commit().unwrap();

        let star: i64 = conn
            .query_row(
                "SELECT star FROM item_metadata WHERE item_id = 'item-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(star, 1);
    }

    #[test]
    fn inserts_hidden_metadata() {
        let mut conn = create_test_db();

        let tx = conn.transaction().unwrap();
        let item = sample_item().set_hidden(true);

        upsert_item(&tx, &item).unwrap();

        tx.commit().unwrap();

        let hidden: i64 = conn
            .query_row(
                "SELECT hidden FROM item_metadata WHERE item_id = 'item-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(hidden, 1);
    }

    #[test]
    fn inserts_tags() {
        let mut conn = create_test_db();

        let tx = conn.transaction().unwrap();
        let item = sample_item();

        upsert_item(&tx, &item).unwrap();

        tx.commit().unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM item_tags WHERE item_id = 'item-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(count, 2);
    }

    #[test]
    fn inserts_aliases() {
        let mut conn = create_test_db();

        let tx = conn.transaction().unwrap();
        let item = sample_item();

        upsert_item(&tx, &item).unwrap();

        tx.commit().unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM item_aliases WHERE item_id = 'item-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(count, 2);
    }

    #[test]
    fn replaces_existing_item() {
        let mut conn = create_test_db();

        {
            let tx = conn.transaction().unwrap();
            upsert_item(&tx, &sample_item()).unwrap();
            tx.commit().unwrap();
        }

        {
            let tx = conn.transaction().unwrap();

            let updated = IndexItem::new(
                "item-1",
                "Updated Title",
                Utc::now(),
                Preview::Markdown {
                    content: "updated".to_string(),
                },
            );

            upsert_item(&tx, &updated).unwrap();

            tx.commit().unwrap();
        }

        let title: String = conn
            .query_row("SELECT title FROM items WHERE id = 'item-1'", [], |row| {
                row.get(0)
            })
            .unwrap();

        assert_eq!(title, "Updated Title");
    }

    #[test]
    fn serializes_markdown_preview() {
        let mut conn = create_test_db();

        let tx = conn.transaction().unwrap();
        let item = sample_item();

        upsert_item(&tx, &item).unwrap();

        tx.commit().unwrap();

        let preview_type: String = conn
            .query_row("SELECT preview_type FROM items", [], |row| row.get(0))
            .unwrap();

        assert_eq!(preview_type, "markdown");
    }

    #[test]
    fn serializes_external_preview() {
        let mut conn = create_test_db();

        let tx = conn.transaction().unwrap();

        let item = IndexItem::new(
            "external-1",
            "External",
            Utc::now(),
            Preview::External {
                url: "https://example.com".to_string(),
            },
        );

        upsert_item(&tx, &item).unwrap();

        tx.commit().unwrap();

        let preview_type: String = conn
            .query_row("SELECT preview_type FROM items", [], |row| row.get(0))
            .unwrap();

        assert_eq!(preview_type, "external");
    }

    #[test]
    fn deletes_item() {
        let mut conn = create_test_db();

        {
            let tx = conn.transaction().unwrap();
            upsert_item(&tx, &sample_item()).unwrap();
            tx.commit().unwrap();
        }

        {
            let tx = conn.transaction().unwrap();
            delete_item(&tx, "item-1").unwrap();
            tx.commit().unwrap();
        }

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
            .unwrap();

        assert_eq!(count, 0);
    }

    #[test]
    fn stores_normalized_boost() {
        let mut conn = create_test_db();

        let tx = conn.transaction().unwrap();

        let mut item = sample_item();
        item.metadata.boost = 999.0;

        upsert_item(&tx, &item).unwrap();

        tx.commit().unwrap();

        let boost: f32 = conn
            .query_row(
                "SELECT boost FROM item_metadata WHERE item_id = 'item-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(boost, 10.0);
    }

    #[test]
    fn returns_app_stats() {
        let mut conn = create_test_db();

        {
            let tx = conn.transaction().unwrap();

            let markdown = sample_item();

            let raw = IndexItem::new(
                "raw-1",
                "Raw File",
                Utc::now(),
                Preview::Raw {
                    content: "hello raw".to_string(),
                },
            );

            let external = IndexItem::new(
                "external-1",
                "External",
                Utc::now(),
                Preview::External {
                    url: "https://example.com".to_string(),
                },
            )
            .with_url("https://example.com".to_string());

            let command = IndexItem::new(
                "command-1",
                "Command",
                Utc::now(),
                Preview::Markdown {
                    content: "run command".to_string(),
                },
            )
            .with_command("code".to_string())
            .with_default_action(Some(DefaultAction::Command));

            upsert_item(&tx, &markdown).unwrap();
            upsert_item(&tx, &raw).unwrap();
            upsert_item(&tx, &external).unwrap();
            upsert_item(&tx, &command).unwrap();

            tx.commit().unwrap();
        }

        let stats = get_app_stats(&conn).unwrap();

        assert_eq!(stats.total_items, 4);
        assert_eq!(stats.markdown_items, 2);
        assert_eq!(stats.raw_items, 1);
        assert_eq!(stats.external_items, 1);
        assert_eq!(stats.command_items, 1);
        assert_eq!(stats.external_open_items, 2);
        assert_eq!(stats.star_items, 1);
        assert_eq!(stats.tagged_items, 1);
        assert_eq!(stats.alias_items, 1);
    }

    #[test]
    fn returns_tag_cloud_for_visible_items() {
        let mut conn = create_test_db();

        {
            let tx = conn.transaction().unwrap();

            upsert_item(&tx, &sample_item()).unwrap();

            let hidden = IndexItem::new(
                "hidden-1",
                "Hidden",
                Utc::now(),
                Preview::Markdown {
                    content: "hidden".to_string(),
                },
            )
            .with_tags(vec!["rust".to_string(), "private".to_string()])
            .set_hidden(true);

            upsert_item(&tx, &hidden).unwrap();

            let sqlite = IndexItem::new(
                "sqlite-1",
                "SQLite",
                Utc::now(),
                Preview::Markdown {
                    content: "sqlite".to_string(),
                },
            )
            .with_tags(vec!["sqlite".to_string(), "rust".to_string()]);

            upsert_item(&tx, &sqlite).unwrap();

            tx.commit().unwrap();
        }

        let tags = get_tag_cloud(&conn).unwrap();

        assert_eq!(tags[0].tag, "rust");
        assert_eq!(tags[0].count, 2);
        assert_eq!(tags[1].tag, "sqlite");
        assert_eq!(tags[1].count, 1);
        assert_eq!(tags[2].tag, "tauri");
        assert_eq!(tags[2].count, 1);
        assert!(!tags.iter().any(|entry| entry.tag == "private"));
    }

    #[test]
    fn returns_source_paths() {
        let mut conn = create_test_db();

        let tx = conn.transaction().unwrap();

        let item = sample_item().with_source_path("C:/tmp/rust.md".to_string());

        upsert_item(&tx, &item).unwrap();

        tx.commit().unwrap();

        let paths = list_source_paths(&conn).unwrap();

        assert_eq!(paths, vec!["C:/tmp/rust.md".to_string()]);
    }

    #[test]
    fn ignores_empty_source_paths() {
        let mut conn = create_test_db();

        let tx = conn.transaction().unwrap();

        upsert_item(&tx, &sample_item()).unwrap();

        tx.commit().unwrap();

        let paths = list_source_paths(&conn).unwrap();

        assert!(paths.is_empty());
    }

    #[test]
    fn deletes_items_by_source_id() {
        let mut conn = create_test_db();

        {
            let tx = conn.transaction().unwrap();

            let markdown = IndexItem::new(
                "docs/readme.md",
                "Readme",
                Utc::now(),
                Preview::Markdown {
                    content: "markdown".to_string(),
                },
            );

            let json_0 = IndexItem::new(
                "docs/links.json::0",
                "Rust",
                Utc::now(),
                Preview::Markdown {
                    content: "rust".to_string(),
                },
            );

            let json_1 = IndexItem::new(
                "docs/links.json::1",
                "Tauri",
                Utc::now(),
                Preview::Markdown {
                    content: "tauri".to_string(),
                },
            );

            upsert_item(&tx, &markdown).unwrap();
            upsert_item(&tx, &json_0).unwrap();
            upsert_item(&tx, &json_1).unwrap();

            tx.commit().unwrap();
        }

        {
            let tx = conn.transaction().unwrap();

            delete_items_by_source_id(&tx, "docs/links.json").unwrap();

            tx.commit().unwrap();
        }

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
            .unwrap();

        // markdown だけ残る
        assert_eq!(count, 1);

        let id: String = conn
            .query_row("SELECT id FROM items", [], |row| row.get(0))
            .unwrap();

        assert_eq!(id, "docs/readme.md");
    }
}
