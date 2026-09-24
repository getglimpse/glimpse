//! Rebuild, scan, watcher, and database transitions.

use super::*;

impl IndexerRuntime {
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
    pub(super) async fn rebuild(&self, settings: AppSettings) -> Result<(), String> {
        let _foreground_guard = self.foreground_index_work.lock().await;

        self.rebuild_with_foreground_lock(settings).await
    }

    pub(super) async fn rebuild_with_foreground_lock(
        &self,
        settings: AppSettings,
    ) -> Result<(), String> {
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

    pub(super) async fn rebuild_current_index(
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

    pub(super) async fn run_manual_full_scan_task(
        &self,
        task_id: uuid::Uuid,
    ) -> Result<(), String> {
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

    pub(super) async fn complete_manual_full_scan(
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

    pub(super) async fn prepare_indexer_for_full_scan(
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

    pub(super) fn current_indexer(&self, settings: AppSettings) -> Indexer<ActiveSearchEngine> {
        Indexer::new_with_stats(
            self.engine.clone(),
            self.fallback_target_dir.clone(),
            settings,
            self.stats.clone(),
        )
    }

    pub(super) async fn switch_current_group_runtime(
        &self,
        settings: AppSettings,
    ) -> Result<(), String> {
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
    pub(super) fn switch_database(&self, settings: &AppSettings) -> Result<(), String> {
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
    pub(super) fn recover_current_database(&self, settings: &AppSettings) -> Result<(), String> {
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
    pub(super) fn stop_watch(&self) {
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
    pub(super) fn detach_current_database(&self) -> Result<(), String> {
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
}
