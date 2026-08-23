//! Application statistics IPC commands.
//!
//! This module exposes aggregated application statistics to the frontend.
//!
//! The actual statistics collection logic is implemented in:
//!
//! - `store::item_repository`
//!
//! Typical consumers:
//!
//! - About page
//! - Debug page
//! - Internal diagnostics
//!
//! The returned statistics are derived directly from the SQLite database and
//! represent the current indexed state.

use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::State;

use crate::models::stats::{AppStats, TagCloudEntry};
use crate::store::item_repository::{get_app_stats, get_tag_cloud as collect_tag_cloud};

/// Returns aggregated application statistics.
///
/// The returned values may include:
///
/// - total indexed items
/// - Markdown items
/// - Raw items
/// - External items
/// - Command items
/// - Pinned items
/// - Tagged items
/// - Alias items
///
/// Statistics are calculated from the current SQLite database contents and
/// therefore reflect the current search index state.
///
/// # Returns
///
/// [`AppStats`] containing aggregated counts used by the frontend.
#[tauri::command]
pub fn get_stats(db: State<Arc<Mutex<Connection>>>) -> Result<AppStats, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    get_app_stats(&conn).map_err(|e| e.to_string())
}

/// Returns aggregated tag usage for the active search index.
#[tauri::command]
pub fn get_tag_cloud(db: State<Arc<Mutex<Connection>>>) -> Result<Vec<TagCloudEntry>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    collect_tag_cloud(&conn).map_err(|e| e.to_string())
}
