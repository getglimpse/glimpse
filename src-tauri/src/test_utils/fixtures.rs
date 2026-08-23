//! Test fixtures for backend database and search mapping tests.
//!
//! This module provides shared helpers for tests that need:
//!
//! - a fresh in-memory SQLite database
//! - production-compatible schema initialization
//! - insertion of [`IndexItem`] values
//! - mapping raw SQLite rows into [`SearchResult`]
//!
//! The goal is to keep test setup close to production behavior.
//! Schema creation is delegated to `store::schema`, so tests do not maintain
//! a separate copy of the database schema.
//!
//! If the production schema changes, update `store::schema.rs` first.
//! Test fixtures should reuse that schema instead of redefining it.

use crate::models::{IndexItem, OpenAction, Preview};
use crate::search::sqlite::sql as sqlite_sql;
use crate::search::SearchResult;
use crate::store::item_mapper::map_search_result;
use crate::store::item_sql;
use crate::store::schema::{apply_pragmas, recreate_schema};

use chrono::Utc;
use rusqlite::{params, Connection};

/// Creates a fresh in-memory SQLite database using the current production schema.
///
/// This is the single source of truth for test database initialization.
///
/// Initialization steps:
///
/// - Open an in-memory SQLite connection.
/// - Apply production SQLite pragmas.
/// - Recreate the production schema.
///
/// Any schema changes should happen only in:
///
/// - `store/schema.rs`
pub fn create_test_db() -> Connection {
    let mut conn = Connection::open_in_memory().expect("failed to open in-memory database");

    apply_pragmas(&conn).expect("failed to apply SQLite pragmas");
    recreate_schema(&mut conn).expect("failed to recreate schema");

    conn
}

/// Inserts a full [`IndexItem`] into the test database.
///
/// This helper writes all tables required for search-related tests:
///
/// - `items`
/// - `item_metadata`
/// - `item_tags`
/// - `item_aliases`
/// - `search_index`
///
/// The inserted shape matches the production schema and SQL statements.
///
/// This helper is useful for integration-style tests that need realistic
/// search behavior without running the full indexer.
pub fn insert_test_item(conn: &Connection, item: &IndexItem) {
    let (preview_type, preview_content, preview_url) = match &item.preview {
        Preview::Markdown { content } => ("local", Some(content.as_str()), None),
        Preview::Raw { content } => ("raw", Some(content.as_str()), None),
        Preview::External { url } => ("external", None, Some(url.as_str())),
        Preview::PluginViewer {
            plugin_id,
            viewer_id,
        } => (
            "pluginViewer",
            Some(plugin_id.as_str()),
            Some(viewer_id.as_str()),
        ),
    };

    let (open_type, open_url, open_command_path) = match &item.open {
        Some(OpenAction::External { url }) => (Some("external"), Some(url.clone()), None),
        Some(OpenAction::Command { path }) => (Some("command"), None, Some(path.clone())),
        None => (None, None, None),
    };

    conn.execute(
        item_sql::UPSERT_ITEM,
        params![
            item.id,
            item.title,
            item.source_path,
            item.updated_at.to_rfc3339(),
            preview_type,
            preview_content,
            preview_url,
            open_type,
            open_url,
            open_command_path,
        ],
    )
    .unwrap();

    conn.execute(
        item_sql::UPSERT_ITEM_METADATA,
        params![
            item.id,
            item.metadata.star,
            item.metadata.hidden,
            item.metadata.normalized_boost(),
            Utc::now().to_rfc3339(),
        ],
    )
    .unwrap();

    conn.execute(item_sql::DELETE_ITEM_TAGS, params![item.id])
        .unwrap();

    for tag in &item.metadata.tags {
        conn.execute(item_sql::INSERT_ITEM_TAG, params![item.id, tag])
            .unwrap();
    }

    conn.execute(item_sql::DELETE_ITEM_ALIASES, params![item.id])
        .unwrap();

    for alias in &item.metadata.aliases {
        conn.execute(item_sql::INSERT_ITEM_ALIAS, params![item.id, alias])
            .unwrap();
    }

    conn.execute(sqlite_sql::DELETE_SEARCH_INDEX, params![item.id])
        .unwrap();

    conn.execute(
        sqlite_sql::INSERT_SEARCH_INDEX,
        params![
            item.id,
            item.title,
            item.metadata.tags.join(" "),
            item.metadata.aliases.join(" "),
            preview_content.unwrap_or_default(),
        ],
    )
    .unwrap();
}

/// Maps a synthetic SQLite row into a [`SearchResult`].
///
/// This helper is used to test `map_search_result` without executing the full
/// search query pipeline.
///
/// It creates a temporary `test_search_results` table whose columns match the
/// shape expected by the mapper, inserts one row, and then maps that row using
/// the production mapper.
///
/// Use [`TestSearchResultRow`] to override only the fields relevant to each test.
pub fn map_test_search_result(conn: &Connection, row: TestSearchResultRow) -> SearchResult {
    conn.execute_batch(
        r#"
        DROP TABLE IF EXISTS test_search_results;

        CREATE TABLE test_search_results (
            id TEXT,
            title TEXT,
            source_path TEXT,
            star INTEGER,
            hidden INTEGER,
            updated_at TEXT,
            preview_type TEXT,
            preview_content TEXT,
            preview_url TEXT,
            open_type TEXT,
            open_url TEXT,
            open_command_path TEXT,
            rank REAL,
            tags_str TEXT,
            aliases_str TEXT
        );
        "#,
    )
    .unwrap();

    conn.execute(
        r#"
        INSERT INTO test_search_results (
            id,
            title,
            source_path,
            star,
            hidden,
            updated_at,
            preview_type,
            preview_content,
            preview_url,
            open_type,
            open_url,
            open_command_path,
            rank,
            tags_str,
            aliases_str
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
        params![
            row.id,
            row.title,
            row.source_path,
            if row.star { 1 } else { 0 },
            if row.hidden { 1 } else { 0 },
            row.updated_at,
            row.preview_type,
            row.preview_content,
            row.preview_url,
            row.open_type,
            row.open_url,
            row.open_command_path,
            row.rank,
            row.tags_str,
            row.aliases_str,
        ],
    )
    .unwrap();

    conn.query_row(
        "SELECT * FROM test_search_results LIMIT 1",
        [],
        map_search_result,
    )
    .unwrap()
}

/// Synthetic search result row used by [`map_test_search_result`].
///
/// Defaults are intentionally valid and minimal so each test can override only
/// the fields it cares about.
pub struct TestSearchResultRow {
    pub id: String,
    pub title: String,
    pub source_path: Option<String>,
    pub star: bool,
    pub hidden: bool,
    pub updated_at: String,
    pub preview_type: String,
    pub preview_content: Option<String>,
    pub preview_url: Option<String>,
    pub open_type: Option<String>,
    pub open_url: Option<String>,
    pub open_command_path: Option<String>,
    pub rank: f64,
    pub tags_str: Option<String>,
    pub aliases_str: Option<String>,
}

impl Default for TestSearchResultRow {
    fn default() -> Self {
        Self {
            id: "item-1".to_string(),
            title: "Rust Notes".to_string(),
            source_path: Some("/tmp/item.md".to_string()),
            star: false,
            hidden: false,
            updated_at: "2025-01-01T00:00:00Z".to_string(),
            preview_type: "local".to_string(),
            preview_content: Some("hello rust".to_string()),
            preview_url: None,
            open_type: None,
            open_url: None,
            open_command_path: None,
            rank: 0.0,
            tags_str: None,
            aliases_str: None,
        }
    }
}
