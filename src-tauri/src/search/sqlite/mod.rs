//! SQLite FTS5 search engine implementation.
//!
//! This module provides Glimpse's default search backend.
//!
//! Architecture:
//!
//! ```text
//! SearchRequest
//!      ↓
//! query.rs
//!      ↓
//! SQLite FTS5 MATCH
//!      ↓
//! sql.rs
//!      ↓
//! mapper.rs
//!      ↓
//! SearchResult
//! ```
//!
//! Related modules:
//!
//! - `query` → user query → FTS5 MATCH syntax
//! - `sql` → raw SQL definitions
//! - `mapper` → SQLite row → Rust models
//! - `repository` → insert/update/delete operations
//! - `fuzzy` → fallback fuzzy search
//!
//! Features:
//!
//! - SQLite FTS5 full-text search
//! - Prefix matching
//! - Tag search (`#tag`)
//! - BM25 ranking
//! - Starred item boosting
//! - Metadata persistence
//! - Fuzzy fallback search
//!
//! The engine is optimized for:
//!
//! - local-first usage
//! - realtime indexing
//! - low memory usage
//! - offline search

pub mod fuzzy;
pub mod mapper;
pub mod query;
pub mod repository;
pub mod sql;

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use rusqlite::{Connection, ToSql};
use tracing::{debug, error};

use crate::models::{IndexItem, Preview};
use crate::search::query::StructuredQuery;
use crate::search::{
    SearchEngine, SearchError, SearchRequest, SearchResult, SourceFingerprint, SourceReplacement,
};
use crate::store::item_repository;

use fuzzy::fuzzy_filter_results;
use mapper::map_search_result;
use query::render_match_query;
use repository::{
    delete_item, delete_items_by_source_id, delete_items_by_source_path, list_source_paths,
    replace_source_items, replace_sources as replace_sqlite_sources, unchanged_source_item_count,
    upsert_item, upsert_source_fingerprint,
};

/// SQLite FTS5-based search engine.
///
/// `SqliteEngine` is the default search backend used by Glimpse.
///
/// Responsibilities:
///
/// - Execute full-text searches.
/// - Persist indexed items through the shared item store.
/// - Maintain the FTS5 search index.
/// - Provide fuzzy search fallback.
///
/// Search ranking is primarily based on:
///
/// 1. starred state
/// 2. BM25 score
/// 3. update timestamp
///
/// The engine stores a shared SQLite connection wrapped in
/// `Arc<Mutex<_>>` because it is accessed by:
///
/// - IPC commands
/// - indexing runtime
/// - filesystem watcher
/// - cleanup routines
pub struct SqliteEngine {
    db: Arc<Mutex<Connection>>,
}

impl SqliteEngine {
    /// Creates a new SQLite search engine.
    ///
    /// The database schema must already be initialized
    /// before constructing this engine.
    pub fn new(connection: Arc<Mutex<Connection>>) -> Self {
        Self { db: connection }
    }

    pub async fn get_preview(&self, id: &str) -> Result<Option<Preview>, SearchError> {
        debug!(id = %id, "loading preview");

        let db = self.db.lock().unwrap();

        let preview = repository::get_preview(&db, id)?;

        debug!(
            id = %id,
            found = preview.is_some(),
            "preview loaded"
        );

        Ok(preview)
    }
}

#[async_trait]
impl SearchEngine for SqliteEngine {
    /// Initializes the search engine.
    ///
    /// SQLite schema creation is handled externally during
    /// database initialization, therefore this method is currently
    /// a no-op.
    async fn init(&self) -> Result<(), SearchError> {
        debug!("sqlite search engine init skipped");

        Ok(())
    }

    /// Executes a search request.
    ///
    /// Supported features:
    ///
    /// - prefix search
    /// - tag search (`#rust`)
    /// - BM25 ranking
    /// - starred prioritization
    /// - recent item listing
    /// - fuzzy fallback
    ///
    /// Search flow:
    ///
    /// ```text
    /// SearchRequest
    ///      ↓
    /// StructuredQuery
    ///      ↓
    /// SQLite FTS5 MATCH
    ///      ↓
    /// map_search_result()
    ///      ↓
    /// Vec<SearchResult>
    ///      ↓
    /// fuzzy fallback (optional)
    /// ```
    ///
    /// If FTS returns no results and the query does not contain
    /// tag filters, fuzzy search is attempted automatically.
    async fn search(&self, req: SearchRequest) -> Result<Vec<SearchResult>, SearchError> {
        debug!(
            query = %req.query,
            dictionary_id = ?req.dictionary_id,
            limit = req.limit,
            global = req.global,
            hidden_only = req.hidden_only,
            "sqlite search started"
        );

        let db = self.db.lock().unwrap();

        let structured_query = StructuredQuery::parse(&req.query);
        let match_query = render_match_query(&structured_query);
        let has_tag_filter = structured_query.has_tag_filter();
        let limit_i64 = req.limit as i64;
        let hidden_i64 = if req.hidden_only { 1_i64 } else { 0_i64 };

        debug!(
            query = %req.query,
            match_query = %match_query,
            has_tag_filter,
            limit = req.limit,
            hidden_only = req.hidden_only,
            "sqlite search query built"
        );

        if match_query.is_empty() {
            debug!("using recent-items sqlite query");
            return item_repository::recent_items(&db, req.limit, req.hidden_only);
        }

        debug!("using matched-items sqlite query");

        let mut stmt = db.prepare(sql::SELECT_MATCHED_ITEMS).map_err(|error| {
            error!(
                error = %error,
                "failed to prepare sqlite search statement"
            );

            SearchError::DbError(error.to_string())
        })?;

        let params_vec: Vec<&dyn ToSql> = vec![&match_query, &hidden_i64, &limit_i64];

        let rows = stmt
            .query_map(&*params_vec, map_search_result)
            .map_err(|error| {
                error!(
                    query = %req.query,
                    match_query = %match_query,
                    error = %error,
                    "failed to execute sqlite search query"
                );

                SearchError::DbError(error.to_string())
            })?;

        let mut results = Vec::new();

        for row in rows {
            results.push(row.map_err(|error| {
                error!(
                    query = %req.query,
                    error = %error,
                    "failed to map sqlite search result row"
                );

                SearchError::DbError(error.to_string())
            })?);
        }

        if results.is_empty() && !match_query.is_empty() && !has_tag_filter {
            debug!(
                query = %req.query,
                limit = req.limit,
                "sqlite search returned no results; running fuzzy fallback"
            );

            let fuzzy_results = fuzzy_filter_results(&db, &req.query, req.limit, req.hidden_only)?;

            debug!(
                query = %req.query,
                count = fuzzy_results.len(),
                "fuzzy fallback completed"
            );

            return Ok(fuzzy_results);
        }

        debug!(
            query = %req.query,
            count = results.len(),
            "sqlite search completed"
        );

        Ok(results)
    }

    /// Inserts or updates an indexed item.
    ///
    /// This operation is transactional and updates:
    ///
    /// - items
    /// - item metadata
    /// - tags
    /// - aliases
    /// - FTS5 search index
    async fn upsert(&self, item: IndexItem) -> Result<(), SearchError> {
        debug!(
            id = %item.id,
            title = %item.title,
            "upserting indexed item"
        );

        let mut conn = self.db.lock().unwrap();

        let tx = conn
            .transaction()
            .map_err(|e| SearchError::DbError(e.to_string()))?;

        upsert_item(&tx, &item)?;

        tx.commit().map_err(|error| {
            error!(
                id = %item.id,
                error = %error,
                "failed to commit sqlite upsert transaction"
            );

            SearchError::DbError(error.to_string())
        })?;

        debug!(
            id = %item.id,
            "indexed item upserted"
        );

        Ok(())
    }

    async fn replace_source(
        &self,
        source_id: &str,
        items: Vec<IndexItem>,
        fingerprint: Option<SourceFingerprint>,
    ) -> Result<(), SearchError> {
        debug!(
            source_id = %source_id,
            item_count = items.len(),
            "replacing indexed source"
        );

        let mut conn = self.db.lock().unwrap();

        replace_source_items(&mut conn, source_id, &items, fingerprint.as_ref())?;

        debug!(
            source_id = %source_id,
            item_count = items.len(),
            "indexed source replaced"
        );

        Ok(())
    }

    async fn replace_sources(
        &self,
        replacements: Vec<SourceReplacement>,
    ) -> Result<(), SearchError> {
        if replacements.is_empty() {
            return Ok(());
        }

        debug!(
            source_count = replacements.len(),
            item_count = replacements
                .iter()
                .map(SourceReplacement::item_count)
                .sum::<usize>(),
            "replacing indexed sources"
        );

        let mut conn = self.db.lock().unwrap();

        replace_sqlite_sources(&mut conn, &replacements)?;

        Ok(())
    }

    /// Deletes an indexed item and its associated search data.
    ///
    /// This operation runs inside a SQLite transaction.
    async fn delete(&self, id: &str) -> Result<(), SearchError> {
        debug!(
            id = %id,
            "deleting indexed item"
        );

        let mut conn = self.db.lock().unwrap();

        let tx = conn.transaction().map_err(|error| {
            error!(
                id = %id,
                error = %error,
                "failed to start sqlite delete transaction"
            );

            SearchError::DbError(error.to_string())
        })?;

        delete_item(&tx, id)?;

        tx.commit().map_err(|error| {
            error!(
                id = %id,
                error = %error,
                "failed to commit sqlite delete transaction"
            );

            SearchError::DbError(error.to_string())
        })?;

        debug!(
            id = %id,
            "indexed item deleted"
        );

        Ok(())
    }

    /// Deletes all indexed items originating from the same source.
    ///
    /// This is used by filesystem refresh/delete handling.
    /// Markdown files normally produce one item whose ID equals `source_id`.
    /// JSON index files may produce multiple items using `source_id::index`.
    async fn delete_by_source_id(&self, source_id: &str) -> Result<(), SearchError> {
        debug!(
            source_id = %source_id,
            "deleting indexed items by source id"
        );

        let mut conn = self.db.lock().unwrap();

        let tx = conn.transaction().map_err(|error| {
            error!(
                source_id = %source_id,
                error = %error,
                "failed to start sqlite delete-by-source transaction"
            );

            SearchError::DbError(error.to_string())
        })?;

        delete_items_by_source_id(&tx, source_id)?;

        tx.commit().map_err(|error| {
            error!(
                source_id = %source_id,
                error = %error,
                "failed to commit sqlite delete-by-source transaction"
            );

            SearchError::DbError(error.to_string())
        })?;

        debug!(
            source_id = %source_id,
            "indexed items deleted by source id"
        );

        Ok(())
    }

    async fn delete_by_source_path(&self, source_path: &str) -> Result<(), SearchError> {
        debug!(
            source_path = %source_path,
            "deleting indexed items by source path"
        );

        let mut conn = self.db.lock().unwrap();

        let tx = conn.transaction().map_err(|error| {
            error!(
                source_path = %source_path,
                error = %error,
                "failed to start sqlite delete-by-source-path transaction"
            );

            SearchError::DbError(error.to_string())
        })?;

        delete_items_by_source_path(&tx, source_path)?;

        tx.commit().map_err(|error| {
            error!(
                source_path = %source_path,
                error = %error,
                "failed to commit sqlite delete-by-source-path transaction"
            );

            SearchError::DbError(error.to_string())
        })?;

        debug!(
            source_path = %source_path,
            "indexed items deleted by source path"
        );

        Ok(())
    }

    /// Returns all indexed source paths.
    ///
    /// Used primarily by cleanup routines to remove stale database entries
    /// whose original files no longer exist.
    async fn list_source_paths(&self) -> Result<Vec<String>, SearchError> {
        debug!("listing indexed source paths");

        let db = self.db.lock().unwrap();

        let paths = list_source_paths(&db)?;

        debug!(count = paths.len(), "indexed source paths listed");

        Ok(paths)
    }

    async fn unchanged_source_item_count(
        &self,
        fingerprint: SourceFingerprint,
    ) -> Result<Option<usize>, SearchError> {
        let db = self.db.lock().unwrap();

        unchanged_source_item_count(&db, &fingerprint)
    }

    async fn upsert_source_fingerprint(
        &self,
        fingerprint: SourceFingerprint,
        item_count: usize,
    ) -> Result<(), SearchError> {
        let db = self.db.lock().unwrap();

        upsert_source_fingerprint(&db, &fingerprint, item_count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::Utc;

    use crate::models::{IndexItem, Preview};
    use crate::test_utils::fixtures::create_test_db;

    #[tokio::test]
    async fn searches_aliases() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let item = IndexItem::new(
            "item-1",
            "Rust",
            Utc::now(),
            Preview::Markdown {
                content: "hello".to_string(),
            },
        )
        .with_aliases(vec!["rs".to_string()]);

        engine.upsert(item).await.unwrap();

        {
            let db = engine.db.lock().unwrap();

            let row = db
                .query_row(
                    "
                    SELECT id, title, tags, aliases, preview_content
                    FROM search_index
                    ",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                        ))
                    },
                )
                .unwrap();

            dbg!(row);

            let match_count: i64 = db
                .query_row(
                    "
                    SELECT COUNT(*)
                    FROM search_index
                    WHERE search_index MATCH ?
                    ",
                    ["rs*"],
                    |row| row.get(0),
                )
                .unwrap();

            dbg!(match_count);
        }

        let results = engine.search(SearchRequest::new("rs", 10)).await.unwrap();

        assert_eq!(results.len(), 1);

        assert_eq!(results[0].item.title, "Rust");
    }

    #[tokio::test]
    async fn higher_boost_ranks_higher() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let low_boost = IndexItem::new(
            "low",
            "Low Boost",
            Utc::now(),
            Preview::Markdown {
                content: "same keyword".to_string(),
            },
        )
        .set_boost(0.5);

        let high_boost = IndexItem::new(
            "high",
            "High Boost",
            Utc::now(),
            Preview::Markdown {
                content: "same keyword".to_string(),
            },
        )
        .set_boost(5.0);

        engine.upsert(low_boost).await.unwrap();
        engine.upsert(high_boost).await.unwrap();

        let results = engine
            .search(SearchRequest::new("keyword", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].item.id, "high");
    }

    #[tokio::test]
    async fn fuzzy_search_falls_back_when_fts_has_no_matches() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let item = IndexItem::new(
            "item-1",
            "Rust Book",
            Utc::now(),
            Preview::Markdown {
                content: "official language guide".to_string(),
            },
        );

        engine.upsert(item).await.unwrap();

        // `bok` は `book` の typo。
        // FTS5 prefix search では通常ヒットしないが、
        // fuzzy fallback では `Rust Book` に近いためヒットする。
        let results = engine
            .search(SearchRequest::new("rust bok", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "item-1");
        assert_eq!(results[0].item.title, "Rust Book");

        // fuzzy score が入っていることも確認する。
        assert!(results[0].score > 0.0);
    }

    #[tokio::test]
    async fn fuzzy_search_matches_alias_typo() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let item = IndexItem::new(
            "item-1",
            "Rust",
            Utc::now(),
            Preview::Markdown {
                content: "hello".to_string(),
            },
        )
        .with_aliases(vec!["rustlang".to_string()]);

        engine.upsert(item).await.unwrap();

        let results = engine
            .search(SearchRequest::new("rustlng", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "item-1");
    }

    #[tokio::test]
    async fn fuzzy_search_does_not_override_fts_results() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let item = IndexItem::new(
            "item-1",
            "Rust Book",
            Utc::now(),
            Preview::Markdown {
                content: "official language guide".to_string(),
            },
        );

        engine.upsert(item).await.unwrap();

        let results = engine.search(SearchRequest::new("rust", 10)).await.unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "item-1");

        // FTS result の score は bm25由来なので、
        // fuzzy fallback の 0.75〜1.0 付近とは違う可能性が高い。
        // ここでは「0件 fallback ではなく通常検索で返る」ことだけ見る。
    }

    #[tokio::test]
    async fn tag_filter_does_not_fallback_to_fuzzy_when_tag_does_not_match() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let item = IndexItem::new(
            "item-1",
            "Rust Book",
            Utc::now(),
            Preview::Markdown {
                content: "official language guide".to_string(),
            },
        )
        .with_tags(vec!["rust".to_string()]);

        engine.upsert(item).await.unwrap();

        // `bok` は `book` の typo。
        // 通常なら fuzzy fallback で `Rust Book` にヒットする可能性がある。
        // しかし `#sqlite` が含まれているため、タグフィルタ扱いになり、
        // fuzzy fallback してはいけない。
        let results = engine
            .search(SearchRequest::new("bok #sqlite", 10))
            .await
            .unwrap();

        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn tag_filter_matches_items_with_target_tag() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let rust_item = IndexItem::new(
            "rust-item",
            "Rust Book",
            Utc::now(),
            Preview::Markdown {
                content: "official language guide".to_string(),
            },
        )
        .with_tags(vec!["rust".to_string()]);

        let sqlite_item = IndexItem::new(
            "sqlite-item",
            "SQLite Notes",
            Utc::now(),
            Preview::Markdown {
                content: "database memo".to_string(),
            },
        )
        .with_tags(vec!["sqlite".to_string()]);

        engine.upsert(rust_item).await.unwrap();
        engine.upsert(sqlite_item).await.unwrap();

        let results = engine
            .search(SearchRequest::new("#sqlite", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "sqlite-item");
    }

    #[tokio::test]
    async fn normal_search_excludes_hidden_items() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let visible = IndexItem::new(
            "visible",
            "Visible Rust",
            Utc::now(),
            Preview::Markdown {
                content: "shared_hidden_keyword".to_string(),
            },
        );

        let hidden = IndexItem::new(
            "hidden",
            "Hidden Rust",
            Utc::now(),
            Preview::Markdown {
                content: "shared_hidden_keyword".to_string(),
            },
        )
        .set_hidden(true);

        engine.upsert(visible).await.unwrap();
        engine.upsert(hidden).await.unwrap();

        let results = engine
            .search(SearchRequest::new("shared_hidden_keyword", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "visible");
    }

    #[tokio::test]
    async fn hidden_search_returns_hidden_items_only() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let visible = IndexItem::new(
            "visible",
            "Visible Rust",
            Utc::now(),
            Preview::Markdown {
                content: "shared_hidden_keyword".to_string(),
            },
        );

        let hidden = IndexItem::new(
            "hidden",
            "Hidden Rust",
            Utc::now(),
            Preview::Markdown {
                content: "shared_hidden_keyword".to_string(),
            },
        )
        .set_hidden(true);

        engine.upsert(visible).await.unwrap();
        engine.upsert(hidden).await.unwrap();

        let results = engine
            .search(SearchRequest::new("shared_hidden_keyword", 10).hidden_only(true))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "hidden");
        assert!(results[0].item.metadata.hidden);
    }

    #[tokio::test]
    async fn hidden_recent_search_returns_hidden_items_only() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        engine
            .upsert(IndexItem::new(
                "visible",
                "Visible",
                Utc::now(),
                Preview::Markdown {
                    content: String::new(),
                },
            ))
            .await
            .unwrap();

        engine
            .upsert(
                IndexItem::new(
                    "hidden",
                    "Hidden",
                    Utc::now(),
                    Preview::Markdown {
                        content: String::new(),
                    },
                )
                .set_hidden(true),
            )
            .await
            .unwrap();

        let results = engine
            .search(SearchRequest::new("", 10).hidden_only(true))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "hidden");
    }

    #[tokio::test]
    async fn updating_item_removes_old_search_terms() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let old = IndexItem::new(
            "item-1",
            "Old Title",
            Utc::now(),
            Preview::Markdown {
                content: "oldkeyword".to_string(),
            },
        );

        engine.upsert(old).await.unwrap();

        let updated = IndexItem::new(
            "item-1",
            "New Title",
            Utc::now(),
            Preview::Markdown {
                content: "newkeyword".to_string(),
            },
        );

        engine.upsert(updated).await.unwrap();

        let old_results = engine
            .search(SearchRequest::new("oldkeyword", 10))
            .await
            .unwrap();

        let new_results = engine
            .search(SearchRequest::new("newkeyword", 10))
            .await
            .unwrap();

        assert!(
            old_results.is_empty(),
            "old search term should not remain after upsert"
        );

        assert_eq!(new_results.len(), 1);
        assert_eq!(new_results[0].item.id, "item-1");
        assert_eq!(new_results[0].item.title, "New Title");
    }

    #[tokio::test]
    async fn deleting_item_removes_it_from_search_results() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let item = IndexItem::new(
            "item-1",
            "Delete Me",
            Utc::now(),
            Preview::Markdown {
                content: "deletekeyword".to_string(),
            },
        );

        engine.upsert(item).await.unwrap();

        engine.delete("item-1").await.unwrap();

        let results = engine
            .search(SearchRequest::new("deletekeyword", 10))
            .await
            .unwrap();

        assert!(
            results.is_empty(),
            "deleted item should not remain in search results"
        );
    }

    #[tokio::test]
    async fn delete_by_source_id_removes_items_from_search_results() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let item_1 = IndexItem::new(
            "docs/tools.gjson::0",
            "Rust",
            Utc::now(),
            Preview::Markdown {
                content: "source_delete_keyword rust".to_string(),
            },
        );

        let item_2 = IndexItem::new(
            "docs/tools.gjson::1",
            "Tauri",
            Utc::now(),
            Preview::Markdown {
                content: "source_delete_keyword tauri".to_string(),
            },
        );

        engine.upsert(item_1).await.unwrap();
        engine.upsert(item_2).await.unwrap();

        engine
            .delete_by_source_id("docs/tools.gjson")
            .await
            .unwrap();

        let results = engine
            .search(SearchRequest::new("source_delete_keyword", 10))
            .await
            .unwrap();

        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn reindexing_same_source_id_does_not_duplicate_results() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let old = IndexItem::new(
            "docs/readme.md",
            "Old",
            Utc::now(),
            Preview::Markdown {
                content: "old_reindex_keyword".to_string(),
            },
        );

        engine.upsert(old).await.unwrap();

        engine.delete_by_source_id("docs/readme.md").await.unwrap();

        let updated = IndexItem::new(
            "docs/readme.md",
            "Updated",
            Utc::now(),
            Preview::Markdown {
                content: "new_reindex_keyword".to_string(),
            },
        );

        engine.upsert(updated).await.unwrap();

        let old_results = engine
            .search(SearchRequest::new("old_reindex_keyword", 10))
            .await
            .unwrap();

        let new_results = engine
            .search(SearchRequest::new("new_reindex_keyword", 10))
            .await
            .unwrap();

        assert!(old_results.is_empty());
        assert_eq!(new_results.len(), 1);
        assert_eq!(new_results[0].item.title, "Updated");
    }

    #[tokio::test]
    async fn reindexing_json_source_removes_items_that_no_longer_exist() {
        let conn = create_test_db();

        let engine = SqliteEngine::new(Arc::new(Mutex::new(conn)));

        let item_0 = IndexItem::new(
            "docs/tools.gjson::0",
            "Rust",
            Utc::now(),
            Preview::Markdown {
                content: "json_keep_keyword".to_string(),
            },
        );

        let item_1 = IndexItem::new(
            "docs/tools.gjson::1",
            "Removed",
            Utc::now(),
            Preview::Markdown {
                content: "json_removed_keyword".to_string(),
            },
        );

        engine.upsert(item_0).await.unwrap();
        engine.upsert(item_1).await.unwrap();

        engine
            .delete_by_source_id("docs/tools.gjson")
            .await
            .unwrap();

        let replacement = IndexItem::new(
            "docs/tools.gjson::0",
            "Rust Updated",
            Utc::now(),
            Preview::Markdown {
                content: "json_keep_keyword updated".to_string(),
            },
        );

        engine.upsert(replacement).await.unwrap();

        let removed_results = engine
            .search(SearchRequest::new("json_removed_keyword", 10))
            .await
            .unwrap();

        let kept_results = engine
            .search(SearchRequest::new("json_keep_keyword", 10))
            .await
            .unwrap();

        assert!(removed_results.is_empty());
        assert_eq!(kept_results.len(), 1);
        assert_eq!(kept_results[0].item.title, "Rust Updated");
    }
}
