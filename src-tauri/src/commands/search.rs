//! Search-related Tauri IPC commands.
//!
//! The frontend sends normalized search parameters here. Searches are always
//! scoped to the active target group; target group switching is the supported
//! way to search another group.

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;
use tracing::{debug, error, info};

use crate::app_state::SharedSettingsPath;
use crate::models::settings::{AppSettings, TargetGroup};
use crate::search::{
    request::build_search_request, ActiveSearchEngine, SearchEngine, SearchResult,
};
use crate::store::item_repository::list_items_by_source_path;
use crate::store::settings::load_settings;
use rusqlite::Connection;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownLinkResolution {
    pub status: MarkdownLinkResolutionStatus,
    pub target_path: Option<String>,
    pub create_path: Option<String>,
    pub item: Option<SearchResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MarkdownLinkResolutionStatus {
    Found,
    ExistsUnindexed,
    Missing,
}

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

#[tauri::command]
pub fn resolve_markdown_link(
    source_path: String,
    href: String,
    settings_path: State<'_, SharedSettingsPath>,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<MarkdownLinkResolution, String> {
    let href_path = markdown_link_path(&href)?;

    if href_path.is_empty() {
        return Err("markdown link path is empty".to_string());
    }

    if is_external_or_absolute_link(&href_path) {
        return Err(format!("unsupported markdown link target: {href}"));
    }

    let settings_path = settings_path
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    let settings = load_settings(&settings_path);
    let source_path = canonicalize_existing_file(&source_path)?;
    let source_dir = source_path
        .parent()
        .ok_or_else(|| "markdown source has no parent directory".to_string())?;
    let source_groups = target_groups_containing_path(&settings, &source_path);

    if source_groups.is_empty() {
        return Err(format!(
            "markdown source is outside configured target group directories: {}",
            source_path.display()
        ));
    }

    let resolved = resolve_relative_path(source_dir, &href_path)?;
    let existing_candidates = markdown_link_existing_candidates(&resolved);
    let conn = db.lock().map_err(|error| error.to_string())?;

    for candidate in existing_candidates {
        if !candidate.is_file() {
            continue;
        }

        let canonical = canonicalize_existing_file(&candidate)?;

        if !source_groups
            .iter()
            .any(|group| path_is_in_roots(&canonical, &group.paths))
        {
            return Err(format!(
                "markdown link target is outside the source target group: {}",
                canonical.display()
            ));
        }

        let results = items_by_source_path_candidates(&conn, &canonical)?;

        if let Some(result) = results.into_iter().next() {
            return Ok(MarkdownLinkResolution {
                status: MarkdownLinkResolutionStatus::Found,
                target_path: Some(canonical.to_string_lossy().to_string()),
                create_path: None,
                item: Some(result),
            });
        }

        return Ok(MarkdownLinkResolution {
            status: MarkdownLinkResolutionStatus::ExistsUnindexed,
            target_path: Some(canonical.to_string_lossy().to_string()),
            create_path: None,
            item: None,
        });
    }

    let create_path = markdown_link_create_candidate(&resolved)
        .filter(|path| {
            source_groups
                .iter()
                .any(|group| new_path_is_in_group(path, group))
        })
        .map(|path| path.to_string_lossy().to_string());

    Ok(MarkdownLinkResolution {
        status: MarkdownLinkResolutionStatus::Missing,
        target_path: None,
        create_path,
        item: None,
    })
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

fn markdown_link_path(href: &str) -> Result<String, String> {
    let trimmed = href.trim();
    let without_fragment = trimmed.split('#').next().unwrap_or(trimmed);
    let without_query = without_fragment
        .split('?')
        .next()
        .unwrap_or(without_fragment);

    percent_decode_path(without_query)
}

fn percent_decode_path(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }

        if index + 2 >= bytes.len() {
            return Err(format!(
                "invalid percent encoding in markdown link: {value}"
            ));
        }

        let hex = std::str::from_utf8(&bytes[index + 1..index + 3])
            .map_err(|error| format!("invalid percent encoding in markdown link: {error}"))?;
        let byte = u8::from_str_radix(hex, 16)
            .map_err(|error| format!("invalid percent encoding in markdown link: {error}"))?;

        decoded.push(byte);
        index += 3;
    }

    String::from_utf8(decoded)
        .map_err(|error| format!("markdown link path is not valid UTF-8: {error}"))
}

fn is_external_or_absolute_link(path: &str) -> bool {
    path.starts_with('/')
        || path.starts_with('\\')
        || Path::new(path).is_absolute()
        || path
            .split(['/', '\\', '#', '?'])
            .next()
            .is_some_and(|first| first.contains(':'))
}

fn resolve_relative_path(base_dir: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut path = base_dir.to_path_buf();

    for component in Path::new(relative).components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => path.push(part),
            Component::ParentDir => {
                if !path.pop() {
                    return Err(format!("markdown link escapes filesystem root: {relative}"));
                }
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(format!("markdown link target is not relative: {relative}"));
            }
        }
    }

    Ok(normalize_input_path(path))
}

fn markdown_link_existing_candidates(path: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    candidates.push(path.to_path_buf());

    if path.extension().is_none() {
        candidates.push(path.with_extension("md"));
        candidates.push(path.join("index.md"));
        candidates.push(path.join("README.md"));
    }

    candidates
}

fn markdown_link_create_candidate(path: &Path) -> Option<PathBuf> {
    match path.extension().and_then(|extension| extension.to_str()) {
        None => Some(path.with_extension("md")),
        Some(extension) if matches!(extension.to_ascii_lowercase().as_str(), "md" | "gjson") => {
            Some(path.to_path_buf())
        }
        _ => None,
    }
}

fn items_by_source_path_candidates(
    conn: &Connection,
    path: &Path,
) -> Result<Vec<SearchResult>, String> {
    let path_text = path.to_string_lossy().to_string();

    for candidate in source_path_lookup_candidates(&path_text) {
        let results =
            list_items_by_source_path(conn, &candidate).map_err(|error| error.to_string())?;

        if !results.is_empty() {
            return Ok(results);
        }
    }

    Ok(Vec::new())
}

fn target_groups_containing_path<'a>(
    settings: &'a AppSettings,
    path: &Path,
) -> Vec<&'a TargetGroup> {
    settings
        .target_groups
        .iter()
        .filter(|group| path_is_in_roots(path, &group.paths))
        .collect()
}

fn new_path_is_in_group(path: &Path, group: &TargetGroup) -> bool {
    let Some(ancestor) = nearest_existing_ancestor(path) else {
        return false;
    };

    let Ok(ancestor) = canonicalize_existing_dir(&ancestor) else {
        return false;
    };

    group.paths.iter().any(|root| {
        let Ok(root) = canonicalize_existing_dir(root) else {
            return false;
        };

        path_starts_with(&ancestor, &root) && path_starts_with(path, &root)
    })
}

fn nearest_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = path.parent()?.to_path_buf();

    loop {
        if current.exists() {
            return Some(current);
        }

        if !current.pop() {
            return None;
        }
    }
}

fn canonicalize_existing_file(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = normalize_input_path(path);

    if !path.exists() {
        return Err(format!("file does not exist: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!("path is not a file: {}", path.display()));
    }

    path.canonicalize()
        .map(normalize_input_path)
        .map_err(|error| format!("failed to canonicalize file: {}: {error}", path.display()))
}

fn canonicalize_existing_dir(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = normalize_input_path(path);

    if !path.exists() {
        return Err(format!("directory does not exist: {}", path.display()));
    }

    if !path.is_dir() {
        return Err(format!("path is not a directory: {}", path.display()));
    }

    path.canonicalize()
        .map(normalize_input_path)
        .map_err(|error| {
            format!(
                "failed to canonicalize directory: {}: {error}",
                path.display()
            )
        })
}

fn path_is_in_roots(path: &Path, roots: &[String]) -> bool {
    roots.iter().any(|root| {
        canonicalize_existing_dir(root)
            .map(|root| path_starts_with(path, &root))
            .unwrap_or(false)
    })
}

fn path_starts_with(path: &Path, root: &Path) -> bool {
    normalize_comparison_path(path).starts_with(normalize_comparison_path(root))
}

fn normalize_input_path(path: impl AsRef<Path>) -> PathBuf {
    let value = path.as_ref().to_string_lossy();

    #[cfg(windows)]
    {
        let normalized = value
            .strip_prefix(r"\\?\")
            .or_else(|| value.strip_prefix(r"//?/"))
            .unwrap_or(&value);

        PathBuf::from(normalized)
    }

    #[cfg(not(windows))]
    {
        PathBuf::from(value.to_string())
    }
}

fn normalize_comparison_path(path: &Path) -> PathBuf {
    let path = normalize_input_path(path);

    #[cfg(windows)]
    {
        PathBuf::from(path.to_string_lossy().to_lowercase())
    }

    #[cfg(not(windows))]
    {
        path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_link_existing_candidates_prefers_exact_path_then_markdown_conventions() {
        let candidates = markdown_link_existing_candidates(Path::new("docs/template"));

        assert_eq!(
            candidates,
            vec![
                PathBuf::from("docs/template"),
                PathBuf::from("docs/template.md"),
                PathBuf::from("docs/template/index.md"),
                PathBuf::from("docs/template/README.md"),
            ]
        );
    }

    #[test]
    fn markdown_link_existing_candidates_does_not_expand_paths_with_extensions() {
        let candidates = markdown_link_existing_candidates(Path::new("docs/template.md"));

        assert_eq!(candidates, vec![PathBuf::from("docs/template.md")]);
    }

    #[test]
    fn markdown_link_path_strips_fragment_and_query_and_decodes_spaces() {
        let path = markdown_link_path("./docs/template%20file.md#heading?ignored").unwrap();

        assert_eq!(path, "./docs/template file.md");
    }

    #[test]
    fn absolute_and_scheme_links_are_not_internal_markdown_links() {
        assert!(is_external_or_absolute_link("https://example.com"));
        assert!(is_external_or_absolute_link("/etc/passwd"));
        assert!(is_external_or_absolute_link(r"\server\share"));
        assert!(is_external_or_absolute_link("mailto:test@example.com"));
    }
}
