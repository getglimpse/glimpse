//! Realtime filesystem watch implementation.
//!
//! This module keeps the search index synchronized with filesystem changes
//! after the initial full scan has completed.

use crate::models::indexing::WatchStatus;
use crate::models::settings::IndexingSettings;
use crate::search::SourceReplacement;
use crate::utils::path::{should_index_path, source_id_for_path};
use notify_debouncer_full::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use std::{
    collections::HashMap,
    path::Path,
    time::{Duration, SystemTime},
};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use super::{source_fingerprint_for_path, target_root_for_path, Indexer};

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

                        let Some((target_index, root, resolved_path)) =
                            target_root_for_path(&target_dirs, path)
                        else {
                            warn!(path = ?path, "Failed to resolve watched root");
                            continue;
                        };

                        Self::process_watch_path(
                            engine.as_ref(),
                            &group_name,
                            target_index,
                            root,
                            &resolved_path,
                            &indexing_settings,
                            &mut modified_cache,
                        )
                        .await;
                    }
                }
            }
        }))
    }

    async fn process_watch_path(
        engine: &E,
        group_name: &str,
        target_index: usize,
        root: &Path,
        path: &Path,
        indexing_settings: &IndexingSettings,
        modified_cache: &mut HashMap<String, SystemTime>,
    ) {
        let source_id = source_id_for_path(group_name, target_index, root, path);

        if !path.exists() {
            modified_cache.remove(&source_id);
            debug!(source_id = %source_id, "Removing source");
            if let Err(error) = engine.delete_by_source_id(&source_id).await {
                error!(source_id = %source_id, error = %error, "Failed to delete source");
            }
            return;
        }

        if !path.is_file() || !should_index_path(path, indexing_settings) {
            return;
        }
        let Ok(metadata) = std::fs::metadata(path) else {
            return;
        };
        let Ok(modified) = metadata.modified() else {
            return;
        };
        if modified_cache.get(&source_id) == Some(&modified) {
            return;
        }
        let fingerprint =
            match source_fingerprint_for_path(group_name, target_index, root, path, &metadata) {
                Ok(fingerprint) => fingerprint,
                Err(error) => {
                    warn!(path = ?path, error = %error, "Failed to build source fingerprint");
                    return;
                }
            };
        let items = match Self::parse_path(group_name, target_index, root, path) {
            Ok(items) => items,
            Err(error) if error.is_skippable_indexing_error() => {
                debug!(path = ?path, error = %error, "Skipped file because it is temporarily unavailable");
                return;
            }
            Err(error) => {
                warn!(path = ?path, error = %error, "Failed to parse file");
                return;
            }
        };

        debug!(source_id = %source_id, item_count = items.len(), "Reindexing source");
        let replacement = SourceReplacement::new(source_id.clone(), items, Some(fingerprint));
        match engine.replace_sources(vec![replacement]).await {
            Ok(()) => {
                modified_cache.insert(source_id, modified);
            }
            Err(error) => {
                modified_cache.remove(&source_id);
                error!(path = ?path, error = %error, "Failed to replace source");
            }
        }
    }
}

fn is_internal_glimpse_path(path: &Path) -> bool {
    path.components()
        .any(|component| component.as_os_str() == INTERNAL_GLIMPSE_DIR)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::settings::AppSettings;
    use crate::search::sqlite::SqliteEngine;
    use crate::test_utils::fixtures::create_test_db;
    use crate::test_utils::fixtures::unique_test_path;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn failed_second_item_insert_rolls_back_and_same_mtime_can_retry() {
        let dir = unique_test_path("glimpse_watch_atomic_replace_", "");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("links.gjson");
        std::fs::write(
            &path,
            r#"{"items":[{"title":"Old A","url":"https://old-a.example"},{"title":"Old B","url":"https://old-b.example"}]}"#,
        )
        .unwrap();

        let db = Arc::new(Mutex::new(create_test_db()));
        let engine = SqliteEngine::new(db.clone());
        let indexing_settings = AppSettings::default().indexing;
        let source_id = source_id_for_path("work", 0, &dir, &path);
        let mut cache = HashMap::new();
        Indexer::<SqliteEngine>::process_watch_path(
            &engine,
            "work",
            0,
            &dir,
            &path,
            &indexing_settings,
            &mut cache,
        )
        .await;
        let old_size = fingerprint_size(&db, &source_id);

        std::fs::write(
            &path,
            r#"{"items":[{"title":"New A with more text","url":"https://new-a.example"},{"title":"New B with more text","url":"https://new-b.example"}]}"#,
        )
        .unwrap();
        // A newly started watcher has no mtime cache even for existing index data.
        cache.clear();
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        let new_size = std::fs::metadata(&path).unwrap().len() as i64;
        assert_ne!(old_size, new_size);
        db.lock()
            .unwrap()
            .execute_batch(
                "CREATE TEMP TRIGGER fail_second_item BEFORE INSERT ON items \
                 WHEN NEW.id LIKE '%::1' BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END;",
            )
            .unwrap();

        Indexer::<SqliteEngine>::process_watch_path(
            &engine,
            "work",
            0,
            &dir,
            &path,
            &indexing_settings,
            &mut cache,
        )
        .await;
        assert!(!cache.contains_key(&source_id));
        assert_eq!(titles(&db), vec!["Old A", "Old B"]);
        assert_eq!(fingerprint_size(&db, &source_id), old_size);

        db.lock()
            .unwrap()
            .execute_batch("DROP TRIGGER fail_second_item")
            .unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().modified().unwrap(),
            modified
        );
        Indexer::<SqliteEngine>::process_watch_path(
            &engine,
            "work",
            0,
            &dir,
            &path,
            &indexing_settings,
            &mut cache,
        )
        .await;
        assert_eq!(cache.get(&source_id), Some(&modified));
        assert_eq!(fingerprint_size(&db, &source_id), new_size);
        assert_eq!(
            titles(&db),
            vec!["New A with more text", "New B with more text"]
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn titles(db: &Arc<Mutex<rusqlite::Connection>>) -> Vec<String> {
        let db = db.lock().unwrap();
        let mut statement = db.prepare("SELECT title FROM items ORDER BY id").unwrap();
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn fingerprint_size(db: &Arc<Mutex<rusqlite::Connection>>, source_id: &str) -> i64 {
        db.lock()
            .unwrap()
            .query_row(
                "SELECT size_bytes FROM source_fingerprints WHERE source_id = ?1",
                [source_id],
                |row| row.get(0),
            )
            .unwrap()
    }
}
