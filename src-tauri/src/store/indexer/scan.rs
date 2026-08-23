//! Full scan and single-path indexing implementation.
//!
//! This module implements filesystem scanning for [`Indexer`].

use super::{source_fingerprint_for_path, Indexer};
use crate::search::{SearchError, SourceReplacement};
use crate::utils::path::{should_index_path, source_id_for_path};
use chrono::Utc;
use std::fs;
use std::path::Path;
use tracing::{debug, error, info, warn};
use walkdir::WalkDir;

impl<E> Indexer<E>
where
    E: crate::search::SearchEngine + 'static,
{
    pub async fn full_scan(&self) -> Result<usize, SearchError> {
        let mut count = 0;
        let mut reindexed_count = 0;
        let mut skipped_source_count = 0;
        let mut skipped_item_count = 0;
        let mut replacements = Vec::new();

        info!(
            target_dir_count = self.target_dirs.len(),
            "full scan started"
        );

        let group_name = self.settings.current_target_group_name();
        let indexing_settings = self.settings.indexing.clone();

        for (target_index, target_dir) in self.target_dirs.iter().enumerate() {
            debug!(
                target_dir = %target_dir.display(),
                target_index,
                group_name = %group_name,
                "scanning target directory"
            );

            let walker = WalkDir::new(target_dir)
                .follow_links(false)
                .into_iter()
                .filter_entry(|e| should_index_path(e.path(), &indexing_settings));

            for entry in walker.filter_map(|e| match e {
                Ok(entry) => Some(entry),
                Err(error) => {
                    warn!(
                        error = %error,
                        "failed to read directory entry during full scan"
                    );
                    None
                }
            }) {
                let path = entry.path();

                if !path.is_file() {
                    continue;
                }

                if !should_index_path(path, &self.settings.indexing) {
                    debug!(
                        path = %path.display(),
                        "path skipped by indexing settings"
                    );
                    continue;
                }

                let fingerprint = match self.source_fingerprint_for_scan(
                    &group_name,
                    target_index,
                    target_dir,
                    path,
                ) {
                    Ok(fingerprint) => fingerprint,
                    Err(error) if error.is_skippable_indexing_error() => {
                        debug!(
                            path = %path.display(),
                            error = %error,
                            "path skipped during freshness check because file is temporarily unavailable"
                        );

                        continue;
                    }
                    Err(error) => {
                        let source_id =
                            source_id_for_path(&group_name, target_index, target_dir, path);

                        warn!(
                            path = %path.display(),
                            error = %error,
                            "failed to read source fingerprint; parsing path"
                        );

                        match Self::parse_path(&group_name, target_index, target_dir, path) {
                            Ok(items) => {
                                let item_count = items.len();

                                debug!(
                                    path = %path.display(),
                                    item_count,
                                    "path parsed during full scan"
                                );

                                replacements.push(SourceReplacement::new(source_id, items, None));

                                if replacements.len() >= 32 {
                                    let batch_len = self
                                        .flush_full_scan_replacements(&mut replacements, path)
                                        .await;
                                    count += batch_len;
                                    reindexed_count += batch_len;
                                }
                            }
                            Err(error) if error.is_skippable_indexing_error() => {
                                debug!(
                                    path = %path.display(),
                                    error = %error,
                                    "path skipped during full scan because file is temporarily unavailable"
                                );
                            }
                            Err(error) => {
                                warn!(
                                    path = %path.display(),
                                    error = %error,
                                    "failed to parse path during full scan"
                                );
                            }
                        }

                        continue;
                    }
                };

                match self
                    .engine
                    .unchanged_source_item_count(fingerprint.clone())
                    .await
                {
                    Ok(Some(item_count)) => {
                        count += item_count;
                        skipped_source_count += 1;
                        skipped_item_count += item_count;

                        debug!(
                            path = %path.display(),
                            item_count,
                            "path skipped during full scan because source is unchanged"
                        );

                        continue;
                    }
                    Ok(None) => {}
                    Err(error) if error.is_skippable_indexing_error() => {
                        debug!(
                            path = %path.display(),
                            error = %error,
                            "path skipped during freshness check because file is temporarily unavailable"
                        );

                        continue;
                    }
                    Err(error) => {
                        warn!(
                            path = %path.display(),
                            error = %error,
                            "failed to check source freshness; parsing path"
                        );
                    }
                }

                match Self::parse_path(&group_name, target_index, target_dir, path) {
                    Ok(items) => {
                        let item_count = items.len();

                        debug!(
                            path = %path.display(),
                            item_count,
                            "path parsed during full scan"
                        );

                        let source_id = fingerprint.source_id.clone();

                        replacements.push(SourceReplacement::new(
                            source_id,
                            items,
                            Some(fingerprint),
                        ));

                        if replacements.len() >= 32 {
                            let batch_len = self
                                .flush_full_scan_replacements(&mut replacements, path)
                                .await;
                            count += batch_len;
                            reindexed_count += batch_len;
                        }
                    }

                    Err(error) if error.is_skippable_indexing_error() => {
                        debug!(
                            path = %path.display(),
                            error = %error,
                            "path skipped during full scan because file is temporarily unavailable"
                        );
                    }

                    Err(error) => {
                        warn!(
                            path = %path.display(),
                            error = %error,
                            "failed to parse path during full scan"
                        );
                    }
                }
            }
        }

        let batch_len = self
            .flush_full_scan_replacements(&mut replacements, Path::new("<final>"))
            .await;
        count += batch_len;
        reindexed_count += batch_len;

        info!(
            indexed_items = count,
            reindexed_items = reindexed_count,
            skipped_sources = skipped_source_count,
            skipped_items = skipped_item_count,
            target_dir_count = self.target_dirs.len(),
            "full scan completed"
        );

        if let Ok(mut stats) = self.stats.lock() {
            stats.indexed_items = count;
            stats.last_scan_at = Some(Utc::now());

            debug!(
                indexed_items = stats.indexed_items,
                last_scan_at = ?stats.last_scan_at,
                "indexing stats updated after full scan"
            );
        } else {
            warn!("failed to lock indexing stats after full scan");
        }

        Ok(count)
    }

    fn source_fingerprint_for_scan(
        &self,
        group_name: &str,
        target_index: usize,
        target_dir: &Path,
        path: &Path,
    ) -> Result<crate::search::SourceFingerprint, SearchError> {
        let metadata = fs::metadata(path).map_err(SearchError::IoError)?;

        source_fingerprint_for_path(group_name, target_index, target_dir, path, &metadata)
    }

    async fn flush_full_scan_replacements(
        &self,
        replacements: &mut Vec<SourceReplacement>,
        path: &Path,
    ) -> usize {
        if replacements.is_empty() {
            return 0;
        }

        let source_count = replacements.len();
        let item_count = replacements
            .iter()
            .map(SourceReplacement::item_count)
            .sum::<usize>();

        match self
            .engine
            .replace_sources(std::mem::take(replacements))
            .await
        {
            Ok(()) => {
                debug!(
                    path = %path.display(),
                    source_count,
                    item_count,
                    "sources replaced during full scan"
                );

                item_count
            }
            Err(error) => {
                warn!(
                    path = %path.display(),
                    source_count,
                    error = %error,
                    "failed to replace sources during full scan"
                );

                0
            }
        }
    }

    pub async fn index_path(&self, path: &Path) -> Result<usize, SearchError> {
        debug!(
            path = %path.display(),
            "indexing path"
        );

        if !path.exists() {
            debug!(
                path = %path.display(),
                "index path skipped because it does not exist"
            );
            return Ok(0);
        }

        if !path.is_file() {
            debug!(
                path = %path.display(),
                "index path skipped because it is not a file"
            );
            return Ok(0);
        }

        if !should_index_path(path, &self.settings.indexing) {
            debug!(
                path = %path.display(),
                "index path skipped by indexing settings"
            );
            return Ok(0);
        }

        let Some((target_index, target_dir)) = self
            .target_dirs
            .iter()
            .enumerate()
            .find(|(_, target_dir)| path.starts_with(target_dir))
        else {
            warn!(
                path = %path.display(),
                "failed to resolve target dir for path"
            );
            return Ok(0);
        };

        let group_name = self.settings.current_target_group_name();

        let fingerprint = fs::metadata(path)
            .map_err(SearchError::IoError)
            .and_then(|metadata| {
                source_fingerprint_for_path(&group_name, target_index, target_dir, path, &metadata)
            });

        let items = match Self::parse_path(&group_name, target_index, target_dir, path) {
            Ok(items) => {
                debug!(
                    path = %path.display(),
                    item_count = items.len(),
                    "path parsed"
                );

                items
            }
            Err(error) if error.is_skippable_indexing_error() => {
                debug!(
                    path = %path.display(),
                    error = %error,
                    "path skipped because file is temporarily unavailable"
                );

                return Ok(0);
            }
            Err(error) => {
                warn!(
                    path = %path.display(),
                    error = %error,
                    "failed to parse path"
                );
                return Ok(0);
            }
        };

        let expected_count = items.len();
        let mut count = 0;

        for item in items {
            if let Err(error) = self.engine.upsert(item).await {
                error!(
                    path = %path.display(),
                    error = %error,
                    "failed to upsert indexed item"
                );
                continue;
            }

            count += 1;
        }

        if count == expected_count {
            if let Ok(fingerprint) = fingerprint {
                if let Err(error) = self
                    .engine
                    .upsert_source_fingerprint(fingerprint, count)
                    .await
                {
                    warn!(
                        path = %path.display(),
                        error = %error,
                        "failed to record source fingerprint after path indexing"
                    );
                }
            }
        }

        if let Ok(mut stats) = self.stats.lock() {
            stats.indexed_items += count;
            stats.last_scan_at = Some(Utc::now());

            debug!(
                indexed_items = stats.indexed_items,
                added_items = count,
                last_scan_at = ?stats.last_scan_at,
                "indexing stats updated after path indexing"
            );
        } else {
            warn!("failed to lock indexing stats after path indexing");
        }

        debug!(
            path = %path.display(),
            indexed_items = count,
            "path indexing completed"
        );

        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    use async_trait::async_trait;

    use crate::models::settings::{AppSettings, TargetGroup};
    use crate::models::IndexItem;
    use crate::search::{SearchEngine, SearchRequest, SearchResult, SourceFingerprint};
    use crate::store::indexer::canonical_source_path;

    #[derive(Default)]
    struct RecordingEngine {
        items: Mutex<Vec<IndexItem>>,
        fingerprints: Mutex<Vec<(SourceFingerprint, usize)>>,
        upsert_batch_calls: Mutex<usize>,
    }

    #[async_trait]
    impl SearchEngine for RecordingEngine {
        async fn init(&self) -> Result<(), SearchError> {
            Ok(())
        }

        async fn search(&self, _req: SearchRequest) -> Result<Vec<SearchResult>, SearchError> {
            Ok(Vec::new())
        }

        async fn upsert(&self, item: IndexItem) -> Result<(), SearchError> {
            self.upsert_batch(vec![item]).await
        }

        async fn upsert_batch(&self, items: Vec<IndexItem>) -> Result<(), SearchError> {
            *self.upsert_batch_calls.lock().unwrap() += 1;

            let mut stored_items = self.items.lock().unwrap();

            for item in items {
                stored_items.retain(|stored_item| stored_item.id != item.id);
                stored_items.push(item);
            }

            Ok(())
        }

        async fn delete(&self, _id: &str) -> Result<(), SearchError> {
            Ok(())
        }

        async fn delete_by_source_id(&self, source_id: &str) -> Result<(), SearchError> {
            let pattern = format!("{source_id}::");
            let mut stored_items = self.items.lock().unwrap();

            stored_items.retain(|item| item.id != source_id && !item.id.starts_with(&pattern));

            Ok(())
        }

        async fn delete_by_source_path(&self, _source_path: &str) -> Result<(), SearchError> {
            Ok(())
        }

        async fn list_source_paths(&self) -> Result<Vec<String>, SearchError> {
            Ok(Vec::new())
        }

        async fn unchanged_source_item_count(
            &self,
            fingerprint: SourceFingerprint,
        ) -> Result<Option<usize>, SearchError> {
            let fingerprints = self.fingerprints.lock().unwrap();
            let Some((_, item_count)) = fingerprints.iter().find(|(stored, _)| {
                stored.source_path == fingerprint.source_path
                    && stored.source_id == fingerprint.source_id
                    && stored.modified_at == fingerprint.modified_at
                    && stored.size_bytes == fingerprint.size_bytes
                    && stored.content_hash == fingerprint.content_hash
            }) else {
                return Ok(None);
            };

            let stored_items = self.items.lock().unwrap();
            let matching_items = stored_items
                .iter()
                .filter(|item| {
                    item.source_path.as_deref() == Some(fingerprint.source_path.as_str())
                })
                .collect::<Vec<_>>();

            if matching_items.len() == *item_count {
                Ok(Some(*item_count))
            } else {
                Ok(None)
            }
        }

        async fn upsert_source_fingerprint(
            &self,
            fingerprint: SourceFingerprint,
            item_count: usize,
        ) -> Result<(), SearchError> {
            let mut fingerprints = self.fingerprints.lock().unwrap();
            fingerprints.retain(|(stored, _)| stored.source_path != fingerprint.source_path);
            fingerprints.push((fingerprint, item_count));

            Ok(())
        }
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("glimpse_scan_test_{unique}_{name}"))
    }

    fn target_group(id: &str, path: &Path) -> TargetGroup {
        TargetGroup {
            id: id.to_string(),
            name: id.to_string(),
            paths: vec![path.to_string_lossy().to_string()],
            active: true,
        }
    }

    #[tokio::test]
    async fn full_scan_skips_unchanged_sources() {
        let target_dir = unique_test_dir("target");
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(target_dir.join("note.md"), "# Stable\n\nunchanged_token").unwrap();

        let settings = AppSettings {
            target_groups: vec![target_group("work", &target_dir)],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };
        let engine = Arc::new(RecordingEngine::default());
        let indexer = Indexer::new(engine.clone(), target_dir.clone(), settings);

        let first_count = indexer.full_scan().await.unwrap();
        let second_count = indexer.full_scan().await.unwrap();

        assert_eq!(first_count, 1);
        assert_eq!(second_count, 1);
        assert_eq!(*engine.upsert_batch_calls.lock().unwrap(), 1);
        assert_eq!(indexer.stats.lock().unwrap().indexed_items, 1);

        fs::remove_dir_all(target_dir).ok();
    }

    #[tokio::test]
    async fn full_scan_replaces_changed_json_source_items() {
        let target_dir = unique_test_dir("target");
        fs::create_dir_all(&target_dir).unwrap();
        let source_path = target_dir.join("links.gjson");
        fs::write(
            &source_path,
            r#"{
  "items": [
    { "title": "Rust", "url": "https://www.rust-lang.org" },
    { "title": "Tauri", "url": "https://tauri.app" }
  ]
}
"#,
        )
        .unwrap();

        let settings = AppSettings {
            target_groups: vec![target_group("work", &target_dir)],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };
        let engine = Arc::new(RecordingEngine::default());
        let indexer = Indexer::new(engine.clone(), target_dir.clone(), settings);

        let first_count = indexer.full_scan().await.unwrap();

        fs::write(
            &source_path,
            r#"{
  "items": [
    { "title": "Rust", "url": "https://www.rust-lang.org" }
  ]
}
"#,
        )
        .unwrap();

        let second_count = indexer.full_scan().await.unwrap();
        let source_id = source_id_for_path("work", 0, &target_dir, &source_path);
        let stored_ids = engine
            .items
            .lock()
            .unwrap()
            .iter()
            .map(|item| item.id.clone())
            .collect::<Vec<_>>();

        assert_eq!(first_count, 2);
        assert_eq!(second_count, 1);
        assert_eq!(stored_ids, vec![format!("{source_id}::0")]);
        assert_eq!(*engine.upsert_batch_calls.lock().unwrap(), 2);

        fs::remove_dir_all(target_dir).ok();
    }

    #[test]
    fn canonical_source_path_matches_parser_source_path_format() {
        let target_dir = unique_test_dir("target");
        fs::create_dir_all(&target_dir).unwrap();
        let path = target_dir.join("note.md");
        fs::write(&path, "# Stable").unwrap();

        let expected = fs::canonicalize(&path)
            .unwrap()
            .to_string_lossy()
            .to_string();

        assert_eq!(canonical_source_path(&path), expected);

        fs::remove_dir_all(target_dir).ok();
    }
}
