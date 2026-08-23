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
//! - custom open action

use crate::models::{IndexItem, JsonIndexFile, OpenAction, Preview};
use crate::search::SearchError;
use crate::utils::command_open::sanitize_open_action;

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
/// # Open action
///
/// If an item defines a custom open action, it is used after sanitization.
/// Otherwise, the item defaults to opening its `url` externally.
///
/// Invalid or unsafe open actions may be removed by [`sanitize_open_action`].
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
            let mut tags = item.metadata.tags;

            tags.sort();

            tags.dedup();

            // local preview fallback
            let url = item.url.unwrap_or_default();

            let preview_content = match (item.desc.trim().is_empty(), url.trim().is_empty()) {
                (true, true) => String::new(),
                (false, true) => item.desc.clone(),
                (true, false) => url.clone(),
                (false, false) => format!("{}\n\n{}", item.desc, url),
            };

            // preview mode
            let preview = if item.iframe && !url.is_empty() {
                Preview::External { url: url.clone() }
            } else {
                Preview::Markdown {
                    content: preview_content,
                }
            };

            // open action
            let open = sanitize_open_action(item.open.or_else(|| {
                if url.is_empty() {
                    None
                } else {
                    Some(OpenAction::External { url: url.clone() })
                }
            }));

            // construct item
            let mut index_item = IndexItem::new(
                format!("{}::{}", source_id, idx),
                item.title,
                updated_at,
                preview,
            )
            .with_source_path(source_path.clone())
            .with_tags(tags)
            .set_star(item.metadata.star)
            .set_hidden(item.metadata.hidden)
            .with_aliases(item.metadata.aliases);

            if let Some(open) = open {
                index_item = index_item.with_open_action(open);
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
      "metadata": {
        "tags": ["tauri", "rust", "rust"]
      }
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        assert_eq!(items[0].metadata.tags, vec!["rust", "tauri",]);

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
      "metadata": {
        "star": true
      }
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
    fn parses_legacy_pinned() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "url": "https://rust-lang.org",
      "metadata": {
        "pinned": true
      }
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
    fn parses_hidden() {
        let json = r#"
{
  "items": [
    {
      "title": "Rust",
      "url": "https://rust-lang.org",
      "metadata": {
        "hidden": true
      }
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
                assert_eq!(url, "https://rust-lang.org");
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

                assert!(content.contains("https://rust-lang.org"));
            }

            _ => panic!("expected local preview"),
        }

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // open action
    // -----------------------------

    #[test]
    fn creates_open_action() {
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

        match &items[0].open {
            Some(OpenAction::External { url }) => {
                assert_eq!(url, "https://rust-lang.org");
            }

            _ => panic!("expected open action"),
        }

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
    fn creates_command_open_action() {
        let json = r#"
{
  "items": [
    {
      "title": "Open Notepad",
      "url": "internal://commands/notepad",
      "iframe": false,
      "open": {
        "type": "command",
        "path": "C:\\Windows\\System32\\notepad.exe"
      }
    }
  ]
}
"#;

        let path = create_temp_json(json);

        let items = parse_json(&path, "notes/test.gjson").unwrap();

        match &items[0].open {
            Some(OpenAction::Command { path }) => {
                assert_eq!(path, r#"C:\Windows\System32\notepad.exe"#);
            }

            _ => panic!("expected command open action"),
        }

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
        assert!(items[0].open.is_none());
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

        assert!(items[0].open.is_none());

        fs::remove_file(path).ok();
    }
}
