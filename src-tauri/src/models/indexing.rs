//! Indexing-related data models.
//!
//! This module defines shared models representing the current indexing state.
//!
//! These models are used by:
//!
//! - `store::indexer::runtime`
//! - `commands::indexing`
//! - frontend status/debug views
//!
//! They provide information about:
//!
//! - indexed item counts
//! - filesystem watch state
//! - last scan time
//! - indexing configuration

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::models::settings::IndexingSettings;

/// Runtime indexing statistics.
///
/// This structure represents the current state of the indexing subsystem.
///
/// The values are updated by the indexing runtime and exposed to the
/// frontend through IPC commands.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexingStats {
    /// Total number of indexed items.
    pub indexed_items: usize,

    /// Current filesystem watch status.
    pub watch_status: WatchStatus,

    /// Timestamp of the last completed full scan.
    ///
    /// `None` means a scan has not yet been performed.
    pub last_scan_at: Option<DateTime<Utc>>,

    /// Background startup warm status for non-current active target groups.
    pub startup_warm: StartupWarmStats,

    /// Global search load counters exposed for runtime diagnostics.
    pub global_search_load: GlobalSearchLoadStats,
}

/// Filesystem watch state.
///
/// This value reflects the current status of realtime indexing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WatchStatus {
    /// Watch service is not running.
    Stopped,

    /// Filesystem watch is active and receiving updates.
    Active,

    /// Watch service encountered an unrecoverable error.
    Error,
}

/// Background startup warm progress.
///
/// Startup warm scans non-current active target groups and preloads their
/// Tantivy indexes so later target switches can reuse warm local artifacts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupWarmStats {
    pub status: StartupWarmStatus,
    pub current_group_id: Option<String>,
    pub current_group_name: Option<String>,
    pub completed_groups: usize,
    pub total_groups: usize,
    pub last_error: Option<String>,
}

impl Default for StartupWarmStats {
    fn default() -> Self {
        Self {
            status: StartupWarmStatus::Idle,
            current_group_id: None,
            current_group_name: None,
            completed_groups: 0,
            total_groups: 0,
            last_error: None,
        }
    }
}

/// Background startup warm state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupWarmStatus {
    Idle,
    Running,
    Completed,
    Aborted,
    Error,
}

/// Runtime load counters for global search.
///
/// Global search opens one search engine per target-group database and keeps
/// those engines cached. These counters make that behavior visible as target
/// group count grows.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchLoadStats {
    pub cached_engine_count: usize,
    pub tantivy_reader_count: usize,
    pub sqlite_connection_count: usize,
    pub last_target_database_count: usize,
    pub last_cache_miss_count: usize,
    pub last_search_latency_ms: u64,
    pub last_cold_open_latency_ms: u64,
    pub last_result_count: usize,
    pub process_memory_bytes: Option<u64>,
    pub startup_warm_memory_bytes: Option<u64>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Combined indexing information returned to the frontend.
///
/// This structure merges:
///
/// - runtime indexing statistics
/// - persisted indexing settings
///
/// It is primarily used by the indexing status page and debugging tools.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexingStatusResponse {
    /// Current runtime statistics.
    pub stats: IndexingStats,

    /// Persisted indexing configuration from `settings.json`.
    pub settings: IndexingSettings,
}
