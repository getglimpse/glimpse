//! Search-related Tauri IPC commands.
//!
//! The frontend sends normalized search parameters here. Searches are always
//! scoped to the active target group; target group switching is the supported
//! way to search another group.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;
use tracing::{debug, error, info};

use crate::search::{
    request::build_search_request, ActiveSearchEngine, SearchEngine, SearchResult,
};
use crate::store::item_repository::list_items_by_source_path;
use rusqlite::Connection;

#[tauri::command]
pub async fn search_items(
    query: String,
    dictionary_id: Option<String>,
    limit: Option<usize>,
    global: Option<bool>,
    unstar_only: Option<bool>,
    hidden_only: Option<bool>,
    reverse_order: Option<bool>,
    engine: State<'_, Arc<ActiveSearchEngine>>,
) -> Result<Vec<SearchResult>, String> {
    let _ = global;
    let req = build_search_request(
        query,
        dictionary_id,
        limit,
        false,
        unstar_only.unwrap_or(false),
        hidden_only.unwrap_or(false),
        reverse_order.unwrap_or(false),
    );

    debug!(
        query = %req.query,
        dictionary_id = ?req.dictionary_id,
        limit = req.limit,
        unstar_only = req.unstar_only,
        hidden_only = req.hidden_only,
        reverse_order = req.reverse_order,
        "search request built"
    );

    info!(
        query = %req.query,
        dictionary_id = ?req.dictionary_id,
        limit = req.limit,
        unstar_only = req.unstar_only,
        hidden_only = req.hidden_only,
        reverse_order = req.reverse_order,
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

#[tauri::command]
pub fn get_items_by_source_path(
    source_path: String,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<Vec<SearchResult>, String> {
    let requested_path = source_path.trim();

    if requested_path.is_empty() {
        return Ok(Vec::new());
    }

    let path_candidates = source_path_lookup_candidates(requested_path);
    let conn = db.lock().map_err(|error| error.to_string())?;

    for path in path_candidates {
        let results = list_items_by_source_path(&conn, &path).map_err(|error| error.to_string())?;

        if !results.is_empty() {
            return Ok(results);
        }
    }

    Ok(Vec::new())
}

fn source_path_lookup_candidates(path: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();

    let canonical_path = std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));

    push_path_candidate(&mut candidates, &mut seen, &canonical_path);
    push_path_candidate(&mut candidates, &mut seen, Path::new(path));

    candidates
}

fn push_path_candidate(candidates: &mut Vec<String>, seen: &mut HashSet<String>, path: &Path) {
    let path_text = path.to_string_lossy().to_string();
    push_candidate(candidates, seen, path_text.clone());

    #[cfg(windows)]
    {
        let normalized = path_text
            .strip_prefix(r"\\?\")
            .or_else(|| path_text.strip_prefix("//?/"))
            .unwrap_or(&path_text)
            .to_string();

        push_candidate(candidates, seen, normalized);
    }
}

fn push_candidate(candidates: &mut Vec<String>, seen: &mut HashSet<String>, path: String) {
    if seen.insert(path.clone()) {
        candidates.push(path);
    }
}
