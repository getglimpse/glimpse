//! SQLite schema definition and version management.
//!
//! This module owns the Glimpse database schema.
//!
//! Responsibilities:
//!
//! - Apply SQLite PRAGMA settings.
//! - Check the current schema version.
//! - Recreate the schema when the version changes.
//! - Define all Glimpse-owned tables and indexes.
//!
//! # Migration strategy
//!
//! Glimpse is currently pre-alpha.
//!
//! During this phase, schema version mismatches are handled destructively:
//!
//! ```text
//! current user_version != DB_VERSION
//!     ↓
//! drop Glimpse tables
//!     ↓
//! recreate current schema
//!     ↓
//! set PRAGMA user_version
//! ```
//!
//! This keeps development simple while the data model is still changing.
//! Stable releases may replace this with incremental migrations.
//!
//! # Schema overview
//!
//! ```text
//! items
//!   ├─ item_metadata
//!   ├─ item_tags
//!   ├─ item_aliases
//!   └─ search_index
//! ```
//!
//! `items` stores the canonical indexed item.
//! Metadata, tags, aliases, and full-text search data are split into
//! separate tables for simpler updates and querying.

use rusqlite::Connection;
use tracing::{debug, info, warn};

/// Current SQLite schema version.
///
/// Increment this value whenever [`CREATE_SCHEMA`] changes.
///
/// Glimpse is still pre-alpha, so schema mismatch intentionally destroys
/// and recreates the whole database instead of running incremental
/// migrations.
pub const DB_VERSION: i32 = 8;

/// Applies SQLite PRAGMA settings used by Glimpse.
///
/// Current settings:
///
/// - `journal_mode = WAL`
///   Enables write-ahead logging for better read/write concurrency.
///
/// - `synchronous = NORMAL`
///   Balances durability and performance for local app data.
///
/// - `foreign_keys = ON`
///   Enables cascading deletes for item-related tables.
///
/// - `temp_store = MEMORY`
///   Keeps temporary tables and indexes in memory where possible.
///
/// - `mmap_size = 3000000000`
///   Allows SQLite to use memory-mapped I/O when supported.
///
/// These settings are applied when the database connection is initialized.
pub fn apply_pragmas(conn: &Connection) -> rusqlite::Result<()> {
    debug!("applying sqlite pragmas");

    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        PRAGMA temp_store = MEMORY;
        PRAGMA mmap_size = 3000000000;
        "#,
    )?;

    debug!("sqlite pragmas applied");

    Ok(())
}

/// Ensures the database schema matches [`DB_VERSION`].
///
/// Current strategy:
///
/// - Same version → do nothing.
/// - Different version → drop and recreate the full schema.
///
/// The current schema version is stored using SQLite's
/// `PRAGMA user_version`.
///
/// # Notes
///
/// This is intentionally destructive during pre-alpha development.
/// Indexed data can be rebuilt from source files by the indexer.
pub fn ensure_schema(conn: &mut Connection) -> rusqlite::Result<()> {
    let current_version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    debug!(
        current_version,
        expected_version = DB_VERSION,
        "checking sqlite schema version"
    );

    if current_version == DB_VERSION {
        if let Err(error) = verify_search_index(conn) {
            warn!(
                error = %error,
                "sqlite search index is not usable; recreating schema"
            );

            recreate_schema(conn)?;

            info!(version = DB_VERSION, "sqlite schema recreated");
        }

        debug!(version = DB_VERSION, "sqlite schema is up to date");

        return Ok(());
    }

    warn!(
        current_version,
        expected_version = DB_VERSION,
        "sqlite schema version mismatch; recreating schema"
    );

    recreate_schema(conn)?;

    info!(version = DB_VERSION, "sqlite schema recreated");

    Ok(())
}

fn verify_search_index(conn: &Connection) -> rusqlite::Result<()> {
    conn.prepare("SELECT rowid FROM search_index LIMIT 0")?;

    Ok(())
}

/// Recreates the full Glimpse schema destructively.
///
/// This function:
///
/// 1. Starts a transaction.
/// 2. Drops all Glimpse-owned tables.
/// 3. Creates the current schema.
/// 4. Updates `PRAGMA user_version`.
/// 5. Commits the transaction.
///
/// If any step fails, the transaction is rolled back.
pub fn recreate_schema(conn: &mut Connection) -> rusqlite::Result<()> {
    debug!("recreating sqlite schema");

    let tx = conn.transaction()?;

    debug!("dropping existing sqlite schema");
    tx.execute_batch(DROP_SCHEMA)?;

    debug!("creating sqlite schema");
    tx.execute_batch(CREATE_SCHEMA)?;

    tx.pragma_update(None, "user_version", DB_VERSION)?;

    tx.commit()?;

    debug!(version = DB_VERSION, "sqlite schema transaction committed");

    Ok(())
}

/// Drops all Glimpse-owned schema objects.
///
/// Order matters because tables reference `items` with foreign keys.
/// Child tables are dropped before the parent table.
///
/// The FTS table is also dropped because it is derived from indexed data
/// and can be rebuilt.
pub const DROP_SCHEMA: &str = r#"
DROP TABLE IF EXISTS item_aliases;
DROP TABLE IF EXISTS item_tags;
DROP TABLE IF EXISTS item_metadata;
DROP TABLE IF EXISTS source_fingerprints;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS search_index;
"#;

/// Creates the current Glimpse database schema.
///
/// # Table mapping
///
/// - `items`
///   Stores stable [`IndexItem`] core fields:
///   title, source path, timestamps, preview data, and open action.
///
/// - `item_metadata`
///   Stores scalar metadata such as starred state and boost.
///
/// - `item_tags`
///   Stores normalized tags.
///
/// - `item_aliases`
///   Stores alternative searchable names.
///
/// - `search_index`
///   Stores denormalized full-text searchable content using SQLite FTS5.
///
/// - `source_fingerprints`
///   Stores source-level filesystem fingerprints used by full scans to skip
///   unchanged source files before parser dispatch.
///
/// # Search design
///
/// `search_index` is intentionally denormalized so search queries can run
/// against title, tags, aliases, and preview content efficiently.
pub const CREATE_SCHEMA: &str = r#"
CREATE TABLE items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_path TEXT,
    updated_at TEXT NOT NULL,

    preview_type TEXT NOT NULL,
    preview_content TEXT,
    preview_url TEXT,

    open_type TEXT,
    open_url TEXT,
    open_command_path TEXT
);

CREATE TABLE item_metadata (
    item_id TEXT PRIMARY KEY,
    star INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    boost REAL NOT NULL DEFAULT 1.0,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (item_id)
        REFERENCES items(id)
        ON DELETE CASCADE
);

CREATE TABLE item_tags (
    item_id TEXT NOT NULL,
    tag TEXT NOT NULL,

    PRIMARY KEY (item_id, tag),

    FOREIGN KEY (item_id)
        REFERENCES items(id)
        ON DELETE CASCADE
);

CREATE TABLE item_aliases (
    item_id TEXT NOT NULL,
    alias TEXT NOT NULL,

    PRIMARY KEY (item_id, alias),

    FOREIGN KEY (item_id)
        REFERENCES items(id)
        ON DELETE CASCADE
);

CREATE TABLE source_fingerprints (
    source_path TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    item_count INTEGER NOT NULL,
    content_hash TEXT,
    updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE search_index
USING fts5(
    id UNINDEXED,
    title,
    tags,
    aliases,
    preview_content,
    tokenize='unicode61'
);

CREATE INDEX idx_items_updated_at
    ON items(updated_at);

CREATE INDEX idx_item_metadata_star
    ON item_metadata(star);

CREATE INDEX idx_item_metadata_hidden
    ON item_metadata(hidden);

CREATE INDEX idx_item_tags_tag
    ON item_tags(tag);

CREATE INDEX idx_item_aliases_alias
    ON item_aliases(alias);

CREATE INDEX idx_source_fingerprints_source_id
    ON source_fingerprints(source_id);
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recreate_schema_creates_current_schema() {
        let mut conn = Connection::open_in_memory().unwrap();

        apply_pragmas(&conn).unwrap();
        ensure_schema(&mut conn).unwrap();

        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();

        assert_eq!(version, DB_VERSION);

        let table_count: i64 = conn
            .query_row(
                r#"
                SELECT COUNT(*)
                FROM sqlite_master
                WHERE type IN ('table', 'index')
                "#,
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert!(table_count > 0);
    }

    #[test]
    fn ensure_schema_is_noop_when_version_matches() {
        let mut conn = Connection::open_in_memory().unwrap();

        ensure_schema(&mut conn).unwrap();
        ensure_schema(&mut conn).unwrap();

        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();

        assert_eq!(version, DB_VERSION);
    }
}
