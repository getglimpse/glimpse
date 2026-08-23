//! SQLite row mappers for indexed items.
//!
//! This module is responsible for converting raw SQLite query rows into
//! Glimpse domain models.
//!
//! Mapping responsibilities:
//!
//! - SQLite row → [`SearchResult`]
//! - Preview columns → [`Preview`]
//! - Open action columns → [`OpenAction`]
//! - Serialized metadata → Rust collections
//!
//! This layer intentionally contains no search logic or SQL generation. Its
//! only responsibility is decoding database values into application structures.

use chrono::{DateTime, Utc};
use rusqlite::Row;

use crate::models::{IndexItem, OpenAction, Preview};
use crate::search::SearchResult;

const COL_ID: usize = 0;
const COL_TITLE: usize = 1;
const COL_SOURCE_PATH: usize = 2;
const COL_STAR: usize = 3;
const COL_HIDDEN: usize = 4;
const COL_UPDATED_AT: usize = 5;
const COL_PREVIEW_TYPE: usize = 6;
const COL_PREVIEW_CONTENT: usize = 7;
const COL_PREVIEW_URL: usize = 8;
const COL_OPEN_TYPE: usize = 9;
const COL_OPEN_URL: usize = 10;
const COL_OPEN_COMMAND_PATH: usize = 11;
const COL_SCORE: usize = 12;
const COL_TAGS: usize = 13;
const COL_ALIASES: usize = 14;

/// Maps a SQLite search row into a [`SearchResult`].
///
/// Expected column layout:
///
/// | Column | Description |
/// |-------:|-------------|
/// | 0 | id |
/// | 1 | title |
/// | 2 | source_path |
/// | 3 | star |
/// | 4 | hidden |
/// | 5 | updated_at (RFC3339) |
/// | 6 | preview_type |
/// | 7 | preview_content |
/// | 8 | preview_url |
/// | 9 | open_type |
/// | 10 | open_url |
/// | 11 | open_command_path |
/// | 12 | search score |
/// | 13 | tags |
/// | 14 | aliases |
///
/// This mapper is intentionally isolated from:
///
/// - SQL generation
/// - Query execution
/// - Search ranking
///
/// so that database schema changes remain localized to this module.
pub fn map_search_result(row: &Row) -> rusqlite::Result<SearchResult> {
    let updated_at = parse_updated_at(row.get(COL_UPDATED_AT)?);

    let preview = map_preview(
        row.get(COL_PREVIEW_TYPE)?,
        row.get(COL_PREVIEW_CONTENT)?,
        row.get(COL_PREVIEW_URL)?,
    );

    let open = map_open_action(
        row.get(COL_OPEN_TYPE)?,
        row.get(COL_OPEN_URL)?,
        row.get(COL_OPEN_COMMAND_PATH)?,
    );

    let tags = split_words(row.get(COL_TAGS)?);
    let aliases = split_words(row.get(COL_ALIASES)?);

    let mut item = IndexItem::new(
        row.get::<_, String>(COL_ID)?,
        row.get::<_, String>(COL_TITLE)?,
        updated_at,
        preview,
    )
    .set_star(row.get::<_, i32>(COL_STAR)? == 1)
    .set_hidden(row.get::<_, i32>(COL_HIDDEN)? == 1)
    .with_tags(tags)
    .with_aliases(aliases);

    let source_path: Option<String> = row.get(COL_SOURCE_PATH)?;

    if let Some(source_path) = source_path {
        item = item.with_source_path(source_path);
    }

    if let Some(open) = open {
        item = item.with_open_action(open);
    }

    Ok(SearchResult {
        item,
        score: row.get::<_, f64>(COL_SCORE)? as f32,
        snippets: None,
    })
}

/// Converts preview-related database columns into a [`Preview`].
///
/// Supported preview types:
///
/// - `markdown`
/// - `raw`
/// - `external`
/// - `pluginViewer`
///
/// Unknown preview types fall back to an empty Markdown preview
/// to avoid breaking search results due to malformed database values.
fn map_preview(
    preview_type: String,
    preview_content: Option<String>,
    preview_url: Option<String>,
) -> Preview {
    match preview_type.as_str() {
        "markdown" => Preview::Markdown {
            content: preview_content.unwrap_or_default(),
        },
        "raw" => Preview::Raw {
            content: preview_content.unwrap_or_default(),
        },
        "external" => Preview::External {
            url: preview_url.unwrap_or_default(),
        },
        "pluginViewer" => Preview::PluginViewer {
            plugin_id: preview_content.unwrap_or_default(),
            viewer_id: preview_url.unwrap_or_default(),
        },

        _ => Preview::Markdown {
            content: String::new(),
        },
    }
}

/// Converts open-action columns into an [`OpenAction`].
///
/// Supported actions:
///
/// - `external` → open URL
/// - `command` → execute command
///
/// Returns `None` when no open action is configured.
pub fn map_open_action(
    open_type: Option<String>,
    open_url: Option<String>,
    open_command_path: Option<String>,
) -> Option<OpenAction> {
    match open_type.as_deref() {
        Some("external") => open_url.map(|url| OpenAction::External { url }),
        Some("command") => open_command_path.map(|path| OpenAction::Command { path }),
        _ => None,
    }
}

/// Parses an RFC3339 timestamp stored in the database.
///
/// Invalid timestamps fall back to the current UTC time.
///
/// This fallback prevents a corrupted row from making the entire
/// search query fail.
fn parse_updated_at(value: String) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&value)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

/// Splits a whitespace-separated metadata string into individual values.
///
/// Examples:
///
/// ```text
/// "rust tauri sqlite"
/// ↓
/// ["rust", "tauri", "sqlite"]
/// ```
fn split_words(value: Option<String>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::models::{OpenAction, Preview};
    use crate::test_utils::fixtures::{
        create_test_db, map_test_search_result, TestSearchResultRow,
    };

    #[test]
    fn maps_local_preview() {
        let conn = create_test_db();

        let result = map_test_search_result(
            &conn,
            TestSearchResultRow {
                id: "item-1".to_string(),
                title: "Rust Notes".to_string(),
                star: true,
                preview_type: "markdown".to_string(),
                preview_content: Some("hello world".to_string()),
                open_url: Some("https://tauri.app".to_string()),
                rank: 0.42,
                tags_str: Some("rust tauri".to_string()),
                aliases_str: Some("rs cargo".to_string()),
                ..Default::default()
            },
        );

        assert_eq!(result.item.id, "item-1");
        assert_eq!(result.item.title, "Rust Notes");
        assert!(result.item.metadata.star);
        assert_eq!(result.item.metadata.tags, vec!["rust", "tauri"]);
        assert_eq!(result.item.metadata.aliases, vec!["rs", "cargo"]);

        match result.item.preview {
            Preview::Markdown { content } => {
                assert_eq!(content, "hello world");
            }
            _ => panic!("expected markdown preview"),
        }

        assert_eq!(result.score, 0.42);
    }

    #[test]
    fn maps_external_preview() {
        let conn = create_test_db();

        let result = map_test_search_result(
            &conn,
            TestSearchResultRow {
                id: "item-2".to_string(),
                title: "Tauri".to_string(),
                preview_type: "external".to_string(),
                preview_content: None,
                preview_url: Some("https://tauri.app".to_string()),
                rank: 1.0,
                tags_str: Some("rust tauri".to_string()),
                aliases_str: Some(String::new()),
                ..Default::default()
            },
        );

        match result.item.preview {
            Preview::External { url } => {
                assert_eq!(url, "https://tauri.app");
            }
            _ => panic!("expected external preview"),
        }
    }

    // -----------------------------
    // open action
    // -----------------------------

    #[test]
    fn maps_external_open_action() {
        let conn = create_test_db();

        let result = map_test_search_result(
            &conn,
            TestSearchResultRow {
                id: "item-3".to_string(),
                title: "Rust".to_string(),

                open_type: Some("external".to_string()),

                open_url: Some("https://rust-lang.org".to_string()),

                preview_content: Some("content".to_string()),

                tags_str: Some("rust tauri".to_string()),

                aliases_str: Some(String::new()),

                ..Default::default()
            },
        );

        match result.item.open {
            Some(OpenAction::External { url }) => {
                assert_eq!(url, "https://rust-lang.org");
            }

            _ => panic!("expected external open action"),
        }
    }

    #[test]
    fn maps_command_open_action() {
        let conn = create_test_db();

        let result = map_test_search_result(
            &conn,
            TestSearchResultRow {
                id: "item-4".to_string(),

                title: "Formatter".to_string(),

                open_type: Some("command".to_string()),

                open_command_path: Some("/usr/bin/fmt".to_string()),

                preview_content: Some("content".to_string()),

                tags_str: Some("cli format".to_string()),

                aliases_str: Some(String::new()),

                ..Default::default()
            },
        );

        match result.item.open {
            Some(OpenAction::Command { path }) => {
                assert_eq!(path, "/usr/bin/fmt");
            }

            _ => panic!("expected command open action"),
        }
    }
    #[test]
    fn maps_empty_tags() {
        let conn = create_test_db();

        let result = map_test_search_result(
            &conn,
            TestSearchResultRow {
                id: "item-4".to_string(),
                title: "Empty Tags".to_string(),
                preview_content: Some("content".to_string()),
                tags_str: Some(String::new()),
                aliases_str: Some(String::new()),
                ..Default::default()
            },
        );

        assert!(result.item.metadata.tags.is_empty());
    }

    #[test]
    fn maps_hidden_metadata() {
        let conn = create_test_db();

        let result = map_test_search_result(
            &conn,
            TestSearchResultRow {
                hidden: true,
                ..Default::default()
            },
        );

        assert!(result.item.metadata.hidden);
    }

    #[test]
    fn invalid_preview_type_falls_back_to_empty_local() {
        let conn = create_test_db();

        let result = map_test_search_result(
            &conn,
            TestSearchResultRow {
                id: "item-5".to_string(),
                title: "Broken".to_string(),
                preview_type: "unknown".to_string(),
                preview_content: None,
                preview_url: None,
                tags_str: Some("rust tauri".to_string()),
                aliases_str: Some(String::new()),
                ..Default::default()
            },
        );

        match result.item.preview {
            Preview::Markdown { content } => {
                assert_eq!(content, "");
            }
            _ => panic!("expected local preview"),
        }
    }
}
