//! Search-related Tauri IPC commands.
//!
//! The frontend sends normalized search parameters here. Searches are always
//! scoped to the active target group; target group switching is the supported
//! way to search another group.

use std::sync::Arc;
use tauri::State;
use tracing::{debug, error, info};

use crate::search::{
    request::build_search_request, ActiveSearchEngine, SearchEngine, SearchResult,
};

#[tauri::command]
pub async fn search_items(
    query: String,
    dictionary_id: Option<String>,
    limit: Option<usize>,
    global: Option<bool>,
    hidden_only: Option<bool>,
    engine: State<'_, Arc<ActiveSearchEngine>>,
) -> Result<Vec<SearchResult>, String> {
    let _ = global;
    let req = build_search_request(
        query,
        dictionary_id,
        limit,
        false,
        hidden_only.unwrap_or(false),
    );

    debug!(
        query = %req.query,
        dictionary_id = ?req.dictionary_id,
        limit = req.limit,
        hidden_only = req.hidden_only,
        "search request built"
    );

    info!(
        query = %req.query,
        dictionary_id = ?req.dictionary_id,
        limit = req.limit,
        hidden_only = req.hidden_only,
        "executing local search"
    );

    let result = engine.search(req).await;

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
