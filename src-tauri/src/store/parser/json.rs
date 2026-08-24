//! JSON index file parser.
//!
//! This module parses a Glimpse JSON index file into one or more
//! [`IndexItem`] values.
//!
//! JSON index files are useful for registering external resources such as:
//!
//! - documentation links
//! - web tools
//! - project URLs
//! - command launch entries
//!
//! Unlike Markdown files, a single JSON file may produce multiple searchable
//! items.
//!
//! # ID strategy
//!
//! Each item ID is generated from:
//!
//! ```text
//! <canonical_json_file_path>::<item_index>
//! ```
//!
//! This keeps IDs stable as long as the file path and item order do not change.
//!
//! # Preview behavior
//!
//! - `iframe = true` → external preview
//! - `iframe = false` → Markdown fallback preview
//!
//! # Search metadata
//!
//! Parsed items may include:
//!
//! - tags
//! - aliases
//! - starred state
//! - hidden state
//! - URL, command, and default action

use crate::models::{IndexItem, JsonIndexFile, Preview};
use crate::search::SearchError;
use crate::store::parser::common::normalize_http_url;
use crate::utils::command_open::sanitize_command;

use chrono::{DateTime, Utc};
use std::fs;
use std::path::Path;

/// Parses a JSON index file into multiple [`IndexItem`] values.
///
/// A JSON file is treated as a container of searchable entries.
///
/// For example:
///
/// ```text
/// links.json
///   ├── Rust Docs
///   ├── Tauri Docs
///   └── SQLite Docs
/// ```
///
/// # Behavior
///
/// This function:
///
/// 1. Reads the JSON file.
/// 2. Uses the file modification time as `updated_at`.
/// 3. Deserializes the file into [`JsonIndexFile`].
/// 4. Generates stable item IDs.
/// 5. Converts each JSON entry into an [`IndexItem`].
///
/// # ID strategy
/// Each item ID is generated from:
/// <source_id>::<item_index>
/// Example:
///
/// ```text
/// /docs/links.gjson::0
/// /docs/links.gjson::1
/// ```
///
/// The entire JSON file is treated as a single source.
/// When the file changes, all items belonging to the source are deleted and recreated.
///
/// # Preview behavior
///
/// If `iframe` is enabled, the item uses an external preview:
///
/// ```text
/// Preview::External
/// ```
///
/// Otherwise, Glimpse creates a small Markdown preview from:
///
/// ```text
/// <desc>
///
/// <url>
/// ```
///
/// # Actions
///
/// Items may define `url`, `command`, and `defaultAction` directly.
///
/// Invalid URLs and unsafe commands are dropped before indexing.
///
/// # Searchability
///
/// Search indexing includes item fields such as:
///
/// - title
/// - tags
/// - aliases
/// - description-derived preview content
///
/// This allows JSON files to work as lightweight external-resource indexes.
pub fn parse_json(path: &Path, source_id: &str) -> Result<Vec<IndexItem>, SearchError> {
    // -----------------------------
    // read file
    // -----------------------------

    let content = fs::read_to_string(path).map_err(SearchError::IoError)?;

    // -----------------------------
    // metadata
    // -----------------------------

    let metadata = fs::metadata(path).map_err(|e| SearchError::DbError(e.to_string()))?;

    let updated_at: DateTime<Utc> = metadata.modified().map_err(SearchError::IoError)?.into();

    // -----------------------------
    // deserialize
    // -----------------------------

    let parsed: JsonIndexFile =
        serde_json::from_str(&content).map_err(|e| SearchError::ParseError(e.to_string()))?;

    // -----------------------------
    // stable base id
    // -----------------------------

    let source_path = fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();

    // -----------------------------
    // build items
    // -----------------------------

    let items = parsed
        .items
        .into_iter()
        .enumerate()
        .map(|(idx, item)| {
            // normalize tags
            let mut tags = item.tags;

            tags.sort();

            tags.dedup();

            // local preview fallback
            let url = item.url.and_then(normalize_http_url);
            let desc = if item.description.trim().is_empty() {
                item.desc.clone()
            } else {
                item.description.clone()
            };

            let preview_content = match (desc.trim().is_empty(), url.as_deref()) {
                (true, None) => String::new(),
                (false, None) => desc.clone(),
                (true, Some(url)) => url.to_string(),
                (false, Some(url)) => format!("{}\n\n{}", desc, url),
            };

            // preview mode
            let iframe = item.iframe.unwrap_or(url.is_some()) && url.is_some();
            let preview = if iframe {
                Preview::External {
                    url: url.clone().unwrap_or_default(),
                }
            } else {
                Preview::Markdown {
                    content: preview_content.clone(),
                }
            };

            // construct item
            let mut index_item = IndexItem::new(
                format!("{}::{}", source_id, idx),
                item.title,
                updated_at,
                preview,
            )
            .with_source_path(source_path.clone())
            .with_tags(tags)
            .set_star(item.star)
            .set_hidden(item.hidden)
            .set_boost(item.boost)
            .with_aliases(item.aliases);

            if let Some(url) = url {
                index_item = index_item.with_url(url);
            }

            if let Some(command) = sanitize_command(item.command) {
                index_item = index_item.with_command(command);
            }

            index_item = index_item.with_default_action(item.default_action);

            if !preview_content.is_empty() {
                index_item = index_item.with_search_content(preview_content);
            }

            index_item
        })
        .collect();

    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    // -----------------------------
    // helper
    // -----------------------------

    fn create_temp_json(content: &str) -> std::path::PathBuf {
        let filename = format!(
            "glimpse_test_{}.json",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        let path = std::env::temp_dir().join(filename);

        fs::write(&path, content).unwrap();

        path
    }

    // -----------------------------
    // basic parsing
    // -----------------------------

    #[test]
    fn parses_single_item() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust Book",
      "url": "https://doc.rust-lang.org"
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert_eq!(items.len(), 1);

        assert_eq!(items[0].title, "Rust Book");

        fs::remove_file(path).ok();
    }

    #[test]
    fn parses_multiple_items() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "url": "https://rust-lang.org"
    },
    {
      "title": "Tauri",
      "url": "https://tauri.app"
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert_eq!(items.len(), 2);

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // tags
    // -----------------------------

    #[test]
    fn normalizes_tags() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "url": "https://rust-lang.org",
      "tags": ["tauri", "rust", "rust"]
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert_eq!(items[0].metadata.tags, vec!["rust", "tauri",]);

        fs::remove_file(path).ok();
    }

    #[test]
    fn parses_single_string_tag() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "tags": "rust"
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert_eq!(items[0].metadata.tags, vec!["rust"]);

        fs::remove_file(path).ok();
    }

    #[test]
    fn parses_single_string_alias() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "aliases": "rs"
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert_eq!(items[0].metadata.aliases, vec!["rs"]);

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // star
    // -----------------------------

    #[test]
    fn parses_star() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "url": "https://rust-lang.org",
      "star": true
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert!(items[0].metadata.star);

        fs::remove_file(path).ok();
    }

    #[test]
    fn ignores_legacy_nested_metadata() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "url": "https://rust-lang.org",
      "metadata": {
        "star": true
      }
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert!(!items[0].metadata.star);

        fs::remove_file(path).ok();
    }

    #[test]
    fn parses_hidden() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "url": "https://rust-lang.org",
      "hidden": true
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert!(items[0].metadata.hidden);

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // iframe behavior
    // -----------------------------

    #[test]
    fn iframe_true_creates_external_preview() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "url": "https://rust-lang.org",
      "iframe": true
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        match &items[0].preview {
            Preview::External { url } => {
                assert_eq!(url, "https://rust-lang.org/");
            }

            _ => panic!("expected external preview"),
        }

        fs::remove_file(path).ok();
    }

    #[test]
    fn iframe_false_creates_local_preview() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "desc": "official docs",
      "url": "https://rust-lang.org",
      "iframe": false
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        match &items[0].preview {
            Preview::Markdown { content } => {
                assert!(content.contains("official docs"));

                assert!(content.contains("https://rust-lang.org/"));
            }

            _ => panic!("expected local preview"),
        }

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // actions
    // -----------------------------

    #[test]
    fn creates_url_action() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "url": "https://rust-lang.org"
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert_eq!(items[0].url.as_deref(), Some("https://rust-lang.org/"));
        assert_eq!(
            items[0].default_action,
            Some(crate::models::DefaultAction::Url)
        );

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // defaults
    // -----------------------------

    #[test]
    fn iframe_defaults_to_true() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "url": "https://rust-lang.org"
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert!(matches!(items[0].preview, Preview::External { .. }));

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // invalid json
    // -----------------------------

    #[test]
    fn invalid_json_returns_error() {
        let json = r#"
{
  "items": [
"#;

        let path = create_temp_json(json);

        let result = parse_json(&path, "notes/test.gjson");

        assert!(result.is_err());

        fs::remove_file(path).ok();
    }

    //
    #[test]
    fn creates_command_action() {
        let json = r#"
{
  "items": [
    {
      "title": "Open Notepad",
      "iframe": false,
      "command": "C:\\Windows\\System32\\notepad.exe"
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert_eq!(
            items[0].command.as_deref(),
            Some(r#"C:\Windows\System32\notepad.exe"#)
        );
        assert_eq!(
            items[0].default_action,
            Some(crate::models::DefaultAction::Command)
        );

        fs::remove_file(path).ok();
    }

    #[test]
    fn parses_title_only_item() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust Book"
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Rust Book");
        assert!(items[0].url.is_none());
        assert!(items[0].command.is_none());
        assert!(items[0].default_action.is_none());
        assert!(matches!(items[0].preview, Preview::Markdown { .. }));

        fs::remove_file(path).ok();
    }

    #[test]
    fn desc_only_creates_markdown_preview() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust Note",
      "desc": "official Rust note"
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        match &items[0].preview {
            Preview::Markdown { content } => {
                assert!(content.contains("official Rust note"));
            }

            _ => panic!("expected markdown preview"),
        }

        assert!(items[0].url.is_none());
        assert!(items[0].command.is_none());

        fs::remove_file(path).ok();
    }
}
