//! SQLite database initialization.
//!
//! This module is responsible for creating and preparing the database
//! connection used by Glimpse.
//!
//! Initialization includes:
//!
//! - Opening the SQLite database file.
//! - Applying SQLite PRAGMA optimizations.
//! - Ensuring the required schema exists.
//! - Recreating schema objects when necessary.
//!
//! The actual schema definition is implemented in [`store::schema`].
//!
//! # Lifecycle
//!
//! ```text
//! open database
//!      ↓
//! apply pragmas
//!      ↓
//! ensure schema
//!      ↓
//! ready for indexing and search
//! ```
//!
//! Database initialization is performed once during application startup.

use crate::search::SearchError;
use crate::store::schema::{apply_pragmas, ensure_schema};

use rusqlite::Connection;

use std::path::Path;

/// Initializes the SQLite database used by Glimpse.
///
/// This function is the main entrypoint for database startup.
///
/// # Responsibilities
///
/// - Open the SQLite database file.
/// - Apply SQLite PRAGMA settings.
/// - Ensure the required schema exists.
/// - Upgrade or recreate schema structures when necessary.
///
/// # PRAGMA configuration
///
/// PRAGMA settings are delegated to [`apply_pragmas`].
///
/// Typical optimizations include:
///
/// - WAL mode
/// - synchronous mode
/// - cache tuning
///
/// # Schema management
///
/// Schema creation and version handling are delegated to
/// [`ensure_schema`].
///
/// The current implementation favors:
///
/// - fast startup
/// - simple schema evolution
/// - easy development iteration
///
/// over fully incremental migrations.
///
/// # Future plans
///
/// Stable releases may introduce:
///
/// - schema version tables
/// - incremental migrations
/// - backward-compatible upgrades
///
/// # Errors
///
/// Returns [`SearchError::DbError`] when:
///
/// - the database cannot be opened
/// - PRAGMA initialization fails
/// - schema creation fails
pub fn init_db(path: &Path) -> Result<Connection, SearchError> {
    let mut conn = Connection::open(path).map_err(|e| SearchError::DbError(e.to_string()))?;

    apply_pragmas(&conn).map_err(|e| SearchError::DbError(e.to_string()))?;
    ensure_schema(&mut conn).map_err(|e| SearchError::DbError(e.to_string()))?;

    Ok(conn)
}
