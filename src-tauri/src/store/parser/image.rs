//! Image file parser.
//!
//! This module converts image files into searchable [`IndexItem`] values.
//!
//! Images are currently represented as Markdown image previews:
//!
//! ```markdown
//! ![filename](file:///path/to/image.png)
//! ```
//!
//! This approach allows the existing Markdown preview pipeline to render
//! images without introducing a dedicated image preview implementation.
//!
//! # Supported formats
//!
//! - png
//! - jpg
//! - jpeg
//! - gif
//! - webp
//! - bmp
//! - svg
//!
//! # Preview behavior
//!
//! Parsed image items use:
//!
//! ```text
//! Preview::Markdown
//! ```
//!
//! with a file URL inside Markdown image syntax.

use chrono::{DateTime, Utc};
use std::fs;
use std::path::Path;

use super::common::markdown_file_preview;
use crate::models::{IndexItem, Preview};
use crate::utils::path::source_path_string;

/// Parses an image file into an [`IndexItem`].
///
/// The preview is generated as a Markdown image:
///
/// ```markdown
/// ![image.png](file:///path/to/image.png)
/// ```
///
/// # Metadata
///
/// The generated item contains:
///
/// - Stable ID derived from the path.
/// - File name as the title.
/// - `image` tag.
/// - Source path for file opening.
///
/// # Preview
///
/// Images currently use:
///
/// ```text
/// Preview::Markdown
/// ```
///
/// allowing them to reuse the Markdown rendering pipeline.
///
/// # Notes
///
pub fn parse_image(path: &Path, source_id: &str) -> Option<IndexItem> {
    let metadata = fs::metadata(path).ok()?;
    let updated_at: DateTime<Utc> = metadata.modified().ok()?.into();
    let source_path = source_path_string(path);

    let title = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();

    let content = markdown_file_preview(path, &title);

    Some(
        IndexItem::new(
            source_id.to_string(),
            title,
            updated_at,
            Preview::Markdown { content },
        )
        .with_source_path(source_path)
        .with_tags(vec!["image".to_string()]),
    )
}

/// Returns whether a file extension is supported as an image.
///
/// Comparison is case-insensitive.
///
/// Supported extensions:
///
/// - png
/// - jpg
/// - jpeg
/// - gif
/// - webp
/// - bmp
/// - svg
pub fn is_image_extension(ext: &str) -> bool {
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Preview;

    use crate::test_utils::fixtures::unique_test_path;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = unique_test_path(&format!("glimpse-image-parser-test-{name}-"), "");
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn image_extension_is_case_insensitive() {
        assert!(is_image_extension("png"));
        assert!(is_image_extension("PNG"));
        assert!(is_image_extension("jpg"));
        assert!(is_image_extension("JPEG"));
        assert!(is_image_extension("webp"));
        assert!(is_image_extension("GIF"));
        assert!(is_image_extension("bmp"));
        assert!(is_image_extension("svg"));

        assert!(!is_image_extension("md"));
        assert!(!is_image_extension("json"));
        assert!(!is_image_extension("txt"));
    }

    #[test]
    fn parse_image_creates_markdown_preview() {
        let dir = temp_dir("basic");
        let path = dir.join("test.png");
        fs::write(&path, b"image").unwrap();
        let expected_updated_at: DateTime<Utc> =
            fs::metadata(&path).unwrap().modified().unwrap().into();

        let item = parse_image(&path, "notes/test.png").expect("image item should be created");

        assert_eq!(item.id, "notes/test.png");
        assert_eq!(item.title, "test.png");
        assert_eq!(item.updated_at, expected_updated_at);
        assert!(item.metadata.tags.contains(&"image".to_string()));

        match item.preview {
            Preview::Markdown { content } => {
                assert!(content.starts_with("![test.png]("));
                assert!(content.contains("test.png"));
                assert!(content.contains("file:///"));
            }
            _ => panic!("expected markdown preview"),
        }

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn parse_image_encodes_spaces_in_file_url() {
        let dir = temp_dir("spaces");
        let path = dir.join("test image.png");
        fs::write(&path, b"image").unwrap();

        let item = parse_image(&path, "notes/test.png").expect("image item should be created");

        match item.preview {
            Preview::Markdown { content } => {
                assert!(content.contains("![test image.png]("));
                assert!(content.contains("test%20image.png"));
            }
            _ => panic!("expected markdown preview"),
        }

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn markdown_file_preview_removes_windows_extended_prefix() {
        let path = PathBuf::from(r"\\?\C:\Example\test.png");

        assert_eq!(
            markdown_file_preview(&path, "test.png"),
            "![test.png](file:///C:/Example/test.png)"
        );
    }

    #[test]
    fn parse_image_escapes_markdown_alt_text() {
        let dir = temp_dir("alt");
        let path = dir.join("image [draft].png");
        fs::write(&path, b"image").unwrap();

        let item = parse_image(&path, "notes/test.png").expect("image item should be created");

        match item.preview {
            Preview::Markdown { content } => {
                assert!(content.starts_with("![image \\[draft\\].png]("));
            }
            _ => panic!("expected markdown preview"),
        }

        fs::remove_dir_all(dir).unwrap();
    }
}
