//! Indexing IPC commands.
//!
//! This module exposes indexing-related operations to the frontend.
//!
//! Supported operations:
//!
//! - read current indexing status
//! - read indexing-related settings
//! - clean up stale index entries
//!
//! The actual indexing implementation lives in:
//!
//! - `store::indexer::runtime`

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::app_state::SharedSettingsPath;
use crate::models::indexing::{IndexingStats, IndexingStatusResponse};
use crate::models::settings::AppSettings;
use crate::store::indexer::runtime::IndexerRuntime;
use crate::store::settings::load_settings;
use tauri::State;

#[tauri::command]
pub async fn full_scan(runtime: State<'_, Arc<IndexerRuntime>>) -> Result<(), String> {
    runtime.full_scan().await
}

/// Removes index entries whose source files no longer exist.
///
/// This command delegates the actual cleanup work to [`IndexerRuntime`].
///
/// # Returns
///
/// Number of removed stale entries.
#[tauri::command]
pub async fn cleanup_missing_source_paths(
    runtime: State<'_, Arc<IndexerRuntime>>,
) -> Result<usize, String> {
    runtime.cleanup_missing_source_paths().await
}

/// Returns the current indexing status.
///
/// The response combines:
///
/// - live indexing statistics
/// - indexing settings loaded from `settings.json`
///
/// This is used by the frontend status/debug views.
#[tauri::command]
pub fn get_indexing_stats(
    stats: tauri::State<Arc<Mutex<IndexingStats>>>,
    settings_path: tauri::State<SharedSettingsPath>,
) -> Result<IndexingStatusResponse, String> {
    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?.clone();

    get_indexing_stats_for_test(stats.inner().clone(), settings_path)
}

/// Builds an indexing status response from explicit dependencies.
///
/// This helper exists so indexing status behavior can be tested without
/// requiring a full Tauri application state.
///
/// # Returns
///
/// [`IndexingStatusResponse`] containing:
///
/// - cloned indexing statistics
/// - indexing settings from `settings.json`
pub fn get_indexing_stats_for_test(
    stats: Arc<Mutex<IndexingStats>>,
    settings_path: PathBuf,
) -> Result<IndexingStatusResponse, String> {
    let stats = stats.lock().map(|s| s.clone()).map_err(|e| e.to_string())?;

    let settings: AppSettings = load_settings(&settings_path);

    Ok(IndexingStatusResponse {
        stats,
        settings: settings.indexing,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    use chrono::Utc;

    use crate::models::indexing::WatchStatus;

    fn create_temp_settings_path() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("glimpse_settings_test_{unique}.json"))
    }

    #[test]
    fn returns_indexing_status_response() {
        let settings_path = create_temp_settings_path();

        fs::write(
            &settings_path,
            r#"
{
  "theme": "nord",
  "targetGroups": [],
  "currentTargetGroupId": null,
  "indexing": {
    "ignoreHiddenFiles": true,
    "ignorePatterns": [".git/**", "node_modules/**"],
    "maxFileSizeBytes": 1048576
  }
}
"#,
        )
        .unwrap();

        let stats = Arc::new(Mutex::new(IndexingStats {
            indexed_items: 42,
            watch_status: WatchStatus::Active,
            last_scan_at: Some(Utc::now()),
            startup_warm: Default::default(),
            global_search_load: Default::default(),
        }));

        let result = get_indexing_stats_for_test(stats, settings_path.clone()).unwrap();

        assert_eq!(result.stats.indexed_items, 42);
        assert!(matches!(result.stats.watch_status, WatchStatus::Active));
        assert!(result.settings.ignore_hidden_files);
        assert_eq!(
            result.settings.ignore_patterns,
            vec![".git/**".to_string(), "node_modules/**".to_string()]
        );
        assert_eq!(result.settings.max_file_size_bytes, Some(1024 * 1024));

        fs::remove_file(settings_path).ok();
    }
}
