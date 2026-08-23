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
//! # Open behavior
//!
//! Parsed image items use:
//!
//! ```text
//! OpenAction::External
//! ```
//!
//! so that the operating system opens the image using the default viewer.

use chrono::{DateTime, Utc};
use std::fs;
use std::path::{Path, PathBuf};
use url::Url;

use crate::models::{IndexItem, Preview};

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
/// - External open action.
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
    let source_path = std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();

    let title = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();

    let file_url = path_to_file_url(path);

    let content = format!("![{}]({})", escape_markdown_alt(&title), file_url);

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

/// Converts a filesystem path to a `file://` URL.
///
/// The resulting URL is used for:
///
/// - Markdown image previews
/// - External open actions
///
/// This function attempts to use [`Url::from_file_path`] first and falls
/// back to manual URL generation when conversion fails.
fn path_to_file_url(path: &Path) -> String {
    let normalized = normalize_windows_extended_path(path);

    Url::from_file_path(&normalized)
        .map(|url| url.to_string())
        .unwrap_or_else(|_| {
            let fallback = normalized.to_string_lossy().replace('\\', "/");

            if fallback.starts_with('/') {
                format!("file://{}", fallback)
            } else {
                format!("file:///{}", fallback)
            }
        })
}

/// Removes Windows extended path prefixes.
///
/// Examples:
///
/// ```text
/// \\?\C:\images\a.png
/// →
/// C:\images\a.png
/// ```
///
/// Non-Windows paths are returned unchanged.
fn normalize_windows_extended_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();

    let normalized = text
        .strip_prefix(r"\\?\")
        .or_else(|| text.strip_prefix("//?/"))
        .unwrap_or(&text);

    PathBuf::from(normalized)
}

/// Escapes characters that are special in Markdown image alt text.
///
/// Currently escapes:
///
/// - `[`
/// - `]`
fn escape_markdown_alt(text: &str) -> String {
    text.replace('[', "\\[").replace(']', "\\]")
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

    use std::env;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        let dir = env::temp_dir().join(format!("glimpse-image-parser-test-{name}-{nanos}"));
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
    fn path_to_file_url_removes_windows_extended_prefix() {
        let path = PathBuf::from(r"\\?\C:\Example\test.png");

        let url = path_to_file_url(&path);

        assert_eq!(url, "file:///C:/Example/test.png");
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
