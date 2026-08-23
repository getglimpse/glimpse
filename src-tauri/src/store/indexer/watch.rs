//! Realtime filesystem watch implementation.
//!
//! This module keeps the search index synchronized with filesystem changes
//! after the initial full scan has completed.

use crate::models::indexing::WatchStatus;
use crate::utils::path::{should_index_path, source_id_for_path};
use notify_debouncer_full::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use super::{source_fingerprint_for_path, Indexer};

const INTERNAL_GLIMPSE_DIR: &str = ".glimpse";

impl<E> Indexer<E>
where
    E: crate::search::SearchEngine + 'static,
{
    pub fn start_watch(&self) -> Option<tokio::task::JoinHandle<()>> {
        let (tx, mut rx) = mpsc::channel(100);

        let engine = self.engine.clone();
        let target_dirs = self.target_dirs.clone();
        let indexing_settings = self.settings.indexing.clone();
        let stats = self.stats.clone();
        let group_name = self.settings.current_target_group_name();

        info!(targets = ?target_dirs, "Starting filesystem watcher");

        if target_dirs.is_empty() {
            if let Ok(mut stats) = stats.lock() {
                stats.watch_status = WatchStatus::Stopped;
            }

            info!("filesystem watcher skipped because no target directories are configured");
            return None;
        }

        let mut debouncer = match new_debouncer(
            Duration::from_millis(200),
            None,
            move |res: DebounceEventResult| match res {
                Ok(events) => {
                    if let Err(error) = tx.blocking_send(events) {
                        warn!(
                            error = %error,
                            "failed to send filesystem watch events"
                        );
                    }
                }
                Err(errors) => {
                    warn!(
                        count = errors.len(),
                        errors = ?errors,
                        "filesystem watcher debounce error"
                    );
                }
            },
        ) {
            Ok(debouncer) => debouncer,
            Err(e) => {
                error!(error = %e, "Failed to initialize filesystem watcher");

                if let Ok(mut stats) = stats.lock() {
                    stats.watch_status = WatchStatus::Error;
                }

                return None;
            }
        };

        let mut watched_count = 0;

        for target_dir in &target_dirs {
            match debouncer.watch(target_dir, RecursiveMode::Recursive) {
                Ok(_) => {
                    watched_count += 1;
                    info!(path = ?target_dir, "Watching directory");
                }
                Err(e) => {
                    warn!(path = ?target_dir, error = %e, "Failed to watch directory");
                }
            }
        }

        if let Ok(mut stats) = stats.lock() {
            stats.watch_status = if watched_count > 0 {
                WatchStatus::Active
            } else {
                WatchStatus::Error
            };
        }

        info!(watched_count = watched_count, "Filesystem watcher started");

        if watched_count == 0 {
            return None;
        }

        Some(tokio::spawn(async move {
            let _keep_debouncer_alive = debouncer;

            let mut modified_cache: HashMap<String, SystemTime> = HashMap::new();

            while let Some(events) = rx.recv().await {
                for event in events {
                    for path in &event.event.paths {
                        if is_internal_glimpse_path(path) {
                            continue;
                        }

                        let Some((target_index, root)) = watched_root_for_path(&target_dirs, path)
                        else {
                            warn!(path = ?path, "Failed to resolve watched root");
                            continue;
                        };

                        let source_id = source_id_for_path(&group_name, target_index, root, path);

                        if path.exists() {
                            if !path.is_file() || !should_index_path(path, &indexing_settings) {
                                continue;
                            }

                            let Ok(metadata) = std::fs::metadata(path) else {
                                continue;
                            };

                            let Ok(modified) = metadata.modified() else {
                                continue;
                            };

                            let fingerprint = match source_fingerprint_for_path(
                                &group_name,
                                target_index,
                                root,
                                path,
                                &metadata,
                            ) {
                                Ok(fingerprint) => fingerprint,
                                Err(error) => {
                                    warn!(
                                        path = ?path,
                                        error = %error,
                                        "Failed to build source fingerprint"
                                    );
                                    continue;
                                }
                            };

                            if let Some(previous) = modified_cache.get(&source_id) {
                                if *previous == modified {
                                    continue;
                                }
                            }

                            modified_cache.insert(source_id.clone(), modified);

                            match Self::parse_path(&group_name, target_index, root, path) {
                                Ok(items) => {
                                    let expected_count = items.len();
                                    debug!(source_id = %source_id, "Reindexing source");

                                    if let Err(e) = engine.delete_by_source_id(&source_id).await {
                                        error!( source_id = %source_id, error = %e, "Failed to clear source");
                                    }

                                    let mut indexed_count = 0;

                                    for item in items {
                                        if let Err(e) = engine.upsert(item).await {
                                            error!(path = ?path, error = %e, "Failed to upsert item");
                                            continue;
                                        }

                                        indexed_count += 1;
                                    }

                                    if indexed_count == expected_count {
                                        if let Err(e) = engine
                                            .upsert_source_fingerprint(fingerprint, indexed_count)
                                            .await
                                        {
                                            error!(
                                                path = ?path,
                                                error = %e,
                                                "Failed to record source fingerprint"
                                            );
                                        }
                                    }
                                }
                                Err(e) if e.is_skippable_indexing_error() => {
                                    debug!(
                                        path = ?path,
                                        error = %e,
                                        "Skipped file because it is temporarily unavailable"
                                    );
                                }
                                Err(e) => {
                                    warn!(path = ?path, error = %e, "Failed to parse file");
                                }
                            }
                        } else {
                            modified_cache.remove(&source_id);

                            debug!(source_id = %source_id, "Removing source");

                            if let Err(e) = engine.delete_by_source_id(&source_id).await {
                                error!(source_id = %source_id, error = %e, "Failed to delete source");
                            }
                        }
                    }
                }
            }
        }))
    }
}

fn watched_root_for_path<'a>(target_dirs: &'a [PathBuf], path: &Path) -> Option<(usize, &'a Path)> {
    let canonical_path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    target_dirs
        .iter()
        .enumerate()
        .find(|(_, root)| canonical_path.starts_with(root))
        .map(|(index, root)| (index, root.as_path()))
}

fn is_internal_glimpse_path(path: &Path) -> bool {
    path.components()
        .any(|component| component.as_os_str() == INTERNAL_GLIMPSE_DIR)
}
