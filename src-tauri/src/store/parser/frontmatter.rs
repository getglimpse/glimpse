//! Lightweight frontmatter parser for Markdown indexing.
//!
//! This module extracts Glimpse metadata from Markdown frontmatter and
//! returns the remaining Markdown body.
//!
//! Supported fields:
//!
//! - `title`
//! - `tags`
//! - `aliases`
//! - `star`
//! - `hidden`
//! - `desc` / `description`
//! - `url`
//! - `iframe`
//! - `command`
//! - `defaultAction`
//!
//! Supported list syntaxes:
//!
//! ```yaml
//! tags: ["rust", "tauri"]
//! aliases:
//!   - docs
//!   - note
//! ```
//!
//! This parser intentionally supports only a small YAML-like subset.
//! It does not aim to be a complete YAML parser.

use crate::{
    models::{DefaultAction, IndexMetadata},
    store::parser::common::{normalize_http_url, normalize_string_vec, unquote},
};

/// Parsed Markdown frontmatter metadata.
///
/// `Frontmatter` represents metadata extracted from the leading
/// `--- ... ---` block of a Markdown file.
///
/// The Markdown body is returned separately by [`parse_frontmatter`].
#[derive(Debug, Default)]
pub struct Frontmatter {
    /// Optional display title override.
    ///
    /// If omitted, the Markdown parser usually falls back to the file name.
    pub title: Option<String>,

    /// Search and ranking metadata.
    ///
    /// Includes fields such as:
    ///
    /// - tags
    /// - aliases
    /// - starred state
    /// - hidden state
    pub metadata: IndexMetadata,

    /// Optional searchable description.
    pub desc: Option<String>,

    /// Optional item URL.
    pub url: Option<String>,

    /// Whether the URL should be shown as an iframe preview.
    pub iframe: bool,

    /// Optional item command.
    pub command: Option<String>,

    /// Optional explicit default action.
    pub default_action: Option<DefaultAction>,
}

/// Active multiline list parser state.
///
/// Used while parsing block-style metadata lists:
///
/// ```yaml
/// tags:
///   - rust
///   - tauri
/// ```
enum ActiveList {
    /// Currently parsing `tags:`.
    Tags,

    /// Currently parsing `aliases:`.
    Aliases,
}

/// Splits a leading frontmatter block into YAML text and Markdown body.
///
/// The closing delimiter must occupy its own line. This keeps unrelated YAML
/// values containing `---` from accidentally truncating the frontmatter block.
fn split_frontmatter(content: &str) -> Option<(&str, &str)> {
    let yaml_start = if content.starts_with("---\n") {
        4
    } else if content.starts_with("---\r\n") {
        5
    } else {
        return None;
    };

    let mut offset = 0;

    for line in content[yaml_start..].split_inclusive('\n') {
        if is_closing_delimiter_line(line) {
            let end_idx = yaml_start + offset;
            let body_start = end_idx + line.len();

            return Some((&content[yaml_start..end_idx], &content[body_start..]));
        }

        offset += line.len();
    }

    let tail = &content[yaml_start + offset..];

    if is_closing_delimiter_line(tail) {
        let end_idx = yaml_start + offset;

        return Some((&content[yaml_start..end_idx], ""));
    }

    None
}

fn is_closing_delimiter_line(line: &str) -> bool {
    let line = line.trim_end_matches(|ch| ch == '\r' || ch == '\n');

    !line.starts_with(' ') && !line.starts_with('\t') && line.trim_end() == "---"
}

/// Returns whether a raw frontmatter line is top-level YAML.
fn is_top_level(raw_line: &str) -> bool {
    match raw_line.chars().next() {
        Some(ch) => ch != ' ' && ch != '\t',
        None => true,
    }
}

/// Parses an inline metadata list.
///
/// Supported syntax:
///
/// ```yaml
/// tags: rust
/// tags: ["rust", "tauri"]
/// aliases: docs
/// aliases: ["docs", "note"]
/// ```
///
/// Returns `None` when the line does not match the requested key.
fn parse_inline_list(line: &str, key: &str) -> Option<Vec<String>> {
    let prefix = format!("{}:", key);

    if !line.starts_with(&prefix) {
        return None;
    }

    let value = line.trim_start_matches(&prefix).trim();

    if value.is_empty() {
        return None;
    }

    if !(value.starts_with('[') && value.ends_with(']')) {
        let value = unquote(value).to_string();

        return (!value.is_empty()).then_some(vec![value]);
    }

    let inner = value.trim_start_matches('[').trim_end_matches(']');

    Some(
        inner
            .split(',')
            .map(|s| unquote(s.trim()).to_string())
            .filter(|s| !s.is_empty())
            .collect(),
    )
}

/// Parses one block-style list item.
///
/// Supported syntax:
///
/// ```yaml
/// - rust
/// - "tauri"
/// - 'docs'
/// ```
///
/// Returns `None` for non-list lines or empty list values.
fn parse_block_list_item(line: &str) -> Option<String> {
    if !line.starts_with("- ") {
        return None;
    }

    let value = unquote(line.trim_start_matches("- ").trim());

    if value.is_empty() {
        return None;
    }

    Some(value.to_string())
}

fn parse_bool(value: &str) -> bool {
    let normalized = strip_inline_comment(value.trim());

    unquote(normalized).eq_ignore_ascii_case("true")
}

fn strip_inline_comment(value: &str) -> &str {
    let mut in_single_quote = false;
    let mut in_double_quote = false;

    for (index, ch) in value.char_indices() {
        match ch {
            '\'' if !in_double_quote => {
                in_single_quote = !in_single_quote;
            }
            '"' if !in_single_quote => {
                in_double_quote = !in_double_quote;
            }
            '#' if !in_single_quote && !in_double_quote && starts_inline_comment(value, index) => {
                return value[..index].trim_end();
            }
            _ => {}
        }
    }

    value
}

fn starts_inline_comment(value: &str, index: usize) -> bool {
    if index == 0 {
        return true;
    }

    match value[..index].chars().last() {
        Some(ch) => ch.is_whitespace(),
        None => true,
    }
}

/// Parses Markdown frontmatter and returns the remaining Markdown body.
///
/// If the content does not start with a frontmatter block, this function
/// returns default metadata and the original content unchanged.
///
/// Supported syntax:
///
/// - Leading `--- ... ---` block
/// - Scalar fields such as `title:` and `star:`
/// - Inline lists such as `tags: ["rust", "tauri"]`
/// - Block-style lists such as `tags:` followed by `- item`
/// - Simple actions using `url`, `command`, and `defaultAction`
///
/// # Return value
///
/// Returns a tuple of:
///
/// 1. Parsed [`Frontmatter`]
/// 2. Markdown body without the frontmatter block
///
/// # Example
///
/// ```markdown
/// ---
/// title: Rust Docs
/// tags:
///   - rust
///   - tauri
/// aliases: ["docs", "notes"]
/// star: true
/// ---
///
/// # Hello
/// ```
///
/// The returned body starts at `# Hello`.
///
/// # Notes
///
/// This is a lightweight parser, not a full YAML parser.
/// Unsupported or malformed fields are ignored.
pub fn parse_frontmatter(content: &str) -> (Frontmatter, &str) {
    let mut fm = Frontmatter::default();

    // -----------------------------
    // frontmatter boundaries
    // -----------------------------

    let Some((yaml_block, body)) = split_frontmatter(content) else {
        return (fm, content);
    };

    // -----------------------------
    // parse yaml-ish block
    // -----------------------------

    let mut active_list: Option<ActiveList> = None;

    for raw_line in yaml_block.lines() {
        let line = raw_line.trim();
        let top_level = is_top_level(raw_line);

        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // -----------------------------
        // multiline list continuation
        // -----------------------------

        if let Some(active) = &active_list {
            if let Some(value) = parse_block_list_item(line) {
                match active {
                    ActiveList::Tags => {
                        fm.metadata.tags.push(value);
                    }

                    ActiveList::Aliases => {
                        fm.metadata.aliases.push(value);
                    }
                }

                continue;
            } else {
                active_list = None;
            }
        }

        if !top_level {
            continue;
        }

        // -----------------------------
        // star
        // -----------------------------

        if line.starts_with("star:") {
            if line
                .split_once(':')
                .map(|(_, value)| parse_bool(value))
                .unwrap_or(false)
            {
                fm.metadata.star = true;
            }

            continue;
        }

        // -----------------------------
        // hidden
        // -----------------------------

        if line.starts_with("hidden:") {
            if line
                .split_once(':')
                .map(|(_, value)| parse_bool(value))
                .unwrap_or(false)
            {
                fm.metadata.hidden = true;
            }

            continue;
        }

        // -----------------------------
        // title
        // -----------------------------

        if line.starts_with("title:") {
            let parsed_title = unquote(line.trim_start_matches("title:").trim());

            if !parsed_title.is_empty() {
                fm.title = Some(parsed_title.to_string());
            }

            continue;
        }

        // -----------------------------
        // description
        // -----------------------------

        if line.starts_with("description:") {
            let value = unquote(line.trim_start_matches("description:").trim());

            if !value.is_empty() {
                fm.desc = Some(value.to_string());
            }

            continue;
        }

        if line.starts_with("desc:") {
            let value = unquote(line.trim_start_matches("desc:").trim());

            if !value.is_empty() && fm.desc.is_none() {
                fm.desc = Some(value.to_string());
            }

            continue;
        }

        // -----------------------------
        // actions
        // -----------------------------

        if line.starts_with("url:") {
            let value = unquote(line.trim_start_matches("url:").trim());

            if let Some(url) = normalize_http_url(value) {
                fm.url = Some(url);
            }

            continue;
        }

        if line.starts_with("iframe:") {
            fm.iframe = line
                .split_once(':')
                .map(|(_, value)| parse_bool(value))
                .unwrap_or(false);

            continue;
        }

        if line.starts_with("command:") {
            let value = unquote(line.trim_start_matches("command:").trim());

            if !value.is_empty() {
                fm.command = Some(value.to_string());
            }

            continue;
        }

        if line.starts_with("defaultAction:") || line.starts_with("default_action:") {
            let value = line
                .split_once(':')
                .map(|(_, value)| unquote(value.trim()))
                .unwrap_or_default();

            fm.default_action = match value {
                "url" => Some(DefaultAction::Url),
                "command" => Some(DefaultAction::Command),
                _ => None,
            };

            continue;
        }

        // -----------------------------
        // inline tags
        // -----------------------------

        if let Some(tags) = parse_inline_list(line, "tags") {
            fm.metadata.tags.extend(tags);
            continue;
        }

        // -----------------------------
        // inline aliases
        // -----------------------------

        if let Some(aliases) = parse_inline_list(line, "aliases") {
            fm.metadata.aliases.extend(aliases);

            continue;
        }

        // -----------------------------
        // multiline list start
        // -----------------------------

        if line == "tags:" {
            active_list = Some(ActiveList::Tags);

            continue;
        }

        if line == "aliases:" {
            active_list = Some(ActiveList::Aliases);

            continue;
        }
    }

    // -----------------------------
    // normalization
    // -----------------------------

    normalize_string_vec(&mut fm.metadata.tags);
    normalize_string_vec(&mut fm.metadata.aliases);

    (fm, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------
    // title
    // -----------------------------

    #[test]
    fn parses_title() {
        let input = r#"---
title: Rust Book
---
hello
"#;

        let (fm, body) = parse_frontmatter(input);

        assert_eq!(fm.title, Some("Rust Book".to_string()));

        assert_eq!(body.trim(), "hello");
    }

    // -----------------------------
    // star
    // -----------------------------

    #[test]
    fn parses_star_true() {
        let input = r#"---
star: true
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert!(fm.metadata.star);
    }

    #[test]
    fn star_defaults_to_false() {
        let input = r#"---
title: test
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert!(!fm.metadata.star);
    }

    #[test]
    fn ignores_legacy_pinned() {
        let input = r#"---
pinned: true
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert!(!fm.metadata.star);
    }

    #[test]
    fn parses_hidden_true() {
        let input = r#"---
hidden: true
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert!(fm.metadata.hidden);
    }

    #[test]
    fn parses_boolean_values_with_inline_comments() {
        let input = r#"---
star: true # favorite
hidden: true # hide from normal search
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert!(fm.metadata.star);
        assert!(fm.metadata.hidden);
    }

    #[test]
    fn ignores_hash_inside_quoted_boolean_values() {
        let input = r#"---
star: "true # not a comment"
hidden: 'true # not a comment'
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert!(!fm.metadata.star);
        assert!(!fm.metadata.hidden);
    }

    #[test]
    fn does_not_treat_hash_without_separator_as_boolean_comment() {
        let input = r#"---
star: true#not-comment
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert!(!fm.metadata.star);
    }

    #[test]
    fn hidden_defaults_to_false() {
        let input = r#"---
title: test
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert!(!fm.metadata.hidden);
    }

    // -----------------------------
    // inline tags
    // -----------------------------

    #[test]
    fn parses_inline_tags() {
        let input = r#"---
tags: ["rust", "tauri"]
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert_eq!(fm.metadata.tags, vec!["rust", "tauri",]);
    }

    #[test]
    fn parses_single_inline_tag() {
        let input = r#"---
tags: rust
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert_eq!(fm.metadata.tags, vec!["rust"]);
    }

    #[test]
    fn parses_inline_tags_with_single_quotes() {
        let input = r#"---
tags: ['rust', 'tauri']
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert_eq!(fm.metadata.tags, vec!["rust", "tauri",]);
    }

    #[test]
    fn parses_single_inline_alias() {
        let input = r#"---
aliases: rs
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert_eq!(fm.metadata.aliases, vec!["rs"]);
    }

    // -----------------------------
    // block tags
    // -----------------------------

    #[test]
    fn parses_block_tags() {
        let input = r#"---
tags:
  - rust
  - tauri
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert_eq!(fm.metadata.tags, vec!["rust", "tauri",]);
    }

    #[test]
    fn parses_block_tags_with_quotes() {
        let input = r#"---
tags:
  - "rust"
  - 'tauri'
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert_eq!(fm.metadata.tags, vec!["rust", "tauri",]);
    }

    // -----------------------------
    // normalization
    // -----------------------------

    #[test]
    fn normalizes_duplicate_tags() {
        let input = r#"---
tags:
  - rust
  - tauri
  - rust
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert_eq!(fm.metadata.tags, vec!["rust", "tauri",]);
    }

    // -----------------------------
    // body extraction
    // -----------------------------

    #[test]
    fn extracts_body() {
        let input = r#"---
title: test
---

# hello
world
"#;

        let (_, body) = parse_frontmatter(input);

        assert_eq!(body.trim(), "# hello\nworld");
    }

    // -----------------------------
    // no frontmatter
    // -----------------------------

    #[test]
    fn returns_original_without_frontmatter() {
        let input = "# hello";

        let (fm, body) = parse_frontmatter(input);

        assert!(fm.metadata.tags.is_empty());

        assert_eq!(body, input);
    }

    // -----------------------------
    // malformed frontmatter
    // -----------------------------

    #[test]
    fn malformed_frontmatter_returns_original() {
        let input = r#"---
title: broken
tags:
  - rust
"#;

        let (fm, body) = parse_frontmatter(input);

        assert!(fm.metadata.tags.is_empty());

        assert_eq!(body, input);
    }

    #[test]
    fn ignores_unknown_frontmatter_fields() {
        let input = r#"---
created: 2026-08-04
cssclasses:
  - daily-note
title: Rust Book
tags:
  - rust
---
hello
"#;

        let (fm, body) = parse_frontmatter(input);

        assert_eq!(fm.title, Some("Rust Book".to_string()));
        assert_eq!(fm.metadata.tags, vec!["rust"]);
        assert_eq!(body.trim(), "hello");
    }

    #[test]
    fn ignores_known_names_inside_unknown_nested_fields() {
        let input = r#"---
external:
  title: Wrong Title
  star: true
  hidden: true
title: Real Title
---
hello
"#;

        let (fm, _) = parse_frontmatter(input);

        assert_eq!(fm.title, Some("Real Title".to_string()));
        assert!(!fm.metadata.star);
        assert!(!fm.metadata.hidden);
    }

    #[test]
    fn ignores_known_names_inside_unknown_multiline_fields() {
        let input = r#"---
description: |
  title: Wrong Title
  star: true
star: not true
hidden: truthy
title: Real Title
---
hello
"#;

        let (fm, _) = parse_frontmatter(input);

        assert_eq!(fm.title, Some("Real Title".to_string()));
        assert!(!fm.metadata.star);
        assert!(!fm.metadata.hidden);
    }

    #[test]
    fn ignores_indented_dashes_inside_unknown_multiline_fields() {
        let input = r#"---
description: |
  ---
  not a frontmatter delimiter
title: Real Title
---
hello
"#;

        let (fm, body) = parse_frontmatter(input);

        assert_eq!(fm.title, Some("Real Title".to_string()));
        assert_eq!(body.trim(), "hello");
    }

    #[test]
    fn parses_command_action() {
        let input = r#"---
title: Open Notepad
command: C:\Windows\System32\notepad.exe
defaultAction: command
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert_eq!(
            fm.command.as_deref(),
            Some(r#"C:\Windows\System32\notepad.exe"#)
        );
        assert_eq!(fm.default_action, Some(DefaultAction::Command));
    }

    #[test]
    fn parses_url_action() {
        let input = r#"---
title: Rust
url: https://www.rust-lang.org
iframe: true
defaultAction: url
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert_eq!(fm.url.as_deref(), Some("https://www.rust-lang.org/"));
        assert!(fm.iframe);
        assert_eq!(fm.default_action, Some(DefaultAction::Url));
    }

    #[test]
    fn description_wins_over_desc() {
        let input = r#"---
desc: short
description: long
---
"#;

        let (fm, _) = parse_frontmatter(input);

        assert_eq!(fm.desc.as_deref(), Some("long"));
    }
}
