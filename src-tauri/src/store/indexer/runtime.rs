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

    /// Rebuilds the current indexing runtime from settings.
    ///
    /// This is the central transition point used by startup and target group
    /// switching.
    ///
    /// Steps:
    ///
    /// 1. Stop the existing watcher.
    /// 2. Switch the current database.
    /// 3. Create a fresh [`Indexer`].
    /// 4. Run a full scan.
    /// 5. Start a new watcher.
    async fn rebuild(&self, settings: AppSettings) -> Result<(), String> {
        let _foreground_guard = self.foreground_index_work.lock().await;

        self.rebuild_with_foreground_lock(settings).await
    }

    async fn rebuild_with_foreground_lock(&self, settings: AppSettings) -> Result<(), String> {
        let started_at = Instant::now();
        info!(
            current_target_group_id = ?settings.current_target_group_id,
            "rebuilding indexer runtime"
        );

        let phase_started_at = Instant::now();
        self.stop_watch();
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "indexer runtime rebuild phase completed: stop_watch"
        );

        let phase_started_at = Instant::now();
        self.switch_database(&settings)?;
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "indexer runtime rebuild phase completed: switch_database"
        );

        let phase_started_at = Instant::now();
        let indexer = self
            .rebuild_current_index(settings.clone(), "runtime rebuild")
            .await?;
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "indexer runtime rebuild phase completed: rebuild_current_index"
        );

        let phase_started_at = Instant::now();
        let watch_task = indexer.start_watch();

        if let Ok(mut slot) = self.watch_task.lock() {
            *slot = watch_task;
        } else {
            warn!("failed to store watcher task during rebuild");
        }
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "indexer runtime rebuild phase completed: start_watch"
        );

        debug!(
            elapsed_ms = started_at.elapsed().as_millis(),
            "indexer runtime rebuild completed"
        );
        info!("indexer runtime rebuilt");

        Ok(())
    }

    async fn rebuild_current_index(
        &self,
        settings: AppSettings,
        context: &'static str,
    ) -> Result<Indexer<ActiveSearchEngine>, String> {
        let started_at = Instant::now();
        let phase_started_at = Instant::now();
        let mut indexer = self
            .prepare_indexer_for_full_scan(settings.clone(), context)
            .await?;
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            context, "rebuild current index phase completed: prepare_indexer_for_full_scan"
        );

        let phase_started_at = Instant::now();
        match indexer.full_scan().await {
            Ok(_) => {
                debug!(
                    elapsed_ms = phase_started_at.elapsed().as_millis(),
                    context, "rebuild current index phase completed: full_scan"
                );
                debug!(
                    elapsed_ms = started_at.elapsed().as_millis(),
                    context, "rebuild current index completed"
                );
                Ok(indexer)
            }
            Err(error) if error.is_recoverable_index_storage_error() => {
                warn!(
                    error = %error,
                    context,
                    "recovering current database after full scan storage failure"
                );

                self.recover_current_database(&settings)?;

                indexer = self.current_indexer(settings);

                let retry_started_at = Instant::now();
                indexer.full_scan().await.map_err(|retry_error| {
                    error!(
                        error = %retry_error,
                        context,
                        "full scan failed after database recovery"
                    );
                    retry_error.to_string()
                })?;
                debug!(
                    elapsed_ms = retry_started_at.elapsed().as_millis(),
                    context, "rebuild current index phase completed: retry_full_scan"
                );

                debug!(
                    elapsed_ms = started_at.elapsed().as_millis(),
                    context, "rebuild current index completed"
                );
                Ok(indexer)
            }
            Err(error) => {
                error!(error = %error, context, "full scan failed");
                Err(error.to_string())
            }
        }
    }

    async fn run_manual_full_scan_task(&self, task_id: uuid::Uuid) -> Result<(), String> {
        let settings = self.load_settings()?;
        let target_dirs = resolve_target_dirs(&settings, self.fallback_target_dir.clone());

        let Some(primary_target_dir) = target_dirs.first() else {
            let _foreground_guard = self.foreground_index_work.lock().await;
            self.rebuild_current_index(settings, "manual full scan")
                .await?;
            return Ok(());
        };

        let db_path = db_path_for_target_dir(primary_target_dir)?;
        let temp_root = db_path
            .parent()
            .unwrap_or(primary_target_dir)
            .join(format!("manual-full-scan-{task_id}"));
        let temp_db_path = temp_root.join(DB_FILE);
        let temp_tantivy_dir = temp_root.join("tantivy");
        let temp_cleanup = TempDirCleanup::new(temp_root.clone());

        if temp_root.exists() {
            fs::remove_dir_all(&temp_root).map_err(|error| {
                format!(
                    "failed to remove previous manual full scan temp directory: {}: {error}",
                    temp_root.display()
                )
            })?;
        }

        fs::create_dir_all(&temp_root).map_err(|error| {
            format!(
                "failed to create manual full scan temp directory: {}: {error}",
                temp_root.display()
            )
        })?;

        let scanned_stats = {
            let connection = init_db(&temp_db_path).map_err(|error| error.to_string())?;
            let temp_db = Arc::new(Mutex::new(connection));
            let temp_engine = Arc::new(
                ActiveSearchEngine::new(temp_db.clone(), temp_tantivy_dir.clone())
                    .map_err(|error| error.to_string())?,
            );
            let temp_stats = Arc::new(Mutex::new(IndexingStats {
                indexed_items: 0,
                watch_status: WatchStatus::Stopped,
                last_scan_at: None,
                startup_warm: Default::default(),
                global_search_load: Default::default(),
            }));

            let indexer = Indexer::new_with_stats(
                temp_engine,
                self.fallback_target_dir.clone(),
                settings.clone(),
                temp_stats.clone(),
            );

            indexer
                .cleanup_missing_source_paths()
                .await
                .map_err(|error| error.to_string())?;
            indexer
                .full_scan()
                .await
                .map_err(|error| error.to_string())?;

            {
                let conn = temp_db.lock().map_err(|error| error.to_string())?;
                conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                    .map_err(|error| error.to_string())?;
            }

            let scanned_stats = temp_stats
                .lock()
                .map_err(|error| error.to_string())?
                .clone();
            scanned_stats
        };

        self.complete_manual_full_scan(
            settings,
            db_path,
            temp_db_path,
            temp_tantivy_dir,
            scanned_stats,
        )
        .await?;

        drop(temp_cleanup);

        Ok(())
    }

    async fn complete_manual_full_scan(
        &self,
        settings: AppSettings,
        db_path: PathBuf,
        temp_db_path: PathBuf,
        temp_tantivy_dir: PathBuf,
        scanned_stats: IndexingStats,
    ) -> Result<(), String> {
        let _foreground_guard = self.foreground_index_work.lock().await;

        let current_settings = self.load_settings()?;
        let current_db_path =
            current_db_path_for_settings(&current_settings, self.fallback_target_dir.clone())?;

        if current_db_path.as_ref() != Some(&db_path) {
            info!(
                db_path = %db_path.display(),
                current_db_path = ?current_db_path,
                "discarding completed manual full scan because current target changed"
            );
            return Ok(());
        }

        self.stop_watch();
        self.detach_current_database()?;
        self.invalidate_global_search_engine(&db_path);
        replace_sqlite_database_files(&temp_db_path, &db_path)?;
        replace_tantivy_index_dir_for_db_path(&temp_tantivy_dir, &db_path)?;
        self.switch_database(&settings)?;

        if let Ok(mut stats) = self.stats.lock() {
            stats.indexed_items = scanned_stats.indexed_items;
            stats.last_scan_at = scanned_stats.last_scan_at;
        } else {
            warn!("failed to lock indexing stats after manual full scan swap");
        }

        self.restart_watch_async(settings);

        Ok(())
    }

    async fn prepare_indexer_for_full_scan(
        &self,
        settings: AppSettings,
        context: &'static str,
    ) -> Result<Indexer<ActiveSearchEngine>, String> {
        let started_at = Instant::now();
        let indexer = self.current_indexer(settings.clone());

        let phase_started_at = Instant::now();
        match indexer.cleanup_missing_source_paths().await {
            Ok(_) => {}
            Err(error) if error.is_recoverable_index_storage_error() => {
                warn!(
                    error = %error,
                    context,
                    "recovering current database after stale-source cleanup storage failure"
                );
                self.recover_current_database(&settings)?;
                return Ok(self.current_indexer(settings));
            }
            Err(error) => {
                error!(error = %error, context, "stale source cleanup failed");
                return Err(error.to_string());
            }
        }
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            context, "prepare indexer phase completed: cleanup_missing_source_paths"
        );

        debug!(
            elapsed_ms = started_at.elapsed().as_millis(),
            context, "prepare indexer completed"
        );

        Ok(indexer)
    }

    fn current_indexer(&self, settings: AppSettings) -> Indexer<ActiveSearchEngine> {
        Indexer::new_with_stats(
            self.engine.clone(),
            self.fallback_target_dir.clone(),
            settings,
            self.stats.clone(),
        )
    }

    async fn switch_current_group_runtime(&self, settings: AppSettings) -> Result<(), String> {
        let started_at = Instant::now();
        debug!(
            current_target_group_id = ?settings.current_target_group_id,
            "switching current group runtime"
        );

        self.abort_warm_task("target group switch");
        self.abort_manual_full_scan_task("target group switch");
        let _foreground_guard = self.foreground_index_work.lock().await;

        let phase_started_at = Instant::now();
        self.stop_watch();
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: stop_watch"
        );

        let phase_started_at = Instant::now();
        self.switch_database(&settings)?;
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: switch_database"
        );

        let phase_started_at = Instant::now();
        self.restart_watch_async(settings);
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "target group switch phase completed: restart_watch_async"
        );

        debug!(
            elapsed_ms = started_at.elapsed().as_millis(),
            "target group runtime switched"
        );

        Ok(())
    }

    /// Switches the current SQLite connection for the current target group.
    ///
    /// The current database is stored at:
    ///
    /// ```text
    /// <primary-target-dir>/.glimpse/index.db
    /// ```
    ///
    /// Only the first resolved target directory is used as the database home.
    fn switch_database(&self, settings: &AppSettings) -> Result<(), String> {
        let started_at = Instant::now();
        let phase_started_at = Instant::now();
        let target_dirs = resolve_target_dirs(settings, self.fallback_target_dir.clone());
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "switch database phase completed: resolve_target_dirs"
        );

        let Some(primary_target_dir) = target_dirs.first() else {
            info!("no target directory configured; switching to empty current database");
            let phase_started_at = Instant::now();
            self.detach_current_database()?;
            debug!(
                elapsed_ms = phase_started_at.elapsed().as_millis(),
                "switch database phase completed: detach_current_database"
            );
            debug!(
                elapsed_ms = started_at.elapsed().as_millis(),
                "switch database completed"
            );
            return Ok(());
        };

        let phase_started_at = Instant::now();
        let db_path = db_path_for_target_dir(primary_target_dir)?;
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "switch database phase completed: db_path_for_target_dir"
        );

        debug!(
            primary_target_dir = %primary_target_dir.display(),
            db_path = %db_path.display(),
            "switching current database"
        );

        let phase_started_at = Instant::now();
        let connection = match init_db(&db_path) {
            Ok(connection) => connection,
            Err(error) if error.is_recoverable_index_storage_error() => {
                warn!(
                    db_path = %db_path.display(),
                    error = %error,
                    "recovering current database after initialization storage failure"
                );

                self.detach_current_database()?;
                self.invalidate_global_search_engine(&db_path);
                remove_sqlite_database_files(&db_path)?;

                init_db(&db_path).map_err(|retry_error| {
                    error!(
                        db_path = %db_path.display(),
                        error = %retry_error,
                        "failed to initialize current database after recovery"
                    );
                    retry_error.to_string()
                })?
            }
            Err(error) => {
                error!(
                    db_path = %db_path.display(),
                    error = %error,
                    "failed to initialize current database"
                );
                return Err(error.to_string());
            }
        };
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "switch database phase completed: init_db"
        );

        let phase_started_at = Instant::now();
        let mut db = self.db.lock().map_err(|error| {
            error!(
                error = %error,
                "failed to lock current database connection"
            );
            error.to_string()
        })?;

        *db = connection;
        drop(db);
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "switch database phase completed: replace_sqlite_connection"
        );

        let index_dir = tantivy_index_path_for_db_path(&db_path);
        let phase_started_at = Instant::now();
        self.engine
            .switch_index(index_dir)
            .map_err(|error| error.to_string())?;
        debug!(
            elapsed_ms = phase_started_at.elapsed().as_millis(),
            "switch database phase completed: switch_tantivy_index"
        );

        info!(
            db_path = %db_path.display(),
            "current database switched"
        );

        debug!(
            elapsed_ms = started_at.elapsed().as_millis(),
            "switch database completed"
        );

        Ok(())
    }

    /// Recreates the current target group's database from scratch.
    ///
    /// The SQLite database only stores derived search index data, so it is safe
    /// to delete when FTS storage becomes unreadable. The caller is expected to
    /// run a full scan immediately after recovery.
    fn recover_current_database(&self, settings: &AppSettings) -> Result<(), String> {
        let target_dirs = resolve_target_dirs(settings, self.fallback_target_dir.clone());

        let Some(primary_target_dir) = target_dirs.first() else {
            warn!("recovering current database by switching to empty database");
            self.clear_global_search_engine_cache();
            self.detach_current_database()?;
            return Ok(());
        };

        let db_path = db_path_for_target_dir(primary_target_dir)?;

        warn!(
            db_path = %db_path.display(),
            "recovering current database by recreating SQLite index file"
        );

        self.detach_current_database()?;
        self.invalidate_global_search_engine(&db_path);
        remove_sqlite_database_files(&db_path)?;
        remove_tantivy_index_dir_for_db_path(&db_path)?;
        self.switch_database(settings)?;

        Ok(())
    }

    /// Stops the current filesystem watcher task.
    ///
    /// This is called before rebuilding the runtime to avoid duplicate
    /// watchers observing the same or previous target directories.
    fn stop_watch(&self) {
        debug!("stopping filesystem watcher");

        if let Ok(mut slot) = self.watch_task.lock() {
            if let Some(handle) = slot.take() {
                handle.abort();
                debug!("filesystem watcher aborted");
            }
        } else {
            warn!("failed to lock watcher task while stopping watcher");
        }

        if let Ok(mut stats) = self.stats.lock() {
            stats.watch_status = WatchStatus::Stopped;
        } else {
            warn!("failed to lock indexing stats while stopping watcher");
        }
    }

    /// Replaces the current database connection with an in-memory connection.
    ///
    /// This drops the file-backed SQLite connection before moving or removing
    /// `.glimpse`, which is required on Windows because open database files
    /// cannot be renamed.
    fn detach_current_database(&self) -> Result<(), String> {
        debug!("detaching current database connection");

        let mut connection = Connection::open_in_memory().map_err(|error| {
            error!(
                error = %error,
                "failed to open temporary in-memory database"
            );
            error.to_string()
        })?;

        apply_pragmas(&connection).map_err(|error| {
            error!(
                error = %error,
                "failed to apply pragmas to temporary database"
            );
            error.to_string()
        })?;

        ensure_schema(&mut connection).map_err(|error| {
            error!(
                error = %error,
                "failed to initialize temporary database schema"
            );
            error.to_string()
        })?;

        let mut db = self.db.lock().map_err(|error| {
            error!(
                error = %error,
                "failed to lock current database connection"
            );
            error.to_string()
        })?;

        *db = connection;
        drop(db);

        self.engine
            .detach_index()
            .map_err(|error| error.to_string())?;

        debug!("current database detached");

        Ok(())
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

    /// Searches all target group databases.
    ///
    /// Unlike normal search, which queries only the current database,
    /// global search opens each target group's primary database and merges
    /// the results.
    ///
    /// Results are sorted by score descending and truncated to the request
    /// limit after merging.
    pub async fn search_global(
        &self,
        req: SearchRequest,
    ) -> Result<Vec<SearchResult>, SearchError> {
        let started_at = Instant::now();
        debug!(
            query = %req.query,
            limit = req.limit,
            "global search started"
        );

        let settings = self.load_settings().map_err(SearchError::DbError)?;

        let db_paths = self.global_db_paths(&settings)?;

        debug!(
            db_count = db_paths.len(),
            "global search database paths resolved"
        );

        let mut results = Vec::new();
        let target_database_count = db_paths.len();
        let mut cache_miss_count = 0;
        let mut cold_open_latency = Duration::ZERO;

        for db_path in db_paths {
            debug!(
                db_path = %db_path.display(),
                "searching target group database"
            );

            let lookup = self.cached_global_search_engine(&db_path)?;
            if lookup.cache_miss {
                cache_miss_count += 1;
                cold_open_latency += lookup.open_latency;
            }
            lookup.engine.reload_index()?;

            let mut group_results = lookup.engine.search(req.clone()).await?;

            debug!(
                db_path = %db_path.display(),
                count = group_results.len(),
                "target group database search completed"
            );

            results.append(&mut group_results);
        }

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        results.truncate(req.limit);

        self.record_global_search_load(
            target_database_count,
            cache_miss_count,
            started_at.elapsed(),
            cold_open_latency,
            results.len(),
        );

        debug!(count = results.len(), "global search completed");

        Ok(results)
    }

    /// Returns database paths used for global search.
    fn global_db_paths(&self, settings: &AppSettings) -> Result<Vec<PathBuf>, SearchError> {
        let target_dirs = global_primary_target_dirs(settings, self.fallback_target_dir.clone());

        debug!(
            target_dir_count = target_dirs.len(),
            "resolving global database paths"
        );

        target_dirs
            .into_iter()
            .map(|target_dir| db_path_for_target_dir(&target_dir).map_err(SearchError::DbError))
            .collect()
    }

    fn cached_global_search_engine(
        &self,
        db_path: &Path,
    ) -> Result<GlobalSearchEngineLookup, SearchError> {
        let mut cache = self
            .global_search_engines
            .lock()
            .map_err(|error| SearchError::IndexError(error.to_string()))?;

        if let Some(engine) = cache.get(db_path) {
            debug!(
                db_path = %db_path.display(),
                "global search engine cache hit"
            );

            return Ok(GlobalSearchEngineLookup {
                engine: engine.clone(),
                cache_miss: false,
                open_latency: Duration::ZERO,
            });
        }

        debug!(
            db_path = %db_path.display(),
            "global search engine cache miss"
        );

        let started_at = Instant::now();
        let connection = init_db(db_path).map_err(|error| {
            error!(
                db_path = %db_path.display(),
                error = %error,
                "failed to initialize database for global search"
            );
            SearchError::DbError(error.to_string())
        })?;

        let db = Arc::new(Mutex::new(connection));
        let engine = Arc::new(ActiveSearchEngine::new(
            db,
            tantivy_index_path_for_db_path(db_path),
        )?);

        cache.insert(db_path.to_path_buf(), engine.clone());

        Ok(GlobalSearchEngineLookup {
            engine,
            cache_miss: true,
            open_latency: started_at.elapsed(),
        })
    }

    fn invalidate_global_search_engine(&self, db_path: &Path) {
        match self.global_search_engines.lock() {
            Ok(mut cache) => {
                if cache.remove(db_path).is_some() {
                    debug!(
                        db_path = %db_path.display(),
                        "invalidated cached global search engine"
                    );
                }
            }
            Err(error) => {
                warn!(
                    error = %error,
                    "failed to lock global search engine cache for invalidation"
                );
            }
        }

        self.refresh_global_search_load_cache_counts();
    }

    fn clear_global_search_engine_cache(&self) {
        match self.global_search_engines.lock() {
            Ok(mut cache) => {
                let count = cache.len();
                cache.clear();
                debug!(count, "cleared global search engine cache");
            }
            Err(error) => {
                warn!(
                    error = %error,
                    "failed to lock global search engine cache for clearing"
                );
            }
        }

        self.refresh_global_search_load_cache_counts();
    }

    fn record_global_search_load(
        &self,
        target_database_count: usize,
        cache_miss_count: usize,
        search_latency: Duration,
        cold_open_latency: Duration,
        result_count: usize,
    ) {
        let (cached_engine_count, tantivy_reader_count, sqlite_connection_count) =
            self.global_search_cache_counts();

        self.update_global_search_load_stats(|load| {
            load.cached_engine_count = cached_engine_count;
            load.tantivy_reader_count = tantivy_reader_count;
            load.sqlite_connection_count = sqlite_connection_count;
            load.last_target_database_count = target_database_count;
            load.last_cache_miss_count = cache_miss_count;
            load.last_search_latency_ms = duration_millis_u64(search_latency);
            load.last_cold_open_latency_ms = duration_millis_u64(cold_open_latency);
            load.last_result_count = result_count;
            load.process_memory_bytes = current_process_memory_bytes();
        });
    }

    fn refresh_global_search_load_cache_counts(&self) {
        let (cached_engine_count, tantivy_reader_count, sqlite_connection_count) =
            self.global_search_cache_counts();

        self.update_global_search_load_stats(|load| {
            load.cached_engine_count = cached_engine_count;
            load.tantivy_reader_count = tantivy_reader_count;
            load.sqlite_connection_count = sqlite_connection_count;
            load.process_memory_bytes = current_process_memory_bytes();
        });
    }

    fn global_search_cache_counts(&self) -> (usize, usize, usize) {
        match self.global_search_engines.lock() {
            Ok(cache) => {
                let cached_engine_count = cache.len();
                let tantivy_reader_count = cache
                    .values()
                    .filter_map(|engine| engine.cached_index_count().ok())
                    .sum();
                let sqlite_connection_count = cached_engine_count;

                (
                    cached_engine_count,
                    tantivy_reader_count,
                    sqlite_connection_count,
                )
            }
            Err(error) => {
                warn!(
                    error = %error,
                    "failed to lock global search engine cache for load stats"
                );

                (0, 0, 0)
            }
        }
    }

    fn update_global_search_load_stats(
        &self,
        update: impl FnOnce(&mut crate::models::indexing::GlobalSearchLoadStats),
    ) {
        match self.stats.lock() {
            Ok(mut stats) => {
                update(&mut stats.global_search_load);
                stats.global_search_load.updated_at = Some(chrono::Utc::now());
            }
            Err(error) => {
                warn!(
                    error = %error,
                    "failed to lock indexing stats for global search load update"
                );
            }
        }
    }
}

struct GlobalSearchEngineLookup {
    engine: Arc<ActiveSearchEngine>,
    cache_miss: bool,
    open_latency: Duration,
}

async fn warm_non_current_active_target_group_indexes(
    settings: AppSettings,
    fallback_target_dir: PathBuf,
    runtime_engine: Arc<ActiveSearchEngine>,
    stats: Arc<Mutex<IndexingStats>>,
) -> Result<(), String> {
    let Some(current_id) = settings.current_target_group_id.as_deref() else {
        set_startup_warm_idle(&stats);
        return Ok(());
    };

    let current_db_path = resolve_target_dirs(&settings, fallback_target_dir.clone())
        .first()
        .map(|target_dir| db_path_for_target_dir(target_dir))
        .transpose()?;
    let mut warmed_db_paths = HashSet::new();
    let mut warm_targets = Vec::new();

    for group in settings
        .target_groups
        .iter()
        .filter(|group| group.active && group.id != current_id)
    {
        let mut group_settings = settings.clone();
        group_settings.current_target_group_id = Some(group.id.clone());

        let target_dirs = resolve_target_dirs(&group_settings, fallback_target_dir.clone());
        let Some(primary_target_dir) = target_dirs.first() else {
            continue;
        };

        let db_path = db_path_for_target_dir(primary_target_dir)?;
        if current_db_path.as_ref() == Some(&db_path) || !warmed_db_paths.insert(db_path.clone()) {
            continue;
        }

        warm_targets.push(WarmTarget {
            group_id: group.id.clone(),
            group_name: group.name.clone(),
            group_settings,
            db_path,
        });
    }

    if warm_targets.is_empty() {
        set_startup_warm_idle(&stats);
        return Ok(());
    }

    set_startup_warm_running(&stats, warm_targets.len());

    for (index, target) in warm_targets.into_iter().enumerate() {
        set_startup_warm_current(&stats, index, &target.group_id, &target.group_name);

        info!(
            group_id = %target.group_id,
            db_path = %target.db_path.display(),
            "warming non-current active target group index"
        );

        let mut recovered = false;

        loop {
            let connection = match init_db(&target.db_path) {
                Ok(connection) => connection,
                Err(error) if error.is_recoverable_index_storage_error() && !recovered => {
                    warn!(
                        db_path = %target.db_path.display(),
                        error = %error,
                        "recovering warmed database after initialization storage failure"
                    );
                    remove_sqlite_database_files(&target.db_path)?;
                    remove_tantivy_index_dir_for_db_path(&target.db_path)?;
                    recovered = true;
                    continue;
                }
                Err(error) => return Err(error.to_string()),
            };

            let db = Arc::new(Mutex::new(connection));
            let engine = Arc::new(
                ActiveSearchEngine::new(db, tantivy_index_path_for_db_path(&target.db_path))
                    .map_err(|error| error.to_string())?,
            );

            let indexer = Indexer::new_with_stats(
                engine,
                fallback_target_dir.clone(),
                target.group_settings.clone(),
                Arc::new(Mutex::new(IndexingStats {
                    indexed_items: 0,
                    watch_status: WatchStatus::Stopped,
                    last_scan_at: None,
                    startup_warm: Default::default(),
                    global_search_load: Default::default(),
                })),
            );

            let result = async {
                indexer.cleanup_missing_source_paths().await?;
                indexer.full_scan().await?;

                Ok::<(), SearchError>(())
            }
            .await;

            drop(indexer);

            match result {
                Ok(()) => {
                    runtime_engine
                        .warm_index(tantivy_index_path_for_db_path(&target.db_path))
                        .map_err(|error| error.to_string())?;

                    set_startup_warm_completed_count(&stats, index + 1);

                    info!(
                        group_id = %target.group_id,
                        db_path = %target.db_path.display(),
                        "warmed non-current active target group index"
                    );

                    break;
                }
                Err(error) if error.is_recoverable_index_storage_error() && !recovered => {
                    warn!(
                        db_path = %target.db_path.display(),
                        error = %error,
                        "recovering warmed database after indexing storage failure"
                    );
                    remove_sqlite_database_files(&target.db_path)?;
                    remove_tantivy_index_dir_for_db_path(&target.db_path)?;
                    recovered = true;
                }
                Err(error) => return Err(error.to_string()),
            }
        }
    }

    set_startup_warm_completed(&stats);

    Ok(())
}

struct WarmTarget {
    group_id: String,
    group_name: String,
    group_settings: AppSettings,
    db_path: PathBuf,
}

fn set_startup_warm_idle(stats: &Arc<Mutex<IndexingStats>>) {
    update_startup_warm_stats(stats, |stats| {
        stats.startup_warm.status = StartupWarmStatus::Idle;
        stats.startup_warm.current_group_id = None;
        stats.startup_warm.current_group_name = None;
        stats.startup_warm.completed_groups = 0;
        stats.startup_warm.total_groups = 0;
        stats.startup_warm.last_error = None;
    });
}

fn set_startup_warm_running(stats: &Arc<Mutex<IndexingStats>>, total_groups: usize) {
    update_startup_warm_stats(stats, |stats| {
        stats.startup_warm.status = StartupWarmStatus::Running;
        stats.startup_warm.current_group_id = None;
        stats.startup_warm.current_group_name = None;
        stats.startup_warm.completed_groups = 0;
        stats.startup_warm.total_groups = total_groups;
        stats.startup_warm.last_error = None;
    });
}

fn set_startup_warm_current(
    stats: &Arc<Mutex<IndexingStats>>,
    completed_groups: usize,
    group_id: &str,
    group_name: &str,
) {
    update_startup_warm_stats(stats, |stats| {
        stats.startup_warm.status = StartupWarmStatus::Running;
        stats.startup_warm.current_group_id = Some(group_id.to_string());
        stats.startup_warm.current_group_name = Some(group_name.to_string());
        stats.startup_warm.completed_groups = completed_groups;
    });
}

fn set_startup_warm_completed_count(stats: &Arc<Mutex<IndexingStats>>, completed_groups: usize) {
    update_startup_warm_stats(stats, |stats| {
        stats.startup_warm.completed_groups = completed_groups;
    });
}

fn set_startup_warm_completed(stats: &Arc<Mutex<IndexingStats>>) {
    update_startup_warm_stats(stats, |stats| {
        stats.startup_warm.status = StartupWarmStatus::Completed;
        stats.startup_warm.current_group_id = None;
        stats.startup_warm.current_group_name = None;
        stats.startup_warm.completed_groups = stats.startup_warm.total_groups;
        stats.startup_warm.last_error = None;
        stats.global_search_load.startup_warm_memory_bytes = current_process_memory_bytes();
        stats.global_search_load.process_memory_bytes = current_process_memory_bytes();
        stats.global_search_load.updated_at = Some(chrono::Utc::now());
    });
}

fn set_startup_warm_aborted(stats: &Arc<Mutex<IndexingStats>>, reason: &'static str) {
    update_startup_warm_stats(stats, |stats| {
        if !matches!(stats.startup_warm.status, StartupWarmStatus::Running) {
            return;
        }

        stats.startup_warm.status = StartupWarmStatus::Aborted;
        stats.startup_warm.current_group_id = None;
        stats.startup_warm.current_group_name = None;
        stats.startup_warm.last_error = Some(reason.to_string());
    });
}

fn set_startup_warm_error(stats: &Arc<Mutex<IndexingStats>>, error: String) {
    update_startup_warm_stats(stats, |stats| {
        stats.startup_warm.status = StartupWarmStatus::Error;
        stats.startup_warm.current_group_id = None;
        stats.startup_warm.current_group_name = None;
        stats.startup_warm.last_error = Some(error);
    });
}

fn update_startup_warm_stats(
    stats: &Arc<Mutex<IndexingStats>>,
    update: impl FnOnce(&mut IndexingStats),
) {
    match stats.lock() {
        Ok(mut stats) => update(&mut stats),
        Err(error) => {
            warn!(
                error = %error,
                "failed to update startup warm stats"
            );
        }
    }
}

fn duration_millis_u64(duration: Duration) -> u64 {
    duration.as_millis().try_into().unwrap_or(u64::MAX)
}

#[cfg(windows)]
fn current_process_memory_bytes() -> Option<u64> {
    #[repr(C)]
    struct ProcessMemoryCounters {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
    }

    #[link(name = "psapi")]
    extern "system" {
        fn GetProcessMemoryInfo(
            process: *mut c_void,
            counters: *mut ProcessMemoryCounters,
            size: u32,
        ) -> i32;
    }

    extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
    }

    let mut counters = ProcessMemoryCounters {
        cb: std::mem::size_of::<ProcessMemoryCounters>() as u32,
        page_fault_count: 0,
        peak_working_set_size: 0,
        working_set_size: 0,
        quota_peak_paged_pool_usage: 0,
        quota_paged_pool_usage: 0,
        quota_peak_non_paged_pool_usage: 0,
        quota_non_paged_pool_usage: 0,
        pagefile_usage: 0,
        peak_pagefile_usage: 0,
    };

    let process = unsafe { GetCurrentProcess() };
    let ok = unsafe { GetProcessMemoryInfo(process, &mut counters, counters.cb) };

    if ok == 0 {
        None
    } else {
        Some(counters.working_set_size as u64)
    }
}

#[cfg(target_os = "linux")]
fn current_process_memory_bytes() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let line = status.lines().find(|line| line.starts_with("VmRSS:"))?;
    let kib = line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u64>().ok())?;

    Some(kib * 1024)
}

#[cfg(not(any(windows, target_os = "linux")))]
fn current_process_memory_bytes() -> Option<u64> {
    None
}

/// Returns the SQLite database path for a target directory.
///
/// Creates the internal `.glimpse` directory if needed.
fn db_path_for_target_dir(target_dir: &Path) -> Result<PathBuf, String> {
    let glimpse_dir = target_dir.join(GLIMPSE_DIR);

    debug!(
        target_dir = %target_dir.display(),
        glimpse_dir = %glimpse_dir.display(),
        "ensuring glimpse database directory"
    );

    std::fs::create_dir_all(&glimpse_dir).map_err(|error| {
        error!(
            glimpse_dir = %glimpse_dir.display(),
            error = %error,
            "failed to create glimpse database directory"
        );
        error.to_string()
    })?;

    Ok(glimpse_dir.join(DB_FILE))
}

fn tantivy_index_path_for_db_path(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .map(|path| path.join("tantivy"))
        .unwrap_or_else(|| PathBuf::from("tantivy"))
}

fn remove_tantivy_index_dir_for_db_path(db_path: &Path) -> Result<(), String> {
    let index_dir = tantivy_index_path_for_db_path(db_path);

    match fs::remove_dir_all(&index_dir) {
        Ok(()) => {
            debug!(index_dir = %index_dir.display(), "removed Tantivy index directory");
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "failed to remove Tantivy index directory: {}: {error}",
            index_dir.display()
        )),
    }
}

fn replace_tantivy_index_dir_for_db_path(
    temp_index_dir: &Path,
    db_path: &Path,
) -> Result<(), String> {
    let index_dir = tantivy_index_path_for_db_path(db_path);

    remove_tantivy_index_dir_for_db_path(db_path)?;

    fs::rename(temp_index_dir, &index_dir).map_err(|error| {
        format!(
            "failed to replace Tantivy index directory: {} -> {}: {error}",
            temp_index_dir.display(),
            index_dir.display()
        )
    })?;

    debug!(
        temp_index_dir = %temp_index_dir.display(),
        index_dir = %index_dir.display(),
        "replaced Tantivy index directory"
    );

    Ok(())
}

fn remove_sqlite_database_files(db_path: &Path) -> Result<(), String> {
    for path in sqlite_database_files(db_path) {
        match fs::remove_file(&path) {
            Ok(()) => {
                debug!(path = %path.display(), "removed SQLite index file");
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "failed to remove SQLite index file: {}: {error}",
                    path.display()
                ));
            }
        }
    }

    Ok(())
}

fn replace_sqlite_database_files(temp_db_path: &Path, db_path: &Path) -> Result<(), String> {
    remove_sqlite_database_files(db_path)?;

    fs::rename(temp_db_path, db_path).map_err(|error| {
        format!(
            "failed to replace SQLite index file: {} -> {}: {error}",
            temp_db_path.display(),
            db_path.display()
        )
    })?;

    for path in sqlite_database_files(temp_db_path)
        .into_iter()
        .filter(|path| path != temp_db_path)
    {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "failed to remove temporary SQLite sidecar file: {}: {error}",
                    path.display()
                ));
            }
        }
    }

    debug!(
        temp_db_path = %temp_db_path.display(),
        db_path = %db_path.display(),
        "replaced SQLite index file"
    );

    Ok(())
}

fn sqlite_database_files(db_path: &Path) -> Vec<PathBuf> {
    let Some(file_name) = db_path.file_name().and_then(|name| name.to_str()) else {
        return vec![db_path.to_path_buf()];
    };

    vec![
        db_path.to_path_buf(),
        db_path.with_file_name(format!("{file_name}-wal")),
        db_path.with_file_name(format!("{file_name}-shm")),
    ]
}

fn current_db_path_for_settings(
    settings: &AppSettings,
    fallback_target_dir: PathBuf,
) -> Result<Option<PathBuf>, String> {
    resolve_target_dirs(settings, fallback_target_dir)
        .first()
        .map(|target_dir| db_path_for_target_dir(target_dir))
        .transpose()
}

struct TempDirCleanup {
    path: PathBuf,
}

impl TempDirCleanup {
    fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl Drop for TempDirCleanup {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                warn!(
                    path = %self.path.display(),
                    error = %error,
                    "failed to remove temporary manual full scan directory"
                );
            }
        }
    }
}

/// Returns the primary target directory for each target group.
///
/// For each target group, only the first non-empty path is used.
/// If no target groups exist, the fallback directory is returned.
fn global_primary_target_dirs(settings: &AppSettings, fallback: PathBuf) -> Vec<PathBuf> {
    if settings.target_groups.is_empty() {
        return vec![fallback];
    }

    settings
        .target_groups
        .iter()
        .filter_map(|group| {
            group
                .paths
                .iter()
                .map(|path| path.trim())
                .find(|path| !path.is_empty())
                .map(PathBuf::from)
        })
        .collect()
}

fn migrate_primary_glimpse_dirs(
    previous_settings: &AppSettings,
    settings: &AppSettings,
) -> Result<(), String> {
    let previous_dirs = primary_target_dirs_by_group(previous_settings);
    let next_dirs = primary_target_dirs_by_group(settings);
    let retained_dirs = next_dirs.values().cloned().collect::<HashSet<_>>();

    for (group_id, old_target_dir) in previous_dirs {
        let Some(new_target_dir) = next_dirs.get(&group_id) else {
            continue;
        };

        if old_target_dir == *new_target_dir {
            continue;
        }

        if retained_dirs.contains(&old_target_dir) {
            debug!(
                group_id = %group_id,
                old_target_dir = %old_target_dir.display(),
                "old primary target dir is still used; keeping glimpse directory"
            );
            continue;
        }

        move_or_remove_glimpse_dir(&old_target_dir, new_target_dir)?;
    }

    Ok(())
}

fn primary_target_dirs_by_group(settings: &AppSettings) -> HashMap<String, PathBuf> {
    settings
        .target_groups
        .iter()
        .filter_map(|group| {
            group
                .paths
                .iter()
                .map(|path| path.trim())
                .find(|path| !path.is_empty())
                .map(|path| (group.id.clone(), canonical_or_original(PathBuf::from(path))))
        })
        .collect()
}

fn move_or_remove_glimpse_dir(old_target_dir: &Path, new_target_dir: &Path) -> Result<(), String> {
    let old_glimpse_dir = old_target_dir.join(GLIMPSE_DIR);

    if !old_glimpse_dir.exists() {
        return Ok(());
    }

    if !old_glimpse_dir.is_dir() {
        return Err(format!(
            "glimpse path is not a directory: {}",
            old_glimpse_dir.display()
        ));
    }

    let new_glimpse_dir = new_target_dir.join(GLIMPSE_DIR);

    if new_glimpse_dir.exists() {
        fs::remove_dir_all(&old_glimpse_dir).map_err(|error| {
            format!(
                "failed to remove stale glimpse directory: {}: {error}",
                old_glimpse_dir.display()
            )
        })?;

        info!(
            old_glimpse_dir = %old_glimpse_dir.display(),
            new_glimpse_dir = %new_glimpse_dir.display(),
            "removed stale glimpse directory because destination already exists"
        );

        return Ok(());
    }

    if let Some(parent) = new_glimpse_dir.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create new target directory: {}: {error}",
                parent.display()
            )
        })?;
    }

    match fs::rename(&old_glimpse_dir, &new_glimpse_dir) {
        Ok(()) => {
            info!(
                old_glimpse_dir = %old_glimpse_dir.display(),
                new_glimpse_dir = %new_glimpse_dir.display(),
                "moved glimpse directory"
            );
        }
        Err(rename_error) => {
            warn!(
                old_glimpse_dir = %old_glimpse_dir.display(),
                new_glimpse_dir = %new_glimpse_dir.display(),
                error = %rename_error,
                "failed to rename glimpse directory; falling back to copy"
            );

            copy_dir_all(&old_glimpse_dir, &new_glimpse_dir).map_err(|error| {
                format!(
                    "failed to copy glimpse directory: {} -> {}: {error}",
                    old_glimpse_dir.display(),
                    new_glimpse_dir.display()
                )
            })?;

            fs::remove_dir_all(&old_glimpse_dir).map_err(|error| {
                format!(
                    "failed to remove copied glimpse directory: {}: {error}",
                    old_glimpse_dir.display()
                )
            })?;

            info!(
                old_glimpse_dir = %old_glimpse_dir.display(),
                new_glimpse_dir = %new_glimpse_dir.display(),
                "copied glimpse directory and removed old directory"
            );
        }
    }

    Ok(())
}

fn copy_dir_all(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::create_dir_all(destination)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        if source_path.is_dir() {
            copy_dir_all(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::models::settings::{AppSettings, TargetGroup};
    use crate::models::{IndexItem, Preview};
    use crate::search::{ActiveSearchEngine, SearchEngine, SearchRequest};
    use crate::store::settings::save_settings;
    use chrono::Utc;

    fn unique_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("glimpse_runtime_test_{unique}_{name}"))
    }

    fn target_group(id: &str, paths: Vec<PathBuf>) -> TargetGroup {
        TargetGroup {
            id: id.to_string(),
            name: id.to_string(),
            paths: paths
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect(),
            active: true,
        }
    }

    fn test_runtime(fallback_target_dir: PathBuf, settings_path: PathBuf) -> IndexerRuntime {
        let initial_db_path = fallback_target_dir.join(".glimpse").join("index.db");

        if let Some(parent) = initial_db_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }

        let connection = init_db(&initial_db_path).unwrap();
        let db = Arc::new(Mutex::new(connection));
        let engine = Arc::new(
            ActiveSearchEngine::new(
                db.clone(),
                fallback_target_dir.join(".glimpse").join("tantivy"),
            )
            .unwrap(),
        );

        IndexerRuntime::new(
            engine,
            db,
            fallback_target_dir,
            Arc::new(Mutex::new(settings_path)),
        )
    }

    #[test]
    fn db_path_for_target_dir_creates_glimpse_dir() {
        let target_dir = unique_test_dir("target");

        fs::create_dir_all(&target_dir).unwrap();

        let db_path = db_path_for_target_dir(&target_dir).unwrap();

        assert_eq!(db_path, target_dir.join(".glimpse").join("index.db"));
        assert!(target_dir.join(".glimpse").is_dir());

        fs::remove_dir_all(target_dir).ok();
    }

    #[test]
    fn settings_path_returns_cloned_path() {
        let target_dir = unique_test_dir("target");
        let settings_path = unique_test_dir("settings").join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let runtime = test_runtime(target_dir.clone(), settings_path.clone());

        assert_eq!(runtime.settings_path().unwrap(), settings_path);

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_path.parent().unwrap()).ok();
    }

    #[test]
    fn cached_global_search_engine_reuses_engine_for_same_database_path() {
        let target_dir = unique_test_dir("target");
        let settings_path = unique_test_dir("settings").join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let runtime = test_runtime(target_dir.clone(), settings_path.clone());
        let db_path = db_path_for_target_dir(&target_dir).unwrap();

        let first = runtime.cached_global_search_engine(&db_path).unwrap();
        let second = runtime.cached_global_search_engine(&db_path).unwrap();

        assert!(first.cache_miss);
        assert!(!second.cache_miss);
        assert!(Arc::ptr_eq(&first.engine, &second.engine));

        runtime.invalidate_global_search_engine(&db_path);

        let third = runtime.cached_global_search_engine(&db_path).unwrap();

        assert!(third.cache_miss);
        assert!(!Arc::ptr_eq(&first.engine, &third.engine));

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_path.parent().unwrap()).ok();
    }

    #[test]
    fn switch_database_uses_fallback_target_when_no_group_exists() {
        let fallback_target_dir = unique_test_dir("fallback");
        let settings_path = unique_test_dir("settings").join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

        let settings = AppSettings::default();

        runtime.switch_database(&settings).unwrap();

        assert!(fallback_target_dir
            .join(".glimpse")
            .join("index.db")
            .is_file());

        fs::remove_dir_all(fallback_target_dir).ok();
    }

    #[test]
    fn switch_database_uses_current_target_group_primary_path() {
        let fallback_target_dir = unique_test_dir("fallback");
        let work_dir = unique_test_dir("work");
        let docs_dir = unique_test_dir("docs");
        let settings_path = unique_test_dir("settings").join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        fs::create_dir_all(&docs_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

        let settings = AppSettings {
            target_groups: vec![target_group(
                "work",
                vec![work_dir.clone(), docs_dir.clone()],
            )],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        runtime.switch_database(&settings).unwrap();

        assert!(work_dir.join(".glimpse").join("index.db").is_file());
        assert!(!docs_dir.join(".glimpse").join("index.db").exists());

        fs::remove_dir_all(fallback_target_dir).ok();
        fs::remove_dir_all(work_dir).ok();
        fs::remove_dir_all(docs_dir).ok();
    }

    #[test]
    fn switch_database_uses_empty_database_when_current_group_has_no_paths() {
        let fallback_target_dir = unique_test_dir("fallback");
        let settings_path = unique_test_dir("settings").join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);
        let fallback_settings = AppSettings::default();

        runtime.switch_database(&fallback_settings).unwrap();

        {
            let conn = runtime.db.lock().unwrap();

            conn.execute("CREATE TABLE runtime_marker (value TEXT NOT NULL)", [])
                .unwrap();

            conn.execute("INSERT INTO runtime_marker (value) VALUES ('fallback')", [])
                .unwrap();
        }

        let empty_settings = AppSettings {
            target_groups: vec![target_group("empty", vec![])],
            current_target_group_id: Some("empty".to_string()),
            ..Default::default()
        };

        runtime.switch_database(&empty_settings).unwrap();

        let marker_exists_in_current_db = {
            let conn = runtime.db.lock().unwrap();

            conn.query_row("SELECT COUNT(*) FROM runtime_marker", [], |row| {
                row.get::<_, i64>(0)
            })
            .is_ok()
        };

        assert!(!marker_exists_in_current_db);

        fs::remove_dir_all(fallback_target_dir).ok();
    }

    #[test]
    fn switch_database_replaces_current_connection() {
        let fallback_target_dir = unique_test_dir("fallback");
        let work_dir = unique_test_dir("work");
        let settings_path = unique_test_dir("settings").join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

        let fallback_settings = AppSettings::default();

        runtime.switch_database(&fallback_settings).unwrap();

        {
            let conn = runtime.db.lock().unwrap();

            conn.execute("CREATE TABLE runtime_marker (value TEXT NOT NULL)", [])
                .unwrap();

            conn.execute("INSERT INTO runtime_marker (value) VALUES ('fallback')", [])
                .unwrap();
        }

        let work_settings = AppSettings {
            target_groups: vec![target_group("work", vec![work_dir.clone()])],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        runtime.switch_database(&work_settings).unwrap();

        let marker_exists_in_current_db = {
            let conn = runtime.db.lock().unwrap();

            conn.query_row("SELECT COUNT(*) FROM runtime_marker", [], |row| {
                row.get::<_, i64>(0)
            })
            .is_ok()
        };

        assert!(!marker_exists_in_current_db);

        assert!(fallback_target_dir
            .join(".glimpse")
            .join("index.db")
            .is_file());

        assert!(work_dir.join(".glimpse").join("index.db").is_file());

        fs::remove_dir_all(fallback_target_dir).ok();
        fs::remove_dir_all(work_dir).ok();
    }

    #[tokio::test]
    async fn full_scan_recovers_current_database_when_search_index_is_broken() {
        let fallback_target_dir = unique_test_dir("fallback");
        let work_dir = unique_test_dir("work");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
        fs::write(work_dir.join("note.md"), "# recovery_unique_token").unwrap();

        let settings = AppSettings {
            target_groups: vec![target_group("work", vec![work_dir.clone()])],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        save_settings(&settings_path, &settings).unwrap();

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

        runtime.switch_database(&settings).unwrap();
        runtime.full_scan().await.unwrap();

        {
            let conn = runtime.db.lock().unwrap();

            conn.execute("DROP TABLE search_index", []).unwrap();
        }

        runtime.full_scan().await.unwrap();

        let results = runtime
            .engine
            .search(SearchRequest::new("recovery_unique_token", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);

        fs::remove_dir_all(fallback_target_dir).ok();
        fs::remove_dir_all(work_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[tokio::test]
    async fn prepare_full_scan_keeps_existing_current_target_items() {
        let fallback_target_dir = unique_test_dir("fallback");
        let work_dir = unique_test_dir("work");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let source_path = work_dir.join("note.md");
        fs::write(&source_path, "# Existing").unwrap();

        let settings = AppSettings {
            target_groups: vec![target_group("work", vec![work_dir.clone()])],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        save_settings(&settings_path, &settings).unwrap();

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);
        runtime.switch_database(&settings).unwrap();

        runtime
            .engine
            .upsert(
                IndexItem::new(
                    "work/0/note.md",
                    "Existing Item",
                    Utc::now(),
                    Preview::Markdown {
                        content: "keep_existing_token".to_string(),
                    },
                )
                .with_source_path(source_path.to_string_lossy().to_string()),
            )
            .await
            .unwrap();

        runtime
            .prepare_indexer_for_full_scan(settings, "test full scan prepare")
            .await
            .unwrap();

        let results = runtime
            .engine
            .search(SearchRequest::new("keep_existing_token", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);

        fs::remove_dir_all(fallback_target_dir).ok();
        fs::remove_dir_all(work_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[tokio::test]
    async fn global_search_preserves_snippets_after_merge() {
        let fallback_target_dir = unique_test_dir("fallback");
        let work_dir = unique_test_dir("work");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let settings = AppSettings {
            target_groups: vec![target_group("work", vec![work_dir.clone()])],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        save_settings(&settings_path, &settings).unwrap();

        let db_path = db_path_for_target_dir(&work_dir).unwrap();
        let connection = init_db(&db_path).unwrap();
        let engine = ActiveSearchEngine::new(
            Arc::new(Mutex::new(connection)),
            tantivy_index_path_for_db_path(&db_path),
        )
        .unwrap();

        engine
            .upsert(IndexItem::new(
                "item-1",
                "Global Snippet",
                Utc::now(),
                Preview::Markdown {
                    content: "global_snippet_token body".to_string(),
                },
            ))
            .await
            .unwrap();

        drop(engine);

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);
        let results = runtime
            .search_global(SearchRequest::new("global_snippet_token", 10).global(true))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert!(results[0].snippets.is_some());

        fs::remove_dir_all(fallback_target_dir).ok();
        fs::remove_dir_all(work_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[tokio::test]
    async fn global_search_records_load_stats_for_cold_and_cached_targets() {
        let fallback_target_dir = unique_test_dir("fallback");
        let work_dir = unique_test_dir("work");
        let archive_dir = unique_test_dir("archive");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        fs::create_dir_all(&archive_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let settings = AppSettings {
            target_groups: vec![
                target_group("work", vec![work_dir.clone()]),
                target_group("archive", vec![archive_dir.clone()]),
            ],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        save_settings(&settings_path, &settings).unwrap();

        for (index, target_dir) in [&work_dir, &archive_dir].into_iter().enumerate() {
            let db_path = db_path_for_target_dir(target_dir).unwrap();
            let connection = init_db(&db_path).unwrap();
            let engine = ActiveSearchEngine::new(
                Arc::new(Mutex::new(connection)),
                tantivy_index_path_for_db_path(&db_path),
            )
            .unwrap();

            engine
                .upsert(IndexItem::new(
                    format!("item-{index}"),
                    format!("Load Stats {index}"),
                    Utc::now(),
                    Preview::Markdown {
                        content: "global_load_token body".to_string(),
                    },
                ))
                .await
                .unwrap();
        }

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

        let results = runtime
            .search_global(SearchRequest::new("global_load_token", 10).global(true))
            .await
            .unwrap();

        assert_eq!(results.len(), 2);

        {
            let stats = runtime.stats.lock().unwrap();
            assert_eq!(stats.global_search_load.last_target_database_count, 2);
            assert_eq!(stats.global_search_load.last_cache_miss_count, 2);
            assert_eq!(stats.global_search_load.cached_engine_count, 2);
            assert_eq!(stats.global_search_load.sqlite_connection_count, 2);
            assert_eq!(stats.global_search_load.tantivy_reader_count, 2);
            assert_eq!(stats.global_search_load.last_result_count, 2);
            assert!(stats.global_search_load.updated_at.is_some());
        }

        runtime
            .search_global(SearchRequest::new("global_load_token", 10).global(true))
            .await
            .unwrap();

        {
            let stats = runtime.stats.lock().unwrap();
            assert_eq!(stats.global_search_load.last_cache_miss_count, 0);
            assert_eq!(stats.global_search_load.cached_engine_count, 2);
            assert_eq!(stats.global_search_load.sqlite_connection_count, 2);
            assert_eq!(stats.global_search_load.tantivy_reader_count, 2);
        }

        fs::remove_dir_all(fallback_target_dir).ok();
        fs::remove_dir_all(work_dir).ok();
        fs::remove_dir_all(archive_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[tokio::test]
    async fn switch_next_target_group_skips_inactive_groups() {
        let fallback_target_dir = unique_test_dir("fallback");
        let work_dir = unique_test_dir("work");
        let personal_dir = unique_test_dir("personal");
        let archive_dir = unique_test_dir("archive");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        fs::create_dir_all(&personal_dir).unwrap();
        fs::create_dir_all(&archive_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let mut personal = target_group("personal", vec![personal_dir.clone()]);
        personal.active = false;

        let settings = AppSettings {
            target_groups: vec![
                target_group("work", vec![work_dir.clone()]),
                personal,
                target_group("archive", vec![archive_dir.clone()]),
            ],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        save_settings(&settings_path, &settings).unwrap();

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);
        let settings = runtime.switch_next_target_group().await.unwrap();

        assert_eq!(
            settings.current_target_group_id,
            Some("archive".to_string())
        );

        fs::remove_dir_all(fallback_target_dir).ok();
        fs::remove_dir_all(work_dir).ok();
        fs::remove_dir_all(personal_dir).ok();
        fs::remove_dir_all(archive_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[tokio::test]
    async fn switch_next_target_group_waits_for_foreground_index_work() {
        let fallback_target_dir = unique_test_dir("fallback");
        let work_dir = unique_test_dir("work");
        let archive_dir = unique_test_dir("archive");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        fs::create_dir_all(&archive_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let settings = AppSettings {
            target_groups: vec![
                target_group("work", vec![work_dir.clone()]),
                target_group("archive", vec![archive_dir.clone()]),
            ],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        save_settings(&settings_path, &settings).unwrap();

        let runtime = Arc::new(test_runtime(fallback_target_dir.clone(), settings_path));
        let foreground_guard = runtime.foreground_index_work.lock().await;
        let switching_runtime = runtime.clone();

        let switch_task =
            tokio::spawn(async move { switching_runtime.switch_next_target_group().await });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(
            !switch_task.is_finished(),
            "target switch should wait while foreground index work is active"
        );

        drop(foreground_guard);

        let settings = switch_task.await.unwrap().unwrap();

        assert_eq!(
            settings.current_target_group_id,
            Some("archive".to_string())
        );

        fs::remove_dir_all(fallback_target_dir).ok();
        fs::remove_dir_all(work_dir).ok();
        fs::remove_dir_all(archive_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[tokio::test]
    async fn switch_next_target_group_aborts_manual_full_scan_task() {
        let fallback_target_dir = unique_test_dir("fallback");
        let work_dir = unique_test_dir("work");
        let archive_dir = unique_test_dir("archive");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        fs::create_dir_all(&archive_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let settings = AppSettings {
            target_groups: vec![
                target_group("work", vec![work_dir.clone()]),
                target_group("archive", vec![archive_dir.clone()]),
            ],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        save_settings(&settings_path, &settings).unwrap();

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);
        let task_id = uuid::Uuid::new_v4();
        let scan_task = tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });
        let abort_handle = scan_task.abort_handle();

        {
            let mut slot = runtime.manual_full_scan_task.lock().unwrap();
            *slot = Some((task_id, abort_handle));
        }

        let settings = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            runtime.switch_next_target_group(),
        )
        .await
        .expect("target switch should not wait for manual full scan")
        .unwrap();

        assert_eq!(
            settings.current_target_group_id,
            Some("archive".to_string())
        );
        assert!(scan_task.await.unwrap_err().is_cancelled());
        assert!(runtime.manual_full_scan_task.lock().unwrap().is_none());

        fs::remove_dir_all(fallback_target_dir).ok();
        fs::remove_dir_all(work_dir).ok();
        fs::remove_dir_all(archive_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[tokio::test]
    async fn switch_next_target_group_errors_when_no_other_active_group_exists() {
        let fallback_target_dir = unique_test_dir("fallback");
        let work_dir = unique_test_dir("work");
        let archive_dir = unique_test_dir("archive");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        fs::create_dir_all(&archive_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        let mut archive = target_group("archive", vec![archive_dir.clone()]);
        archive.active = false;

        let settings = AppSettings {
            target_groups: vec![target_group("work", vec![work_dir.clone()]), archive],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        save_settings(&settings_path, &settings).unwrap();

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);
        let error = runtime.switch_next_target_group().await.unwrap_err();

        assert_eq!(error, "no other active target groups available");

        fs::remove_dir_all(fallback_target_dir).ok();
        fs::remove_dir_all(work_dir).ok();
        fs::remove_dir_all(archive_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[tokio::test]
    async fn warms_non_current_nested_target_group_database() {
        let fallback_target_dir = unique_test_dir("fallback");
        let parent_dir = unique_test_dir("parent");
        let nested_dir = parent_dir.join("ZZZ");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(&nested_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
        fs::write(parent_dir.join("outside.md"), "# outside_token").unwrap();
        fs::write(nested_dir.join("inside.md"), "# nested_unique_token").unwrap();

        let settings = AppSettings {
            target_groups: vec![
                target_group("parent", vec![parent_dir.clone()]),
                target_group("nested", vec![nested_dir.clone()]),
            ],
            current_target_group_id: Some("parent".to_string()),
            ..Default::default()
        };

        save_settings(&settings_path, &settings).unwrap();

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

        warm_non_current_active_target_group_indexes(
            settings.clone(),
            fallback_target_dir.clone(),
            runtime.engine.clone(),
            runtime.stats.clone(),
        )
        .await
        .unwrap();

        {
            let stats = runtime.stats.lock().unwrap();
            assert!(matches!(
                stats.startup_warm.status,
                StartupWarmStatus::Completed
            ));
            assert_eq!(stats.startup_warm.completed_groups, 1);
            assert_eq!(stats.startup_warm.total_groups, 1);
            assert!(stats.startup_warm.current_group_name.is_none());
        }

        let nested_settings = AppSettings {
            current_target_group_id: Some("nested".to_string()),
            ..settings
        };

        runtime.switch_database(&nested_settings).unwrap();

        let nested_results = runtime
            .engine
            .search(SearchRequest::new("nested_unique_token", 10))
            .await
            .unwrap();

        assert_eq!(nested_results.len(), 1);

        let outside_results = runtime
            .engine
            .search(SearchRequest::new("outside_token", 10))
            .await
            .unwrap();

        assert!(outside_results.is_empty());

        fs::remove_dir_all(fallback_target_dir).ok();
        fs::remove_dir_all(parent_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[tokio::test]
    async fn warm_non_current_active_target_group_indexes_skips_inactive_groups() {
        let fallback_target_dir = unique_test_dir("fallback");
        let work_dir = unique_test_dir("work");
        let archive_dir = unique_test_dir("archive");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&fallback_target_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        fs::create_dir_all(&archive_dir).unwrap();
        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
        fs::write(archive_dir.join("archive.md"), "# inactive_archive_token").unwrap();

        let mut archive = target_group("archive", vec![archive_dir.clone()]);
        archive.active = false;

        let settings = AppSettings {
            target_groups: vec![target_group("work", vec![work_dir.clone()]), archive],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        save_settings(&settings_path, &settings).unwrap();

        let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

        warm_non_current_active_target_group_indexes(
            settings.clone(),
            fallback_target_dir.clone(),
            runtime.engine.clone(),
            runtime.stats.clone(),
        )
        .await
        .unwrap();

        {
            let stats = runtime.stats.lock().unwrap();
            assert!(matches!(stats.startup_warm.status, StartupWarmStatus::Idle));
            assert_eq!(stats.startup_warm.total_groups, 0);
        }

        let archive_settings = AppSettings {
            current_target_group_id: Some("archive".to_string()),
            ..settings
        };

        runtime.switch_database(&archive_settings).unwrap();

        let archive_results = runtime
            .engine
            .search(SearchRequest::new("inactive_archive_token", 10))
            .await
            .unwrap();

        assert!(archive_results.is_empty());

        fs::remove_dir_all(fallback_target_dir).ok();
        fs::remove_dir_all(work_dir).ok();
        fs::remove_dir_all(archive_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn migrate_primary_glimpse_dirs_moves_directory_when_primary_path_changes() {
        let old_dir = unique_test_dir("old");
        let new_dir = unique_test_dir("new");

        fs::create_dir_all(old_dir.join(".glimpse")).unwrap();
        fs::write(old_dir.join(".glimpse").join("index.db"), "db").unwrap();

        let previous_settings = AppSettings {
            target_groups: vec![target_group("work", vec![old_dir.clone()])],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        let settings = AppSettings {
            target_groups: vec![target_group("work", vec![new_dir.clone()])],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        migrate_primary_glimpse_dirs(&previous_settings, &settings).unwrap();

        assert!(!old_dir.join(".glimpse").exists());
        assert_eq!(
            fs::read_to_string(new_dir.join(".glimpse").join("index.db")).unwrap(),
            "db"
        );

        fs::remove_dir_all(old_dir).ok();
        fs::remove_dir_all(new_dir).ok();
    }

    #[test]
    fn migrate_primary_glimpse_dirs_removes_old_directory_when_destination_exists() {
        let old_dir = unique_test_dir("old");
        let new_dir = unique_test_dir("new");

        fs::create_dir_all(old_dir.join(".glimpse")).unwrap();
        fs::create_dir_all(new_dir.join(".glimpse")).unwrap();
        fs::write(old_dir.join(".glimpse").join("old.db"), "old").unwrap();
        fs::write(new_dir.join(".glimpse").join("index.db"), "new").unwrap();

        let previous_settings = AppSettings {
            target_groups: vec![target_group("work", vec![old_dir.clone()])],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        let settings = AppSettings {
            target_groups: vec![target_group("work", vec![new_dir.clone()])],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        migrate_primary_glimpse_dirs(&previous_settings, &settings).unwrap();

        assert!(!old_dir.join(".glimpse").exists());
        assert_eq!(
            fs::read_to_string(new_dir.join(".glimpse").join("index.db")).unwrap(),
            "new"
        );

        fs::remove_dir_all(old_dir).ok();
        fs::remove_dir_all(new_dir).ok();
    }

    #[test]
    fn global_primary_target_dirs_uses_fallback_when_no_groups_exist() {
        let settings = AppSettings::default();

        let result = global_primary_target_dirs(&settings, PathBuf::from("/fallback"));

        assert_eq!(result, vec![PathBuf::from("/fallback")]);
    }

    #[test]
    fn global_primary_target_dirs_uses_first_path_from_each_group() {
        let settings = AppSettings {
            target_groups: vec![
                target_group(
                    "work",
                    vec![PathBuf::from("/work/a"), PathBuf::from("/work/b")],
                ),
                target_group("personal", vec![PathBuf::from("/personal")]),
            ],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        let result = global_primary_target_dirs(&settings, PathBuf::from("/fallback"));

        assert_eq!(
            result,
            vec![PathBuf::from("/work/a"), PathBuf::from("/personal"),]
        );
    }

    #[test]
    fn global_primary_target_dirs_skips_empty_groups() {
        let settings = AppSettings {
            target_groups: vec![
                target_group("empty", vec![]),
                target_group("work", vec![PathBuf::from("/work")]),
            ],
            ..Default::default()
        };

        let result = global_primary_target_dirs(&settings, PathBuf::from("/fallback"));

        assert_eq!(result, vec![PathBuf::from("/work")]);
    }
}
