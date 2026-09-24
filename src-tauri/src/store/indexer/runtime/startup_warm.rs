//! Background warm-up of non-current target group indexes.

use super::*;

pub(super) async fn warm_non_current_active_target_group_indexes(
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

pub(super) fn set_startup_warm_aborted(stats: &Arc<Mutex<IndexingStats>>, reason: &'static str) {
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

pub(super) fn set_startup_warm_error(stats: &Arc<Mutex<IndexingStats>>, error: String) {
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
