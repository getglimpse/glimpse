//! SQLite FTS5 repository functions.
//!
//! Generic item persistence lives in `store::item_repository`. This module is
//! intentionally limited to synchronizing the SQLite FTS5 `search_index` table
//! for the legacy SQLite search backend.

use crate::models::{IndexItem, Preview};
use crate::search::sqlite::sql;
use crate::search::SearchError;
use crate::store::item_repository;
use rusqlite::{params, Transaction};

pub use item_repository::{
    get_app_stats, get_item_summary, get_preview, get_tag_cloud, list_item_ids_by_source_id,
    list_item_ids_by_source_path, list_source_paths, replace_source_items, replace_sources,
    unchanged_source_item_count, upsert_source_fingerprint,
};

/// Persists an item and synchronizes the SQLite FTS5 search index.
pub fn upsert_item(tx: &Transaction, item: &IndexItem) -> Result<(), SearchError> {
    item_repository::upsert_item(tx, item)?;
    upsert_search_index(tx, item)?;

    Ok(())
}

/// Deletes an item and its SQLite FTS5 search index row.
pub fn delete_item(tx: &Transaction, id: &str) -> Result<(), SearchError> {
    tx.execute(sql::DELETE_SEARCH_INDEX, params![id])
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    item_repository::delete_item(tx, id)
}

/// Deletes all items from the same source and their SQLite FTS5 rows.
pub fn delete_items_by_source_id(tx: &Transaction, source_id: &str) -> Result<(), SearchError> {
    let pattern = format!("{}::%", source_id);

    tx.execute(
        sql::DELETE_SEARCH_INDEX_BY_SOURCE_ID,
        params![source_id, pattern],
    )
    .map_err(|e| SearchError::DbError(e.to_string()))?;

    item_repository::delete_items_by_source_id(tx, source_id)
}

/// Deletes all items with a source path and their SQLite FTS5 rows.
pub fn delete_items_by_source_path(tx: &Transaction, source_path: &str) -> Result<(), SearchError> {
    tx.execute(
        sql::DELETE_SEARCH_INDEX_BY_SOURCE_PATH,
        params![source_path],
    )
    .map_err(|e| SearchError::DbError(e.to_string()))?;

    item_repository::delete_items_by_source_path(tx, source_path)
}

fn upsert_search_index(tx: &Transaction, item: &IndexItem) -> Result<(), SearchError> {
    let content_for_search = match &item.preview {
        Preview::Markdown { content } => content.clone(),
        Preview::Raw { content } => content.clone(),
        Preview::External { .. } => String::new(),
        Preview::PluginViewer { .. } => String::new(),
    };

    tx.execute(sql::DELETE_SEARCH_INDEX, params![item.id])
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    tx.execute(
        sql::INSERT_SEARCH_INDEX,
        params![
            item.id,
            item.title,
            item.metadata.tags.join(" "),
            item.metadata.aliases.join(" "),
            content_for_search,
        ],
    )
    .map_err(|e| SearchError::DbError(e.to_string()))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::Utc;

    use crate::models::{IndexItem, Preview};
    use crate::search::SourceFingerprint;
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
        .with_aliases(vec!["rs".to_string(), "rustlang".to_string()])
    }

    #[test]
    fn inserts_search_index() {
        let mut conn = create_test_db();

        let tx = conn.transaction().unwrap();
        upsert_item(&tx, &sample_item()).unwrap();
        tx.commit().unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM search_index", [], |row| row.get(0))
            .unwrap();

        assert_eq!(count, 1);
    }

    #[test]
    fn inserts_aliases_into_search_index() {
        let mut conn = create_test_db();

        let tx = conn.transaction().unwrap();
        upsert_item(&tx, &sample_item()).unwrap();
        tx.commit().unwrap();

        let aliases: String = conn
            .query_row(
                "SELECT aliases FROM search_index WHERE id = 'item-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(aliases, "rs rustlang");
    }

    #[test]
    fn deletes_search_index() {
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
            .query_row("SELECT COUNT(*) FROM search_index", [], |row| row.get(0))
            .unwrap();

        assert_eq!(count, 0);
    }

    #[test]
    fn unchanged_source_item_count_returns_count_for_matching_source() {
        let mut conn = create_test_db();
        let updated_at = Utc::now();
        let source_path = "/workspace/docs/items.gjson";

        {
            let tx = conn.transaction().unwrap();
            upsert_item(
                &tx,
                &IndexItem::new(
                    "work/0/docs/items.gjson::0",
                    "Rust",
                    updated_at,
                    Preview::Markdown {
                        content: "rust".to_string(),
                    },
                )
                .with_source_path(source_path),
            )
            .unwrap();
            upsert_item(
                &tx,
                &IndexItem::new(
                    "work/0/docs/items.gjson::1",
                    "Tauri",
                    updated_at,
                    Preview::Markdown {
                        content: "tauri".to_string(),
                    },
                )
                .with_source_path(source_path),
            )
            .unwrap();
            tx.commit().unwrap();
        }

        let fingerprint =
            SourceFingerprint::new(source_path, "work/0/docs/items.gjson", updated_at, 2048);
        upsert_source_fingerprint(&conn, &fingerprint, 2).unwrap();

        let count = unchanged_source_item_count(&conn, &fingerprint).unwrap();

        assert_eq!(count, Some(2));
    }

    #[test]
    fn unchanged_source_item_count_rejects_source_id_mismatch() {
        let mut conn = create_test_db();
        let updated_at = Utc::now();
        let source_path = "/workspace/docs/note.md";

        {
            let tx = conn.transaction().unwrap();
            upsert_item(
                &tx,
                &IndexItem::new(
                    "old/0/docs/note.md",
                    "Rust",
                    updated_at,
                    Preview::Markdown {
                        content: "rust".to_string(),
                    },
                )
                .with_source_path(source_path),
            )
            .unwrap();
            tx.commit().unwrap();
        }

        let stored_fingerprint =
            SourceFingerprint::new(source_path, "old/0/docs/note.md", updated_at, 128);
        upsert_source_fingerprint(&conn, &stored_fingerprint, 1).unwrap();

        let requested_fingerprint =
            SourceFingerprint::new(source_path, "new/0/docs/note.md", updated_at, 128);
        let count = unchanged_source_item_count(&conn, &requested_fingerprint).unwrap();

        assert_eq!(count, None);
    }

    #[test]
    fn unchanged_source_item_count_rejects_size_mismatch() {
        let mut conn = create_test_db();
        let updated_at = Utc::now();
        let source_path = "/workspace/docs/note.md";

        {
            let tx = conn.transaction().unwrap();
            upsert_item(
                &tx,
                &IndexItem::new(
                    "work/0/docs/note.md",
                    "Rust",
                    updated_at,
                    Preview::Markdown {
                        content: "rust".to_string(),
                    },
                )
                .with_source_path(source_path),
            )
            .unwrap();
            tx.commit().unwrap();
        }

        let stored_fingerprint =
            SourceFingerprint::new(source_path, "work/0/docs/note.md", updated_at, 128);
        upsert_source_fingerprint(&conn, &stored_fingerprint, 1).unwrap();

        let requested_fingerprint =
            SourceFingerprint::new(source_path, "work/0/docs/note.md", updated_at, 256);
        let count = unchanged_source_item_count(&conn, &requested_fingerprint).unwrap();

        assert_eq!(count, None);
    }

    #[test]
    fn unchanged_source_item_count_rejects_item_count_mismatch() {
        let mut conn = create_test_db();
        let updated_at = Utc::now();
        let source_path = "/workspace/docs/items.gjson";

        {
            let tx = conn.transaction().unwrap();
            upsert_item(
                &tx,
                &IndexItem::new(
                    "work/0/docs/items.gjson::0",
                    "Rust",
                    updated_at,
                    Preview::Markdown {
                        content: "rust".to_string(),
                    },
                )
                .with_source_path(source_path),
            )
            .unwrap();
            upsert_item(
                &tx,
                &IndexItem::new(
                    "work/0/docs/items.gjson::1",
                    "Tauri",
                    updated_at,
                    Preview::Markdown {
                        content: "tauri".to_string(),
                    },
                )
                .with_source_path(source_path),
            )
            .unwrap();
            tx.commit().unwrap();
        }

        let fingerprint =
            SourceFingerprint::new(source_path, "work/0/docs/items.gjson", updated_at, 2048);
        upsert_source_fingerprint(&conn, &fingerprint, 1).unwrap();

        let count = unchanged_source_item_count(&conn, &fingerprint).unwrap();

        assert_eq!(count, None);
    }

    #[test]
    fn delete_by_source_path_removes_source_fingerprint() {
        let mut conn = create_test_db();
        let updated_at = Utc::now();
        let source_path = "/workspace/docs/note.md";

        {
            let tx = conn.transaction().unwrap();
            upsert_item(
                &tx,
                &IndexItem::new(
                    "work/0/docs/note.md",
                    "Rust",
                    updated_at,
                    Preview::Markdown {
                        content: "rust".to_string(),
                    },
                )
                .with_source_path(source_path),
            )
            .unwrap();
            tx.commit().unwrap();
        }

        let fingerprint =
            SourceFingerprint::new(source_path, "work/0/docs/note.md", updated_at, 128);
        upsert_source_fingerprint(&conn, &fingerprint, 1).unwrap();

        {
            let tx = conn.transaction().unwrap();
            delete_items_by_source_path(&tx, source_path).unwrap();
            tx.commit().unwrap();
        }

        let count = unchanged_source_item_count(&conn, &fingerprint).unwrap();

        assert_eq!(count, None);
    }

    #[test]
    fn list_source_paths_includes_empty_source_fingerprints() {
        let conn = create_test_db();
        let updated_at = Utc::now();
        let source_path = "/workspace/docs/empty.gjson";
        let fingerprint =
            SourceFingerprint::new(source_path, "work/0/docs/empty.gjson", updated_at, 2);
        upsert_source_fingerprint(&conn, &fingerprint, 0).unwrap();

        let paths = list_source_paths(&conn).unwrap();

        assert_eq!(paths, vec![source_path.to_string()]);
    }
}
