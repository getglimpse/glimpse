//! Indexer runtime orchestration.
//!
//! This module manages the long-lived indexing runtime used by Glimpse.
//!
//! Responsibilities:
//!
//! - Load indexing-related settings.
//! - Build an [`Indexer`] instance.
//! - Run the initial full scan.
//! - Start and stop filesystem watching.
//! - Switch current target groups.
//! - Switch the current SQLite database.
//! - Rebuild the indexer when settings or target groups change.
//! - Provide global search across target groups.
//!
//! The runtime owns shared infrastructure that must survive across IPC calls:
//!
//! - active search engine
//! - shared SQLite connection
//! - fallback target directory
//! - settings path
//! - indexing stats
//! - current watch task
//!
//! Runtime lifecycle:
//!
//! ```text
//! app startup
//!     ↓
//! IndexerRuntime::start()
//!     ↓
//! load settings
//!     ↓
//! rebuild()
//!     ↓
//! stop old watcher
//!     ↓
//! switch current database
//!     ↓
//! full scan
//!     ↓
//! start filesystem watcher
//! ```
//!
//! Target group switching follows the same rebuild path so scan/watch behavior
//! remains consistent.
//!
//! Database layout:
//!
//! ```text
//! <target-dir>/.glimpse/index.db
//! ```
//!
//! Each target group uses the first configured path as its primary database
//! location.

use std::collections::{HashMap, HashSet};
#[cfg(windows)]
use std::ffi::c_void;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::AbortHandle;
use tracing::{debug, error, info, warn};

use rusqlite::Connection;

use crate::models::indexing::{IndexingStats, StartupWarmStatus, WatchStatus};
use crate::models::settings::AppSettings;
use crate::search::{ActiveSearchEngine, SearchEngine, SearchError, SearchRequest, SearchResult};
use crate::store::db::init_db;
use crate::store::schema::{apply_pragmas, ensure_schema};
use crate::store::settings::{load_settings, save_settings};
use crate::utils::path::source_id_for_path;

use super::{canonical_or_original, resolve_target_dirs, Indexer};

mod db_files;
mod global_search;
mod lifecycle;
mod memory;
mod migration;
mod startup_warm;

use db_files::{
    current_db_path_for_settings, db_path_for_target_dir, remove_sqlite_database_files,
    remove_tantivy_index_dir_for_db_path, replace_sqlite_database_files,
    replace_tantivy_index_dir_for_db_path, tantivy_index_path_for_db_path, TempDirCleanup,
};
use memory::{current_process_memory_bytes, duration_millis_u64};
use migration::{global_primary_target_dirs, migrate_primary_glimpse_dirs};
use startup_warm::{
    set_startup_warm_aborted, set_startup_warm_error, warm_non_current_active_target_group_indexes,
};

/// Internal Glimpse directory created inside each target directory.
const GLIMPSE_DIR: &str = ".glimpse";

/// SQLite database filename stored inside [`GLIMPSE_DIR`].
const DB_FILE: &str = "index.db";

/// Long-lived indexing runtime.
///
/// This type is stored as Tauri managed state and used by IPC commands to:
///
/// - start indexing
/// - index individual files
/// - remove deleted files from the index
/// - switch target groups
/// - run global search
/// - clean up missing source paths
///
/// The runtime coordinates the [`Indexer`] but does not implement parsing or
/// search logic directly.
#[derive(Clone)]
pub struct IndexerRuntime {
    /// Current active search engine.
    engine: Arc<ActiveSearchEngine>,

    /// Shared current SQLite connection.
    ///
    /// This connection is replaced when the current target group changes.
    db: Arc<Mutex<Connection>>,

    /// Default target directory used when no target group is configured.
    fallback_target_dir: PathBuf,

    /// Shared path to `settings.json`.
    settings_path: Arc<Mutex<PathBuf>>,

    /// Shared indexing statistics exposed to the frontend.
    stats: Arc<Mutex<IndexingStats>>,

    /// Currently running filesystem watcher task.
    ///
    /// Replaced whenever the runtime is rebuilt.
    watch_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,

    /// Startup/background warm scan for non-current active target groups.
    ///
    /// Aborted before explicit user-triggered target switches or manual scans
    /// so background warming does not contend with foreground index work.
    warm_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,

    /// User-triggered full scan running against target-local temporary
    /// artifacts.
    ///
    /// Target switches abort this task instead of waiting for it to finish.
    manual_full_scan_task: Arc<Mutex<Option<(uuid::Uuid, AbortHandle)>>>,

    /// Serializes foreground operations that mutate or switch the shared
    /// current database/search engine.
    foreground_index_work: Arc<AsyncMutex<()>>,

    /// Search engines opened for global search, keyed by SQLite database path.
    ///
    /// These engines have their own SQLite connections and Tantivy readers so
    /// global search does not rebuild engine state on every IPC request.
    global_search_engines: Arc<Mutex<HashMap<PathBuf, Arc<ActiveSearchEngine>>>>,
}

impl IndexerRuntime {
    /// Creates a new indexing runtime.
    ///
    /// This does not start scanning or watching by itself.
    /// Call [`Self::start`] to begin the runtime lifecycle.
    pub fn new(
        engine: Arc<ActiveSearchEngine>,
        db: Arc<Mutex<Connection>>,
        fallback_target_dir: PathBuf,
        settings_path: Arc<Mutex<PathBuf>>,
    ) -> Self {
        Self {
            engine,
            db,
            fallback_target_dir,
            settings_path,
            stats: Arc::new(Mutex::new(IndexingStats {
                indexed_items: 0,
                watch_status: WatchStatus::Stopped,
                last_scan_at: None,
                startup_warm: Default::default(),
                global_search_load: Default::default(),
            })),
            watch_task: Arc::new(Mutex::new(None)),
            warm_task: Arc::new(Mutex::new(None)),
            manual_full_scan_task: Arc::new(Mutex::new(None)),
            foreground_index_work: Arc::new(AsyncMutex::new(())),
            global_search_engines: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns shared indexing statistics.
    ///
    /// The frontend reads this through indexing IPC commands.
    pub fn stats(&self) -> Arc<Mutex<IndexingStats>> {
        self.stats.clone()
    }

    /// Starts the indexing runtime.
    ///
    /// This loads settings and performs a full rebuild:
    ///
    /// - switch current database
    /// - run full scan
    /// - start filesystem watcher
    pub async fn start(&self) -> Result<(), String> {
        info!("starting indexer runtime");

        let settings = self.load_settings()?;

        self.rebuild(settings.clone()).await?;
        self.warm_non_current_active_target_group_indexes_async(settings);

        info!("indexer runtime started");

        Ok(())
    }

    fn restart_watch_async(&self, settings: AppSettings) {
        let engine = self.engine.clone();
        let fallback_target_dir = self.fallback_target_dir.clone();
        let stats = self.stats.clone();
        let watch_task = self.watch_task.clone();

        debug!("restarting filesystem watcher asynchronously");

        tokio::spawn(async move {
            if let Ok(mut slot) = watch_task.lock() {
                if let Some(handle) = slot.take() {
                    debug!("aborting previous filesystem watcher");
                    handle.abort();
                }
            } else {
                warn!("failed to lock watch task while restarting watcher");
            }

            if let Ok(mut stats) = stats.lock() {
                stats.watch_status = WatchStatus::Stopped;
            } else {
                warn!("failed to lock indexing stats while restarting watcher");
            }

            let indexer =
                Indexer::new_with_stats(engine, fallback_target_dir, settings, stats.clone());

            let next_watch_task = indexer.start_watch();

            if let Ok(mut slot) = watch_task.lock() {
                *slot = next_watch_task;
                info!("filesystem watcher restarted");
            } else {
                warn!("failed to store restarted watcher task");
            }
        });
    }

    /// Runs a manual full scan for the current target group.
    ///
    /// This keeps the current database and watcher,
    /// and only refreshes indexed items from filesystem content.
    pub async fn full_scan(&self) -> Result<(), String> {
        info!("manual full scan started");

        self.abort_warm_task("manual full scan");
        self.abort_manual_full_scan_task("starting manual full scan");

        let task_id = uuid::Uuid::new_v4();
        let runtime = self.clone();
        let handle = tokio::spawn(async move { runtime.run_manual_full_scan_task(task_id).await });
        let abort_handle = handle.abort_handle();

        match self.manual_full_scan_task.lock() {
            Ok(mut slot) => {
                *slot = Some((task_id, abort_handle));
            }
            Err(error) => {
                handle.abort();
                return Err(error.to_string());
            }
        }

        let result = match handle.await {
            Ok(result) => result,
            Err(error) if error.is_cancelled() => Err("manual full scan aborted".to_string()),
            Err(error) => Err(error.to_string()),
        };

        self.clear_manual_full_scan_task(task_id);

        result?;

        info!("manual full scan completed");

        Ok(())
    }

    /// Indexes or updates a single file.
    ///
    /// Used by commands or watcher events when one path changes.
    pub async fn index_file(&self, path: PathBuf) -> Result<(), String> {
        debug!(
            path = %path.display(),
            "indexing single file"
        );

        let settings = self.load_settings()?;

        let indexer = Indexer::new_with_stats(
            self.engine.clone(),
            self.fallback_target_dir.clone(),
            settings,
            self.stats.clone(),
        );

        indexer.index_path(&path).await.map_err(|error| {
            error!(
                path = %path.display(),
                error = %error,
                "failed to index single file"
            );
            error.to_string()
        })?;

        debug!(
            path = %path.display(),
            "single file indexed"
        );

        Ok(())
    }

    /// Deletes a single file from the search index.
    ///
    /// The item id is derived from the stable path id.
    pub async fn delete_file_from_index(&self, path: PathBuf) -> Result<(), String> {
        let settings = self.load_settings()?;

        let target_dirs = resolve_target_dirs(&settings, self.fallback_target_dir.clone());
        let group_name = settings.current_target_group_name();

        let Some((target_index, target_dir)) = target_dirs
            .iter()
            .enumerate()
            .find(|(_, target_dir)| path.starts_with(target_dir))
        else {
            warn!(
                path = %path.display(),
                "failed to resolve target dir for delete"
            );
            return Ok(());
        };

        let source_id = source_id_for_path(&group_name, target_index, target_dir, &path);

        debug!(
            path = %path.display(),
            source_id = %source_id,
            "deleting file from index"
        );

        self.engine
            .delete_by_source_id(&source_id)
            .await
            .map_err(|error| {
                error!(
                    path = %path.display(),
                    source_id = %source_id,
                    error = %error,
                    "failed to delete file from index"
                );
                error.to_string()
            })?;

        Ok(())
    }

    /// Switches to the next active target group.
    ///
    /// Returns an error when there is no other active group to switch to.
    ///
    /// After switching, the runtime is rebuilt so the current database,
    /// full scan, and watcher all reflect the new target group.
    pub async fn switch_next_target_group(&self) -> Result<AppSettings, String> {
        let started_at = Instant::now();
        info!("switching to next target group");

        let phase_started_at = Instant::now();
        let path = self.settings_path()?;
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: settings_path"
        );

        let phase_started_at = Instant::now();
        let mut settings = load_settings(&path);
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: load_settings"
        );

        let phase_started_at = Instant::now();
        let active_groups = settings
            .target_groups
            .iter()
            .filter(|group| group.active)
            .collect::<Vec<_>>();

        if active_groups.len() < 2 {
            warn!("no other active target groups available; switch skipped");
            return Err("no other active target groups available".to_string());
        }

        let current_index = settings
            .current_target_group_id
            .as_ref()
            .and_then(|current_id| {
                active_groups
                    .iter()
                    .position(|group| &group.id == current_id)
            })
            .unwrap_or(0);

        let next_index = (current_index + 1) % active_groups.len();

        let next_group_id = active_groups[next_index].id.clone();
        settings.current_target_group_id = Some(next_group_id);
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: select_next_group"
        );

        info!(
            current_target_group_id = ?settings.current_target_group_id,
            "next target group selected"
        );

        let phase_started_at = Instant::now();
        save_settings(&path, &settings)?;
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: save_settings"
        );

        let phase_started_at = Instant::now();
        self.switch_current_group_runtime(settings.clone()).await?;
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: switch_current_group_runtime"
        );

        debug!(
            elapsed_ms = started_at.elapsed().as_millis(),
            "target group switch completed"
        );

        Ok(settings)
    }

    /// Switches to a specific target group.
    ///
    /// Returns an error if the target group id does not exist.
    ///
    /// After switching, the runtime is rebuilt.
    pub async fn switch_target_group(&self, group_id: String) -> Result<AppSettings, String> {
        let started_at = Instant::now();
        info!(
            group_id = %group_id,
            "switching target group"
        );

        let phase_started_at = Instant::now();
        let path = self.settings_path()?;
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: settings_path"
        );

        let phase_started_at = Instant::now();
        let mut settings = load_settings(&path);
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: load_settings"
        );

        let phase_started_at = Instant::now();
        let exists = settings
            .target_groups
            .iter()
            .any(|group| group.id == group_id);

        if !exists {
            warn!(
                group_id = %group_id,
                "target group not found"
            );

            return Err(format!("target group not found: {group_id}"));
        }

        settings.current_target_group_id = Some(group_id.clone());
        if let Some(group) = settings
            .target_groups
            .iter_mut()
            .find(|group| group.id == group_id)
        {
            group.active = true;
        }
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: select_group"
        );

        let phase_started_at = Instant::now();
        save_settings(&path, &settings)?;
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: save_settings"
        );

        let phase_started_at = Instant::now();
        self.switch_current_group_runtime(settings.clone()).await?;
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: switch_current_group_runtime"
        );

        info!(
            group_id = %group_id,
            "target group switched"
        );

        debug!(
            elapsed_ms = started_at.elapsed().as_millis(),
            "target group switch completed"
        );

        Ok(settings)
    }

    /// Applies settings changes that affect indexing runtime state.
    ///
    /// When a target group's primary path changes, its internal `.glimpse`
    /// directory is moved to the new primary path so the old directory is not
    /// left behind. The runtime is then rebuilt from the updated settings.
    pub async fn apply_settings_update(
        &self,
        previous_settings: &AppSettings,
        settings: AppSettings,
    ) -> Result<(), String> {
        info!(
            current_target_group_id = ?settings.current_target_group_id,
            "applying indexer runtime settings update"
        );

        self.abort_manual_full_scan_task("settings update");
        let _foreground_guard = self.foreground_index_work.lock().await;

        self.stop_watch();
        self.clear_global_search_engine_cache();
        self.detach_current_database()?;

        if let Err(error) = migrate_primary_glimpse_dirs(previous_settings, &settings) {
            warn!(
                error = %error,
                "failed to fully migrate glimpse directories"
            );
        }

        self.rebuild_with_foreground_lock(settings.clone()).await?;
        self.warm_non_current_active_target_group_indexes_async(settings);

        Ok(())
    }

    fn warm_non_current_active_target_group_indexes_async(&self, settings: AppSettings) {
        let fallback_target_dir = self.fallback_target_dir.clone();
        let runtime_engine = self.engine.clone();
        let stats = self.stats.clone();

        self.abort_warm_task("starting non-current active target group warm");

        let handle = tokio::spawn(async move {
            if let Err(error) = warm_non_current_active_target_group_indexes(
                settings,
                fallback_target_dir,
                runtime_engine,
                stats.clone(),
            )
            .await
            {
                set_startup_warm_error(&stats, error.to_string());
                warn!(
                    error = %error,
                    "failed to warm non-current active target group indexes"
                );
            }
        });

        match self.warm_task.lock() {
            Ok(mut slot) => {
                *slot = Some(handle);
            }
            Err(error) => {
                warn!(
                    error = %error,
                    "failed to store target group warm task"
                );
                handle.abort();
            }
        }
    }

    fn abort_warm_task(&self, reason: &'static str) {
        match self.warm_task.lock() {
            Ok(mut slot) => {
                if let Some(handle) = slot.take() {
                    debug!(reason, "aborting target group warm task");
                    handle.abort();
                    set_startup_warm_aborted(&self.stats, reason);
                }
            }
            Err(error) => {
                warn!(
                    error = %error,
                    reason,
                    "failed to lock target group warm task"
                );
            }
        }
    }

    fn abort_manual_full_scan_task(&self, reason: &'static str) {
        match self.manual_full_scan_task.lock() {
            Ok(mut slot) => {
                if let Some((task_id, handle)) = slot.take() {
                    debug!(
                        reason,
                        task_id = %task_id,
                        "aborting manual full scan task"
                    );
                    handle.abort();
                }
            }
            Err(error) => {
                warn!(
                    error = %error,
                    reason,
                    "failed to lock manual full scan task"
                );
            }
        }
    }

    fn clear_manual_full_scan_task(&self, task_id: uuid::Uuid) {
        match self.manual_full_scan_task.lock() {
            Ok(mut slot) => {
                if slot
                    .as_ref()
                    .is_some_and(|(stored_task_id, _)| *stored_task_id == task_id)
                {
                    *slot = None;
                }
            }
            Err(error) => {
                warn!(
                    error = %error,
                    task_id = %task_id,
                    "failed to clear manual full scan task"
                );
            }
        }
    }

    /// Removes indexed items whose source files no longer exist.
    ///
    /// This is useful after external file deletion, target directory cleanup,
    /// or app startup.
    pub async fn cleanup_missing_source_paths(&self) -> Result<usize, String> {
        info!("cleaning up missing source paths");

        let settings_path = self
            .settings_path
            .lock()
            .map_err(|error| {
                error!(
                    error = %error,
                    "failed to lock settings path during cleanup"
                );
                error.to_string()
            })?
            .clone();
        let settings = crate::store::settings::load_settings(&settings_path);

        let indexer = crate::store::indexer::Indexer::new_with_stats(
            self.engine.clone(),
            self.fallback_target_dir.clone(),
            settings,
            self.stats.clone(),
        );

        let removed = indexer
            .cleanup_missing_source_paths()
            .await
            .map_err(|error| error.to_string())?;

        info!(removed, "missing source paths cleanup completed");

        Ok(removed)
    }

    /// Loads application settings from the shared settings path.
    fn load_settings(&self) -> Result<AppSettings, String> {
        let path = self.settings_path()?;

        debug!(
            settings_path = %path.display(),
            "loading runtime settings"
        );

        Ok(load_settings(&path))
    }

    /// Returns a cloned settings path from shared state.
    fn settings_path(&self) -> Result<PathBuf, String> {
        self.settings_path
            .lock()
            .map_err(|error| {
                error!(
                    error = %error,
                    "failed to lock settings path"
                );
                error.to_string()
            })
            .map(|path| path.clone())
    }
}

#[cfg(test)]
#[path = "runtime/tests.rs"]
mod tests;
