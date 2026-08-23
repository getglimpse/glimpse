//! Generic text file parser.
//!
//! This module provides a fallback parser for files that do not have a
//! dedicated parser implementation.
//!
//! The file contents are indexed and displayed as plain text using
//! [`Preview::Raw`].
//!
//! Typical targets include:
//!
//! - txt
//! - log
//! - cfg
//! - ini
//! - unsupported text-like files
//!
//! The parser intentionally performs no metadata extraction.
//! Files are indexed as-is.

use chrono::{DateTime, Utc};

use std::fs;
use std::path::Path;

use crate::models::{IndexItem, Preview};

/// Returns a display title for a raw file.
///
/// The title is resolved as:
///
/// 1. File name (`notes.txt`)
/// 2. Full path string as fallback
///
/// This function never fails.
fn raw_title(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string())
}

/// Parses a file into a raw preview [`IndexItem`].
///
/// This parser is intended as a fallback when no specialized parser
/// exists for the file type.
///
/// # Behavior
///
/// This function:
///
/// 1. Reads filesystem metadata.
/// 2. Uses the modification time as `updated_at`.
/// 3. Generates a stable item ID from the canonical path.
/// 4. Attempts to read the file as UTF-8 text.
/// 5. Creates a [`Preview::Raw`] item.
///
/// # Preview behavior
///
/// Raw files always generate:
///
/// ```text
/// Preview::Raw
/// ```
///
/// The preview content is displayed without Markdown rendering or
/// additional formatting.
///
/// # Read failures
///
/// If the file cannot be read as UTF-8 text, the parser still creates
/// an item with a fallback preview message:
///
/// ```text
/// Preview is not available for this file.
///
/// Path: ...
/// ```
///
/// This allows the file to remain searchable and accessible even when
/// preview generation is unavailable.
///
/// # ID strategy
///
/// The item ID is generated from the source ID instead of the absolute path.
///
/// # Returns
///
/// Returns `None` when:
///
/// - filesystem metadata cannot be read
/// - file modification time cannot be read
pub fn parse_raw_file(path: &Path, source_id: &str) -> Option<IndexItem> {
    let metadata = fs::metadata(path).ok()?;

    let updated_at: DateTime<Utc> = metadata.modified().ok()?.into();

    let source_path = fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();

    let content = fs::read_to_string(path).unwrap_or_else(|_| {
        format!(
            "Preview is not available for this file.\n\nPath: {}",
            path.display()
        )
    });

    Some(
        IndexItem::new(
            source_id.to_string(),
            raw_title(path),
            updated_at,
            Preview::Raw { content },
        )
        .with_source_path(source_path),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::env;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        let dir = env::temp_dir().join(format!("glimpse-raw-test-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn raw_title_uses_file_name() {
        let path = Path::new("/tmp/example.txt");

        assert_eq!(raw_title(path), "example.txt");
    }

    #[test]
    fn parse_raw_file_parses_text_file() {
        let dir = temp_dir("text");
        let path = dir.join("note.txt");

        fs::write(&path, "hello raw file").unwrap();

        let item = parse_raw_file(&path, "notes/note.txt").unwrap();

        let canonical = fs::canonicalize(&path)
            .unwrap()
            .to_string_lossy()
            .to_string();

        assert_eq!(item.id, "notes/note.txt");
        assert_eq!(item.title, "note.txt");
        assert_eq!(item.source_path.as_deref(), Some(canonical.as_str()));

        match item.preview {
            Preview::Raw { content } => {
                assert_eq!(content, "hello raw file");
            }
            _ => panic!("expected raw preview"),
        }

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn parse_raw_file_falls_back_when_content_is_not_utf8() {
        let dir = temp_dir("binary");
        let path = dir.join("binary.dat");

        fs::write(&path, [0xff, 0xfe, 0xfd]).unwrap();

        let item = parse_raw_file(&path, "notes/test.png").unwrap();

        match item.preview {
            Preview::Raw { content } => {
                assert!(content.contains("Preview is not available for this file."));
                assert!(content.contains(&path.display().to_string()));
            }
            _ => panic!("expected raw preview"),
        }

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn parse_raw_file_returns_none_for_missing_file() {
        let dir = temp_dir("missing");
        let path = dir.join("missing.txt");

        assert!(parse_raw_file(&path, "notes/test.png").is_none());

        fs::remove_dir_all(dir).unwrap();
    }
}
