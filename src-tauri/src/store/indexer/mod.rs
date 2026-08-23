//! Filesystem indexing subsystem.
//!
//! This module converts filesystem content into searchable [`IndexItem`]s.
//!
//! Responsibilities:
//!
//! - Resolve current target directories.
//! - Perform recursive full scans.
//! - Watch filesystem changes in realtime.
//! - Dispatch files to specialized parsers.
//! - Push parsed items into the search engine.
//! - Clean up deleted source files.
//!
//! Module structure:
//!
//! ```text
//! runtime
//!   └─ long-lived runtime management
//!
//! scan
//!   └─ recursive filesystem scan
//!
//! watch
//!   └─ realtime filesystem updates
//!
//! parser_dispatch
//!   └─ extension → parser routing
//! ```
//!
//! Architecture:
//!
//! ```text
//! filesystem
//!      ↓
//! parser_dispatch
//!      ↓
//! parser
//!      ↓
//! IndexItem
//!      ↓
//! SearchEngine
//! ```
//!
//! The indexer itself is search-engine agnostic and operates on the
//! [`SearchEngine`] trait.
//!
//! Current backend:
//!
//! - SQLite FTS5
//!
//! Future backends:
//!
//! - Tantivy

mod parser_dispatch;
pub mod runtime;
mod scan;
mod watch;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::models::indexing::{IndexingStats, WatchStatus};
use crate::models::settings::{AppSettings, TargetGroup};
use crate::search::{SearchEngine, SearchError, SourceFingerprint};
use crate::utils::path::source_id_for_path;

/// Filesystem indexer.
///
/// [`Indexer`] is the core component responsible for transforming files on
/// disk into searchable records.
///
/// Responsibilities:
///
/// - filesystem traversal
/// - realtime watching
/// - parser dispatch
/// - indexing into the search backend
///
/// Supported sources:
///
/// - Markdown (`.md`)
/// - JSON index files (`.json`)
/// - Images
/// - Generic raw files
///
/// The indexer does not own long-lived lifecycle management.
///
/// Runtime concerns such as:
///
/// - startup
/// - rebuilds
/// - target group switching
/// - watcher restart
///
/// are implemented in [`runtime`].
pub struct Indexer<E: SearchEngine> {
    /// Search engine backend.
    ///
    /// The indexer interacts only through the [`SearchEngine`] trait.
    ///
    /// Current implementation:
    ///
    /// - SQLite FTS5
    ///
    /// Future implementations:
    ///
    /// - Tantivy
    pub(crate) engine: Arc<E>,

    /// Current target directories.
    ///
    /// Files under these directories are scanned and watched.
    ///
    /// Resolved from:
    ///
    /// - current target group
    /// - fallback workspace
    pub(crate) target_dirs: Vec<PathBuf>,

    /// Application settings snapshot.
    ///
    /// Used for:
    ///
    /// - indexing filters
    /// - ignore patterns
    /// - hidden file handling
    pub settings: AppSettings,

    /// Shared indexing statistics.
    ///
    /// Updated by:
    ///
    /// - full scan
    /// - incremental indexing
    /// - filesystem watcher
    pub stats: Arc<Mutex<IndexingStats>>,
}

impl<E> Indexer<E>
where
    E: SearchEngine + 'static,
{
    /// Creates a new indexer with its own statistics object.
    ///
    /// The fallback target directory is used only when no target groups are
    /// configured. A current Target Group with no paths has no search targets.
    pub fn new(engine: Arc<E>, target_dir: PathBuf, settings: AppSettings) -> Self {
        let stats = Arc::new(Mutex::new(IndexingStats {
            indexed_items: 0,
            watch_status: WatchStatus::Stopped,
            last_scan_at: None,
            startup_warm: Default::default(),
            global_search_load: Default::default(),
        }));

        Self::new_with_stats(engine, target_dir, settings, stats)
    }

    /// Removes index entries whose source files are no longer valid.
    ///
    /// Steps:
    ///
    /// 1. Query all indexed source paths.
    /// 2. Check filesystem existence and current target membership.
    /// 3. Remove stale entries from the search engine.
    ///
    /// Returns the number of deleted index entries.
    ///
    /// This is commonly used:
    ///
    /// - during startup
    /// - after target group changes
    /// - after external filesystem cleanup
    pub async fn cleanup_missing_source_paths(&self) -> Result<usize, SearchError> {
        let source_paths = self.engine.list_source_paths().await?;

        let mut deleted_count = 0;

        for source_path in source_paths {
            let path = PathBuf::from(&source_path);

            if path.exists() && path_is_in_target_dirs(&path, &self.target_dirs) {
                continue;
            }

            self.engine.delete_by_source_path(&source_path).await?;

            deleted_count += 1;
        }

        Ok(deleted_count)
    }

    /// Removes current target entries before rebuilding them from disk.
    ///
    /// This prevents duplicates when the target root changes from a nested
    /// path to its parent, for example `A/B` to `A`. In that case, the same
    /// file still exists and remains inside the new target root, but its
    /// source ID changes because the relative path changes.
    pub async fn cleanup_current_target_source_paths(&self) -> Result<usize, SearchError> {
        let source_paths = self.engine.list_source_paths().await?;

        let mut deleted_count = 0;

        for source_path in source_paths {
            let path = PathBuf::from(&source_path);

            if !path_is_in_target_dirs(&path, &self.target_dirs) {
                continue;
            }

            self.engine.delete_by_source_path(&source_path).await?;

            deleted_count += 1;
        }

        Ok(deleted_count)
    }

    /// Creates an indexer using externally managed statistics.
    ///
    /// This is mainly used by [`runtime::IndexerRuntime`] so statistics can
    /// survive runtime rebuilds.
    pub fn new_with_stats(
        engine: Arc<E>,
        target_dir: PathBuf,
        settings: AppSettings,
        stats: Arc<Mutex<IndexingStats>>,
    ) -> Self {
        let target_dirs = resolve_target_dirs(&settings, target_dir.clone());

        Self {
            engine,
            target_dirs,
            settings,
            stats,
        }
    }
}

/// Resolves the directories currently indexed by Glimpse.
///
/// Resolution order:
///
/// 1. Current target group paths.
/// 2. Fallback workspace when no Target Group exists.
///
/// Empty path entries are ignored.
fn resolve_target_dirs(settings: &AppSettings, fallback: PathBuf) -> Vec<PathBuf> {
    let Some(group) = current_target_group(settings) else {
        return vec![canonical_or_original(fallback)];
    };

    let paths = group
        .paths
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .map(canonical_or_original)
        .collect::<Vec<_>>();

    paths
}

fn canonical_or_original(path: PathBuf) -> PathBuf {
    std::fs::canonicalize(&path).unwrap_or(path)
}

pub(crate) fn canonical_source_path(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

pub(crate) fn source_fingerprint_for_path(
    group_name: &str,
    target_index: usize,
    root: &Path,
    path: &Path,
    metadata: &fs::Metadata,
) -> Result<SourceFingerprint, SearchError> {
    let modified_at = metadata.modified().map_err(SearchError::IoError)?.into();
    let source_path = canonical_source_path(path);
    let source_id = source_id_for_path(group_name, target_index, root, path);

    Ok(SourceFingerprint::new(
        source_path,
        source_id,
        modified_at,
        metadata.len(),
    ))
}

fn path_is_in_target_dirs(path: &Path, target_dirs: &[PathBuf]) -> bool {
    let path = canonical_or_original(path.to_path_buf());

    target_dirs
        .iter()
        .any(|target_dir| path.starts_with(target_dir))
}

/// Returns the current target group.
///
/// Returns `None` when:
///
/// - no current group is configured
/// - the configured group no longer exists
fn current_target_group(settings: &AppSettings) -> Option<&TargetGroup> {
    let current_id = settings.current_target_group_id.as_deref()?;

    settings
        .target_groups
        .iter()
        .find(|group| group.id == current_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    use chrono::Utc;

    use crate::models::{IndexItem, Preview};
    use crate::search::sqlite::SqliteEngine;
    use crate::test_utils::fixtures::create_test_db;

    fn group(id: &str, paths: Vec<&str>) -> TargetGroup {
        TargetGroup {
            id: id.to_string(),
            name: id.to_string(),
            paths: paths.into_iter().map(String::from).collect(),
            active: true,
        }
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("glimpse_indexer_test_{unique}_{name}"))
    }

    #[tokio::test]
    async fn cleanup_missing_source_paths_deletes_missing_items() {
        let conn = create_test_db();
        let engine = Arc::new(SqliteEngine::new(Arc::new(Mutex::new(conn))));

        let missing_path = std::env::temp_dir().join("glimpse-missing-test.md");
        let source_id = "Default/0/glimpse-missing-test.md".to_string();

        let item = IndexItem::new(
            source_id,
            "Missing File",
            Utc::now(),
            Preview::Markdown {
                content: "missing".to_string(),
            },
        )
        .with_source_path(missing_path.to_string_lossy().to_string());

        engine.upsert(item).await.unwrap();

        let indexer = Indexer::new(engine.clone(), std::env::temp_dir(), AppSettings::default());

        let deleted_count = indexer.cleanup_missing_source_paths().await.unwrap();

        assert_eq!(deleted_count, 1);

        let results = engine
            .search(crate::search::SearchRequest::new("missing", 10))
            .await
            .unwrap();

        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn cleanup_missing_source_paths_deletes_items_outside_current_targets() {
        let conn = create_test_db();
        let engine = Arc::new(SqliteEngine::new(Arc::new(Mutex::new(conn))));
        let old_dir = unique_test_dir("old");
        let new_dir = unique_test_dir("new");

        fs::create_dir_all(&old_dir).unwrap();
        fs::create_dir_all(&new_dir).unwrap();

        let old_path = old_dir.join("note.md");
        fs::write(&old_path, "# old").unwrap();

        let item = IndexItem::new(
            "Default/0/note.md".to_string(),
            "Old Target File",
            Utc::now(),
            Preview::Markdown {
                content: "old target".to_string(),
            },
        )
        .with_source_path(old_path.to_string_lossy().to_string());

        engine.upsert(item).await.unwrap();

        let indexer = Indexer::new(engine.clone(), new_dir.clone(), AppSettings::default());

        let deleted_count = indexer.cleanup_missing_source_paths().await.unwrap();

        assert_eq!(deleted_count, 1);

        let results = engine
            .search(crate::search::SearchRequest::new("old target", 10))
            .await
            .unwrap();

        assert!(results.is_empty());

        fs::remove_dir_all(old_dir).ok();
        fs::remove_dir_all(new_dir).ok();
    }

    #[tokio::test]
    async fn cleanup_current_target_source_paths_deletes_items_inside_current_targets() {
        let conn = create_test_db();
        let engine = Arc::new(SqliteEngine::new(Arc::new(Mutex::new(conn))));
        let target_dir = unique_test_dir("target");

        fs::create_dir_all(&target_dir).unwrap();

        let path = target_dir.join("note.md");
        fs::write(&path, "# note").unwrap();

        let item = IndexItem::new(
            "Default/0/note.md".to_string(),
            "Current Target File",
            Utc::now(),
            Preview::Markdown {
                content: "current target".to_string(),
            },
        )
        .with_source_path(path.to_string_lossy().to_string());

        engine.upsert(item).await.unwrap();

        let indexer = Indexer::new(engine.clone(), target_dir.clone(), AppSettings::default());

        let deleted_count = indexer.cleanup_current_target_source_paths().await.unwrap();

        assert_eq!(deleted_count, 1);

        let results = engine
            .search(crate::search::SearchRequest::new("current target", 10))
            .await
            .unwrap();

        assert!(results.is_empty());

        fs::remove_dir_all(target_dir).ok();
    }

    #[test]
    fn uses_fallback_when_no_target_group_exists() {
        let settings = AppSettings::default();

        let result = resolve_target_dirs(&settings, PathBuf::from("/fallback"));

        assert_eq!(result, vec![PathBuf::from("/fallback")]);
    }

    #[test]
    fn uses_current_target_group_paths() {
        let settings = AppSettings {
            target_groups: vec![
                group("work", vec!["/work/a", "/work/b"]),
                group("personal", vec!["/personal"]),
            ],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        let result = resolve_target_dirs(&settings, PathBuf::from("/fallback"));

        assert_eq!(
            result,
            vec![PathBuf::from("/work/a"), PathBuf::from("/work/b")]
        );
    }

    #[test]
    fn returns_no_targets_when_current_group_has_no_paths() {
        let settings = AppSettings {
            target_groups: vec![group("empty", vec![])],
            current_target_group_id: Some("empty".to_string()),
            ..Default::default()
        };

        let result = resolve_target_dirs(&settings, PathBuf::from("/fallback"));

        assert!(result.is_empty());
    }

    #[test]
    fn falls_back_when_current_group_is_missing() {
        let settings = AppSettings {
            target_groups: vec![group("work", vec!["/work"])],
            current_target_group_id: Some("missing".to_string()),
            ..Default::default()
        };

        let result = resolve_target_dirs(&settings, PathBuf::from("/fallback"));

        assert_eq!(result, vec![PathBuf::from("/fallback")]);
    }
}
