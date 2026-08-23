//! Search-related Tauri IPC commands.
//!
//! This module exposes backend search functionality to the frontend via
//! Tauri `invoke()` APIs.
//!
//! Responsibilities:
//!
//! - Receive raw search parameters from the frontend.
//! - Build a normalized `SearchRequest`.
//! - Dispatch local or global search.
//! - Convert backend errors into frontend-friendly strings.
//!
//! Search execution itself is delegated to:
//!
//! - active search engine for normal target-scoped search.
//! - `IndexerRuntime` for global search across target groups.

use std::sync::Arc;
use tauri::State;
use tracing::{debug, error, info};

use crate::search::{
    request::build_search_request, ActiveSearchEngine, SearchEngine, SearchResult,
};
use crate::store::indexer::runtime::IndexerRuntime;

/// Executes a search query from the frontend.
///
/// This command acts as the IPC bridge between:
///
/// - frontend search UI
/// - backend search request builder
/// - active search engine
/// - indexer runtime for global search
///
/// Search flow:
///
/// ```text
/// Frontend query
///      ↓
/// build_search_request()
///      ↓
/// global?
///      ├─ yes → IndexerRuntime::search_global()
///      └─ no  → SqliteEngine::search()
///      ↓
/// Vec<SearchResult>
/// ```
///
/// # Arguments
///
/// - `query`
///
///   Raw search query entered by the user.
///
/// - `dictionary_id`
///
///   Optional dictionary or target-group filter.
///
/// - `limit`
///
///   Optional maximum number of results.
///
///   Defaults are applied by `build_search_request()`.
///
/// - `global`
///
///   Whether to search across all target groups.
///
///   Defaults to `false` when omitted.
///
/// - `hidden_only`
///
///   Whether to search hidden items instead of visible items.
///
///   Defaults to `false` when omitted.
///
/// - `engine`
///
///   Shared active search engine managed by Tauri state.
///
/// - `runtime`
///
///   Shared indexer runtime used for global search.
///
/// # Returns
///
/// Ranked search results including:
///
/// - indexed item data
/// - engine-specific relevance score
///
/// # Notes
///
/// Empty queries are allowed.
///
/// For normal search, empty queries are typically interpreted as recent
/// items ordered by starred status and update time.
#[tauri::command]
pub async fn search_items(
    query: String,
    dictionary_id: Option<String>,
    limit: Option<usize>,
    global: Option<bool>,
    hidden_only: Option<bool>,
    engine: State<'_, Arc<ActiveSearchEngine>>,
    runtime: State<'_, Arc<IndexerRuntime>>,
) -> Result<Vec<SearchResult>, String> {
    let req = build_search_request(
        query,
        dictionary_id,
        limit,
        global.unwrap_or(false),
        hidden_only.unwrap_or(false),
    );

    debug!(
        query = %req.query,
        dictionary_id = ?req.dictionary_id,
        limit = req.limit,
        global = req.global,
        hidden_only = req.hidden_only,
        "search request built"
    );

    let result = if req.global {
        info!(
            query = %req.query,
            limit = req.limit,
            hidden_only = req.hidden_only,
            "executing global search"
        );

        runtime.search_global(req).await
    } else {
        info!(
            query = %req.query,
            dictionary_id = ?req.dictionary_id,
            limit = req.limit,
            hidden_only = req.hidden_only,
            "executing local search"
        );

        engine.search(req).await
    };

    match result {
        Ok(results) => {
            debug!(count = results.len(), "search completed");

            Ok(results)
        }
        Err(error) => {
            error!(
                error = %error,
                "search failed"
            );

            Err(error.to_string())
        }
    }
}
