//! Lightweight file reference parser.
//!
//! This parser creates searchable items for files that should be discoverable
//! but should not be read into memory during indexing, such as PDFs and media
//! files. Native file URL formats are represented as Markdown image syntax;
//! plugin-viewed formats use a small raw placeholder so viewer plugins can
//! take over without indexing the file body.

use chrono::{DateTime, Utc};
use std::fs;
use std::path::{Path, PathBuf};
use url::Url;

use crate::models::{IndexItem, Preview};
use crate::utils::path::metadata_only_file_category;

/// Parses a file into a lightweight searchable reference.
///
/// The parser reads only filesystem metadata and never reads the file body.
pub fn parse_file_reference(path: &Path, source_id: &str) -> Option<IndexItem> {
    let metadata = fs::metadata(path).ok()?;
    let updated_at: DateTime<Utc> = metadata.modified().ok()?.into();
    let source_path = fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();
    let title = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string());
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase());
    let category = extension
        .as_deref()
        .and_then(metadata_only_file_category)
        .unwrap_or("file");
    let mut tags = vec![category.to_string()];

    if let Some(extension) = extension {
        tags.push(extension);
    }

    let preview = if is_native_file_url_preview_category(category) {
        let file_url = path_to_file_url(path);
        let content = format!("![{}]({})", escape_markdown_alt(&title), file_url);

        Preview::Markdown { content }
    } else {
        Preview::Raw {
            content: format!(
                "Preview is handled by a file viewer when available.\n\nPath: {}",
                source_path
            ),
        }
    };

    Some(
        IndexItem::new(source_id.to_string(), title, updated_at, preview)
            .with_source_path(source_path)
            .with_tags(tags),
    )
}

fn is_native_file_url_preview_category(category: &str) -> bool {
    matches!(category, "pdf" | "audio" | "video")
}

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

fn normalize_windows_extended_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    let normalized = text
        .strip_prefix(r"\\?\")
        .or_else(|| text.strip_prefix("//?/"))
        .unwrap_or(&text);

    PathBuf::from(normalized)
}

fn escape_markdown_alt(text: &str) -> String {
    text.replace('[', "\\[").replace(']', "\\]")
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::models::Preview;

    use std::env;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        let dir = env::temp_dir().join(format!("glimpse-file-ref-test-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parse_file_reference_does_not_read_file_body() {
        let dir = temp_dir("video");
        let path = dir.join("movie.mp4");

        fs::write(&path, vec![0xff; 1024]).unwrap();

        let item = parse_file_reference(&path, "Default/0/movie.mp4").unwrap();

        assert_eq!(item.id, "Default/0/movie.mp4");
        assert_eq!(item.title, "movie.mp4");
        assert!(item.metadata.tags.contains(&"video".to_string()));
        assert!(item.metadata.tags.contains(&"mp4".to_string()));

        match item.preview {
            Preview::Markdown { content } => {
                assert!(content.starts_with("![movie.mp4]("));
                assert!(content.contains("movie.mp4"));
                assert!(content.contains("file:///"));
            }
            _ => panic!("expected markdown preview"),
        }

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn parse_file_reference_uses_raw_placeholder_for_plugin_viewed_documents() {
        let dir = temp_dir("office");
        let path = dir.join("report.docx");

        fs::write(&path, vec![0xff; 1024]).unwrap();

        let item = parse_file_reference(&path, "Default/0/report.docx").unwrap();

        assert_eq!(item.title, "report.docx");
        assert!(item.metadata.tags.contains(&"document".to_string()));
        assert!(item.metadata.tags.contains(&"docx".to_string()));

        match item.preview {
            Preview::Raw { content } => {
                assert!(content.contains("Preview is handled by a file viewer"));
                assert!(content.contains("report.docx"));
            }
            _ => panic!("expected raw preview"),
        }

        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn path_to_file_url_removes_windows_extended_prefix() {
        let path = PathBuf::from(r"\\?\C:\Example\demo.mp4");

        assert_eq!(path_to_file_url(&path), "file:///C:/Example/demo.mp4");
    }
}
