//! Markdown file parser.
//!
//! This module converts a Markdown file into a single [`IndexItem`].
//!
//! Responsibilities:
//!
//! - Read Markdown file content.
//! - Extract Glimpse frontmatter metadata.
//! - Remove frontmatter from the preview body.
//! - Generate a stable item ID from the filesystem path.
//! - Build a searchable Markdown preview item.
//!
//! Frontmatter parsing is delegated to [`parse_frontmatter`].
//!
//! Markdown rendering itself is not performed here.
//! Rendering is handled later by the frontend preview layer.

use crate::models::{IndexItem, Preview};
use crate::search::SearchError;
use crate::store::parser::common::fallback_title;
use crate::store::parser::frontmatter::parse_frontmatter;
use crate::utils::command_open::sanitize_command;
use chrono::{DateTime, Utc};

use std::fs;
use std::path::Path;

/// Parses a Markdown file into an [`IndexItem`].
///
/// One Markdown file produces exactly one searchable item.
///
/// # Behavior
///
/// This parser:
///
/// 1. Reads the Markdown file.
/// 2. Reads filesystem metadata.
/// 3. Uses the file modification time as `updated_at`.
/// 4. Extracts frontmatter metadata.
/// 5. Removes frontmatter from the preview body.
/// 6. Generates a stable item ID.
/// 7. Builds an [`IndexItem`] with [`Preview::Markdown`].
///
/// # Supported frontmatter fields
///
/// Metadata is parsed from a leading YAML-like frontmatter block.
///
/// Supported fields include:
///
/// - `title`
/// - `tags`
/// - `aliases`
/// - `star`
/// - `hidden`
/// - `desc`
/// - `description`
/// - `url`
/// - `iframe`
/// - `command`
/// - `defaultAction`
///
/// Example:
///
/// ```markdown
/// ---
/// title: Rust Notes
/// tags:
///   - rust
///   - tauri
/// aliases: ["docs", "notes"]
/// star: true
/// ---
///
/// # Content
/// ```
///
/// # Title behavior
///
/// Title is resolved in this order:
///
/// 1. Frontmatter `title`
/// 2. File stem fallback via [`fallback_title`]
///
/// # ID strategy
///
/// The item ID is the source ID relative to the configured target directory.
/// Example:
///
/// ```text
/// notes/rust.md
/// ```
///
/// # Preview behavior
///
/// Markdown files generate:
///
/// ```text
/// Preview::Markdown
/// ```
///
/// The preview content contains the Markdown body after frontmatter removal.
/// Formatting and syntax highlighting are handled by the frontend.
///
/// # Actions
///
/// If frontmatter defines a command, it is sanitized before being attached to
/// the item. Invalid URLs are dropped during frontmatter parsing.
///
/// Unsafe commands may be dropped by [`sanitize_command`].
///
/// # Returns
///
/// Returns `None` when:
///
/// - file reading fails
/// - filesystem metadata cannot be read
/// - file modification time cannot be read
pub fn parse_markdown(path: &Path, source_id: &str) -> Option<IndexItem> {
    parse_markdown_result(path, source_id).ok()
}

/// Parses a Markdown file into an [`IndexItem`] with a concrete error.
pub fn parse_markdown_result(path: &Path, source_id: &str) -> Result<IndexItem, SearchError> {
    // -----------------------------
    // read file
    // -----------------------------

    let bytes = fs::read(path).map_err(SearchError::IoError)?;
    let content = String::from_utf8_lossy(&bytes);

    // -----------------------------
    // filesystem metadata
    // -----------------------------

    let metadata = fs::metadata(path).map_err(SearchError::IoError)?;

    let updated_at: DateTime<Utc> = metadata.modified().map_err(SearchError::IoError)?.into();

    // -----------------------------
    // frontmatter
    // -----------------------------

    let (fm, content_body) = parse_frontmatter(&content);
    let content_body = content_body.trim().to_string();

    // -----------------------------
    // title fallback
    // -----------------------------

    let display_title = fm.title.unwrap_or_else(|| fallback_title(path));

    // -----------------------------
    // source path
    // -----------------------------

    let source_path = fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();

    // -----------------------------
    // construct item
    // -----------------------------

    let use_iframe = fm.iframe && fm.url.is_some();
    let preview = if use_iframe {
        Preview::External {
            url: fm.url.clone().unwrap_or_default(),
        }
    } else {
        Preview::Markdown {
            content: content_body.clone(),
        }
    };
    let search_content = searchable_markdown_content(fm.desc.as_deref(), &content_body);

    let mut item = IndexItem::new(source_id.to_string(), display_title, updated_at, preview)
        .with_source_path(source_path)
        .set_star(fm.metadata.star)
        .set_hidden(fm.metadata.hidden)
        .with_tags(fm.metadata.tags)
        .with_aliases(fm.metadata.aliases);

    if let Some(url) = fm.url {
        item = item.with_url(url);
    }

    if let Some(command) = sanitize_command(fm.command) {
        item = item.with_command(command);
    }

    item = item.with_default_action(fm.default_action);

    if !search_content.is_empty() {
        item = item.with_search_content(search_content);
    }

    Ok(item)
}

fn searchable_markdown_content(desc: Option<&str>, body: &str) -> String {
    [desc.unwrap_or_default().trim(), body.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;

    use std::time::{SystemTime, UNIX_EPOCH};

    // -----------------------------
    // helper
    // -----------------------------

    fn create_temp_markdown(content: &str, filename: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        let path = std::env::temp_dir().join(format!("{}_{}.md", filename, unique));

        fs::write(&path, content).unwrap();

        path
    }

    // -----------------------------
    // title
    // -----------------------------

    #[test]
    fn parses_title_from_frontmatter() {
        let md = r#"---
title: Rust Notes
---

hello
"#;

        let path = create_temp_markdown(md, "title_test");

        let item = parse_markdown(&path, "notes/test.png").unwrap();

        assert_eq!(item.title, "Rust Notes");

        fs::remove_file(path).ok();
    }

    #[test]
    fn falls_back_to_filename_title() {
        let md = "# hello";

        let path = create_temp_markdown(md, "fallback_title");

        let item = parse_markdown(&path, "notes/test.png").unwrap();

        assert!(item.title.starts_with("fallback_title"));

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // tags
    // -----------------------------

    #[test]
    fn parses_tags() {
        let md = r#"---
tags:
  - rust
  - tauri
---

hello
"#;

        let path = create_temp_markdown(md, "tags_test");

        let item = parse_markdown(&path, "notes/test.png").unwrap();

        assert_eq!(item.metadata.tags, vec!["rust", "tauri",]);

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // star
    // -----------------------------

    #[test]
    fn parses_star() {
        let md = r#"---
star: true
---

hello
"#;

        let path = create_temp_markdown(md, "star_test");

        let item = parse_markdown(&path, "notes/test.png").unwrap();

        assert!(item.metadata.star);

        fs::remove_file(path).ok();
    }

    #[test]
    fn parses_hidden() {
        let md = r#"---
hidden: true
---

hello
"#;

        let path = create_temp_markdown(md, "hidden_test");

        let item = parse_markdown(&path, "notes/test.png").unwrap();

        assert!(item.metadata.hidden);

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // preview
    // -----------------------------

    #[test]
    fn creates_local_preview() {
        let md = r#"
# hello
"#;

        let path = create_temp_markdown(md, "preview_test");

        let item = parse_markdown(&path, "notes/test.png").unwrap();

        match item.preview {
            Preview::Markdown { content } => {
                assert_eq!(content, "# hello");
            }

            _ => panic!("expected local preview"),
        }

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // content extraction
    // -----------------------------

    #[test]
    fn removes_frontmatter_from_preview() {
        let md = r#"---
title: test
tags:
  - rust
---

# content
"#;

        let path = create_temp_markdown(md, "body_test");

        let item = parse_markdown(&path, "notes/test.png").unwrap();

        match item.preview {
            Preview::Markdown { content } => {
                assert_eq!(content, "# content");
            }

            _ => panic!("expected local preview"),
        }

        fs::remove_file(path).ok();
    }

    #[test]
    fn parses_markdown_with_unrelated_yaml_attributes() {
        let md = r#"---
created: 2026-08-04
description: |
  title: Wrong Title
  star: true
cssclasses:
  - daily-note
title: Real Title
tags:
  - rust
---

# content
"#;

        let path = create_temp_markdown(md, "unknown_yaml_test");

        let item = parse_markdown(&path, "notes/test.md").unwrap();

        assert_eq!(item.title, "Real Title");
        assert_eq!(item.metadata.tags, vec!["rust"]);
        assert!(!item.metadata.star);

        match item.preview {
            Preview::Markdown { content } => {
                assert_eq!(content, "# content");
            }

            _ => panic!("expected markdown preview"),
        }

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // id
    // -----------------------------

    #[test]
    fn uses_source_id_as_item_id() {
        let md = "# hello";

        let path = create_temp_markdown(md, "id_test");

        let item = parse_markdown(&path, "notes/id_test.md").unwrap();

        let canonical = fs::canonicalize(&path)
            .unwrap()
            .to_string_lossy()
            .to_string();

        assert_eq!(item.id, "notes/id_test.md");
        assert_eq!(item.source_path.as_deref(), Some(canonical.as_str()));

        fs::remove_file(path).ok();
    }

    // -----------------------------
    // invalid path
    // -----------------------------

    #[test]
    fn missing_file_returns_none() {
        let path = Path::new("/definitely/missing/file.md");

        let item = parse_markdown(path, "notes/test.png");

        assert!(item.is_none());
    }

    #[test]
    fn parses_command_action() {
        let md = r#"---
title: Open Notepad
command: C:\Windows\System32\notepad.exe
---

# Open Notepad
"#;

        let path = create_temp_markdown(md, "command_open_test");

        let item = parse_markdown(&path, "notes/test.png").unwrap();

        assert_eq!(
            item.command.as_deref(),
            Some(r#"C:\Windows\System32\notepad.exe"#)
        );
        assert_eq!(
            item.default_action,
            Some(crate::models::DefaultAction::Command)
        );

        fs::remove_file(path).ok();
    }

    #[test]
    fn parses_url_action_with_iframe_preview() {
        let md = r#"---
title: Rust
url: https://www.rust-lang.org
iframe: true
---

# Rust
"#;

        let path = create_temp_markdown(md, "external_open_test");

        let item = parse_markdown(&path, "notes/test.png").unwrap();

        assert_eq!(item.url.as_deref(), Some("https://www.rust-lang.org/"));
        assert_eq!(item.default_action, Some(crate::models::DefaultAction::Url));

        match item.preview {
            Preview::External { url } => {
                assert_eq!(url, "https://www.rust-lang.org/");
            }
            _ => panic!("expected external preview"),
        }

        assert_eq!(item.search_content.as_deref(), Some("# Rust"));

        fs::remove_file(path).ok();
    }
}
