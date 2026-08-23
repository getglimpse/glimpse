//! Shared utilities for filesystem parsers.
//!
//! This module contains helper functions used by multiple parsers in
//! `store::parser`.
//!
//! Responsibilities:
//!
//! - Generate fallback titles from file paths.
//! - Normalize metadata collections such as tags.
//! - Parse quoted string values.
//!
//! The functions in this module should remain:
//!
//! - Stateless
//! - Allocation-friendly where possible
//! - Independent from parser implementations
//!
//! Parser-specific logic belongs to the individual parser modules
//! (`markdown.rs`, `json.rs`, `image.rs`, etc.).

use std::path::Path;

/// Returns a fallback title from a filesystem path.
///
/// Used when metadata does not provide an explicit title.
///
/// Common cases:
///
/// - Markdown frontmatter does not contain `title`.
/// - JSON metadata does not contain `title`.
/// - The title field is empty.
///
/// Fallback order:
///
/// 1. File stem (`README.md` → `README`)
/// 2. `"Untitled"`
///
/// # Examples
///
/// ```text
/// notes/rust.md -> rust
/// README        -> README
/// ```
pub fn fallback_title(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

/// Sorts and deduplicates a vector of strings.
///
/// Primarily used for metadata collections such as:
///
/// - tags
/// - aliases
///
/// Normalization rules:
///
/// - Lexicographical sort.
/// - Duplicate removal.
/// - Keeps original casing.
///
/// # Example
///
/// Before:
///
/// ```text
/// ["rust", "tauri", "rust"]
/// ```
///
/// After:
///
/// ```text
/// ["rust", "tauri"]
/// ```
pub fn normalize_string_vec(strs: &mut Vec<String>) {
    strs.sort();
    strs.dedup();
}

/// Removes surrounding quote characters from a string slice.
///
/// Supported quote styles:
///
/// - Double quotes: `"example"`
/// - Single quotes: `'example'`
///
/// If the input is not quoted, it is returned unchanged.
///
/// # Examples
///
/// ```text
/// "rust"   -> rust
/// 'tauri'  -> tauri
/// glimpse  -> glimpse
/// ```
pub fn unquote(input: &str) -> &str {
    input.trim_matches('"').trim_matches('\'')
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::Path;

    // -----------------------------
    // fallback_title
    // -----------------------------

    #[test]
    fn fallback_title_returns_filename_stem() {
        let path = Path::new("/tmp/rust-book.md");

        let title = fallback_title(path);

        assert_eq!(title, "rust-book");
    }

    #[test]
    fn fallback_title_without_extension() {
        let path = Path::new("/tmp/README");

        let title = fallback_title(path);

        assert_eq!(title, "README");
    }

    // -----------------------------
    // normalize_string_vec
    // -----------------------------

    #[test]
    fn normalize_string_vec_sorts_and_dedups() {
        let mut tags = vec!["tauri".to_string(), "rust".to_string(), "rust".to_string()];

        normalize_string_vec(&mut tags);

        assert_eq!(tags, vec!["rust", "tauri",]);
    }

    #[test]
    fn normalize_string_vec_empty() {
        let mut tags = Vec::new();

        normalize_string_vec(&mut tags);

        assert!(tags.is_empty());
    }

    // -----------------------------
    // unquote
    // -----------------------------

    #[test]
    fn unquote_double_quotes() {
        assert_eq!(unquote("\"rust\""), "rust");
    }

    #[test]
    fn unquote_single_quotes() {
        assert_eq!(unquote("'tauri'"), "tauri");
    }

    #[test]
    fn unquote_without_quotes() {
        assert_eq!(unquote("glimpse"), "glimpse");
    }

    #[test]
    fn unquote_empty_string() {
        assert_eq!(unquote(""), "");
    }
}
