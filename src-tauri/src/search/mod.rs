//! Search engine abstraction layer for Glimpse.
//!
//! This module defines the common search API used by indexing, commands, and
//! future search backends.
//!
//! Responsibilities:
//!
//! - Define the [`SearchEngine`] trait.
//! - Define shared request/result types.
//! - Define search-related error types.
//! - Expose concrete search engine implementations.
//!
//! Current implementation:
//!
//! - `sqlite` → SQLite FTS5-based local search engine.
//!
//! Future implementations may include:
//!
//! - Tantivy
//! - remote or cloud indexes
//! - hybrid semantic search
//!
//! The rest of the application should depend on [`SearchEngine`] rather than
//! concrete engine implementations whenever possible.

pub mod query;
pub mod request;
pub mod sqlite;
pub mod tantivy;

pub type ActiveSearchEngine = tantivy::TantivyEngine;

use async_trait::async_trait;
use chrono::{DateTime, Utc};

use crate::models::IndexItem;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFingerprint {
    pub source_path: String,
    pub source_id: String,
    pub modified_at: DateTime<Utc>,
    pub size_bytes: u64,
    pub content_hash: Option<String>,
}

impl SourceFingerprint {
    pub fn new(
        source_path: impl Into<String>,
        source_id: impl Into<String>,
        modified_at: DateTime<Utc>,
        size_bytes: u64,
    ) -> Self {
        Self {
            source_path: source_path.into(),
            source_id: source_id.into(),
            modified_at,
            size_bytes,
            content_hash: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SourceReplacement {
    pub source_id: String,
    pub items: Vec<IndexItem>,
    pub fingerprint: Option<SourceFingerprint>,
}

impl SourceReplacement {
    pub fn new(
        source_id: impl Into<String>,
        items: Vec<IndexItem>,
        fingerprint: Option<SourceFingerprint>,
    ) -> Self {
        Self {
            source_id: source_id.into(),
            items,
            fingerprint,
        }
    }

    pub fn item_count(&self) -> usize {
        self.items.len()
    }
}

/// Common interface for all Glimpse search engines.
///
/// A search engine is responsible for:
///
/// - indexing items
/// - executing search queries
/// - synchronizing updates
/// - removing stale entries
/// - exposing indexed source paths for cleanup
///
/// Implementations must be:
///
/// - thread-safe (`Send + Sync`)
/// - async-compatible
///
/// The trait is intentionally small so the indexer and IPC commands can work
/// with different search backends without knowing their internal storage model.
#[async_trait]
pub trait SearchEngine: Send + Sync {
    /// Initializes the search engine.
    ///
    /// Typical responsibilities depend on the backend:
    ///
    /// - loading indexes
    /// - verifying schema consistency
    /// - warming caches
    /// - preparing tokenizers
    ///
    /// Some engines may perform all initialization elsewhere and use this as a
    /// no-op.
    async fn init(&self) -> Result<(), SearchError>;

    /// Executes a search query.
    ///
    /// Returns ranked search results ordered by engine-specific scoring logic.
    ///
    /// Implementations may interpret empty queries as recent-items or
    /// browsing-mode requests.
    async fn search(&self, req: SearchRequest) -> Result<Vec<SearchResult>, SearchError>;

    /// Inserts or updates a single item.
    ///
    /// Implementations should keep the persistent store and search index
    /// consistent.
    ///
    /// For database-backed engines, this should usually be atomic.
    async fn upsert(&self, item: IndexItem) -> Result<(), SearchError>;

    /// Inserts or updates multiple items.
    ///
    /// This method exists primarily for initial indexing and bulk refreshes.
    ///
    /// The default implementation calls [`SearchEngine::upsert`] repeatedly.
    /// Engines are encouraged to override this with optimized bulk transactions
    /// when available.
    async fn upsert_batch(&self, items: Vec<IndexItem>) -> Result<(), SearchError> {
        for item in items {
            self.upsert(item).await?;
        }

        Ok(())
    }

    /// Replaces every indexed item for one source with freshly parsed items.
    ///
    /// Full scans use this for changed sources so removed `.gjson` sub-items do
    /// not remain in SQLite or derived search indexes.
    async fn replace_source(
        &self,
        source_id: &str,
        items: Vec<IndexItem>,
        fingerprint: Option<SourceFingerprint>,
    ) -> Result<(), SearchError> {
        let item_count = items.len();

        self.delete_by_source_id(source_id).await?;
        self.upsert_batch(items).await?;

        if let Some(fingerprint) = fingerprint {
            self.upsert_source_fingerprint(fingerprint, item_count)
                .await?;
        }

        Ok(())
    }

    /// Replaces multiple sources in one bulk operation when the backend can do
    /// so efficiently.
    async fn replace_sources(
        &self,
        replacements: Vec<SourceReplacement>,
    ) -> Result<(), SearchError> {
        for replacement in replacements {
            self.replace_source(
                &replacement.source_id,
                replacement.items,
                replacement.fingerprint,
            )
            .await?;
        }

        Ok(())
    }

    /// Deletes an indexed item by ID.
    ///
    /// Implementations should remove both the primary stored item and any
    /// associated search-index entries.
    async fn delete(&self, id: &str) -> Result<(), SearchError>;

    /// Deletes all indexed items originating from the same source.
    ///
    /// Markdown sources usually map to one item:
    ///
    /// ```text
    /// docs/readme.md
    /// ```
    ///
    /// JSON index sources may map to multiple items:
    ///
    /// ```text
    /// docs/links.json::0
    /// docs/links.json::1
    /// ```
    ///
    /// Implementations should remove both stored items and search-index entries.
    async fn delete_by_source_id(&self, source_id: &str) -> Result<(), SearchError>;

    /// Deletes all indexed items whose source file path matches `source_path`.
    ///
    /// Used by cleanup routines after detecting that the original file no longer
    /// exists on disk.
    ///
    /// Implementations should remove both stored items and search-index entries.
    async fn delete_by_source_path(&self, source_path: &str) -> Result<(), SearchError>;

    /// Returns all indexed source paths.
    ///
    /// Used by cleanup routines to detect stale database entries whose source
    /// files no longer exist.
    async fn list_source_paths(&self) -> Result<Vec<String>, SearchError>;

    /// Returns the indexed item count when the source already matches the
    /// current filesystem fingerprint.
    ///
    /// Full scans use this to avoid parsing and re-upserting unchanged files.
    /// `source_id` is included so target-root changes cannot accidentally reuse
    /// rows created for a different relative ID.
    async fn unchanged_source_item_count(
        &self,
        fingerprint: SourceFingerprint,
    ) -> Result<Option<usize>, SearchError> {
        let _ = fingerprint;

        Ok(None)
    }

    /// Records the source fingerprint after a source has been indexed.
    ///
    /// Engines that do not support source-level freshness checks can keep the
    /// default no-op implementation.
    async fn upsert_source_fingerprint(
        &self,
        fingerprint: SourceFingerprint,
        item_count: usize,
    ) -> Result<(), SearchError> {
        let _ = (fingerprint, item_count);

        Ok(())
    }
}

/// Parameters for executing a search query.
///
/// This abstraction keeps the search API extensible without changing
/// [`SearchEngine::search`] signatures every time a new search option is
/// added.
#[derive(Debug, Clone)]
pub struct SearchRequest {
    /// User-entered search text.
    ///
    /// Examples:
    ///
    /// - `rust tauri`
    /// - `#sqlite`
    /// - `obsidian plugin`
    pub query: String,

    /// Maximum number of results to return.
    pub limit: usize,

    /// Whether the search should ignore the currently selected target group.
    ///
    /// When `true`, search should run across all available or enabled sources.
    /// Exact behavior depends on the command layer and search engine.
    pub global: bool,

    /// Whether the search should return hidden items instead of visible items.
    pub hidden_only: bool,

    /// Whether the search should return unstarred items only.
    pub unstar_only: bool,

    /// Whether results should be returned in ascending score order.
    pub reverse_order: bool,

    /// Restricts search scope to a specific dictionary or target group.
    ///
    /// `None` means the default search scope selected by the caller.
    pub dictionary_id: Option<String>,
}

impl SearchRequest {
    /// Creates a new search request.
    ///
    /// By default:
    ///
    /// - `global` is disabled.
    /// - `dictionary_id` is unset.
    pub fn new(query: impl Into<String>, limit: usize) -> Self {
        Self {
            query: query.into(),
            limit,
            global: false,
            hidden_only: false,
            unstar_only: false,
            reverse_order: false,
            dictionary_id: None,
        }
    }

    /// Enables or disables global search mode.
    pub fn global(mut self, global: bool) -> Self {
        self.global = global;
        self
    }

    /// Restricts results to hidden items when enabled.
    pub fn hidden_only(mut self, hidden_only: bool) -> Self {
        self.hidden_only = hidden_only;
        self
    }

    /// Restricts results to unstarred items when enabled.
    pub fn unstar_only(mut self, unstar_only: bool) -> Self {
        self.unstar_only = unstar_only;
        self
    }

    /// Reverses score ordering when enabled.
    pub fn reverse_order(mut self, reverse_order: bool) -> Self {
        self.reverse_order = reverse_order;
        self
    }

    /// Restricts the request to a specific dictionary or target group.
    pub fn with_dictionary(mut self, dict_id: String) -> Self {
        self.dictionary_id = Some(dict_id);

        self
    }
}

/// Ranked search result.
///
/// Combines:
///
/// - indexed item data
/// - engine-specific relevance score
/// - optional search snippets
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// Indexed item returned by the search engine.
    pub item: IndexItem,

    /// Engine-specific relevance score.
    ///
    /// For SQLite FTS5, this is based on BM25 ranking.
    /// Other search engines may use different scoring systems.
    pub score: f32,

    /// Optional snippets explaining why this item matched.
    ///
    /// Snippets are omitted when the backend cannot produce them cheaply, such
    /// as empty-query recent items or legacy SQLite search results.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippets: Option<Vec<SearchSnippet>>,
}

/// Short search-result context produced by a backend.
#[derive(Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchSnippet {
    /// Field or item surface the snippet came from.
    pub source: SearchSnippetSource,

    /// Plain-text fragments rendered by the frontend.
    pub fragments: Vec<SearchSnippetFragment>,

    /// Chunk location when the snippet comes from a body chunk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk: Option<SearchSnippetChunk>,
}

/// Searchable surface that produced a snippet.
#[derive(Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SearchSnippetSource {
    Body,
    Title,
    Alias,
    Tag,
}

/// A plain-text snippet fragment.
#[derive(Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchSnippetFragment {
    /// Text to render.
    pub text: String,

    /// Whether this fragment matched the query.
    pub matched: bool,
}

/// Body chunk location associated with a snippet.
#[derive(Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchSnippetChunk {
    /// Zero-based chunk ordinal within the item body.
    pub ordinal: usize,

    /// Byte offset where the chunk starts in the original body text.
    pub start_byte: usize,

    /// Byte offset where the chunk ends in the original body text.
    pub end_byte: usize,
}

/// Search-related error definitions.
#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    /// Database-related failure.
    #[error("Database error: {0}")]
    DbError(String),

    /// Search index failure.
    #[error("Index error: {0}")]
    IndexError(String),

    /// Filesystem or IO failure.
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    /// Data parsing failure.
    #[error("Parse error: {0}")]
    ParseError(String),
}

impl SearchError {
    /// Returns true for files that should be skipped quietly during indexing.
    pub fn is_skippable_indexing_error(&self) -> bool {
        matches!(
            self,
            SearchError::IoError(error)
                if error.raw_os_error() == Some(ERROR_CLOUD_FILE_PROVIDER_NOT_RUNNING)
        )
    }

    /// Returns true when the SQLite index storage can be rebuilt from source files.
    pub fn is_recoverable_index_storage_error(&self) -> bool {
        match self {
            SearchError::DbError(message) => {
                message.contains("vtable constructor failed: search_index")
                    || message.contains("no such table: search_index")
            }
            _ => false,
        }
    }
}

/// Windows: "The cloud file provider is not running."
const ERROR_CLOUD_FILE_PROVIDER_NOT_RUNNING: i32 = 362;

#[cfg(test)]
mod tests {
    use super::SearchError;
    use std::io;

    #[test]
    fn cloud_provider_not_running_is_skippable_for_indexing() {
        let error = SearchError::IoError(io::Error::from_raw_os_error(362));

        assert!(error.is_skippable_indexing_error());
    }

    #[test]
    fn generic_io_error_is_not_skippable_for_indexing() {
        let error = SearchError::IoError(io::Error::new(io::ErrorKind::NotFound, "missing"));

        assert!(!error.is_skippable_indexing_error());
    }

    #[test]
    fn broken_search_index_is_recoverable() {
        let error = SearchError::DbError("vtable constructor failed: search_index".to_string());

        assert!(error.is_recoverable_index_storage_error());
    }

    #[test]
    fn generic_database_error_is_not_recoverable() {
        let error = SearchError::DbError("database is locked".to_string());

        assert!(!error.is_recoverable_index_storage_error());
    }
}
