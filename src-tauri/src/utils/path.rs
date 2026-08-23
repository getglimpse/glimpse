//! Filesystem path utilities used by indexing and watching.
//!
//! This module centralizes path-related checks used before files are parsed
//! and stored in the search index.
//!
//! Responsibilities:
//!
//! - Generate stable path IDs.
//! - Detect hidden files and directories.
//! - Apply indexing ignore rules.
//! - Exclude internal Glimpse files.
//! - Exclude large files.
//! - Exclude symbolic links.
//! - Exclude configured file extensions.
//!
//! The main entrypoint is [`should_index_path`].
//!
//! Filtering rules are intentionally kept here so that initial scanning and
//! realtime filesystem watching use the same behavior.

use globset::{Glob, GlobSetBuilder};

use crate::models::settings::IndexingSettings;

use std::fs;
use std::path::{Path, PathBuf};

/// Returns true if the file or directory is hidden.
///
/// A hidden path is currently defined as:
///
/// - filename starts with `.`
pub fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .map(|name| name.to_string_lossy().starts_with('.'))
        .unwrap_or(false)
}

/// Generates a stable source ID relative to a target directory.
///
/// Examples:
///
/// ```text
/// target: C:\Workspace
/// path:   C:\Workspace\notes\rust.md
/// → notes/rust.md
///
/// target: /home/user/workspace
/// path:   /home/user/workspace/docs/api.gjson
/// → docs/api.gjson
/// ```
///
/// The returned ID is independent of the absolute filesystem location,
/// making it suitable for synchronization across different operating
/// systems and machines.
pub fn source_id_for_path(
    group_name: &str,
    target_index: usize,
    root: &Path,
    path: &Path,
) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);

    let relative = relative
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");

    format!("{group_name}/{target_index}/{relative}")
}

/// Returns true if the path extension is excluded by settings.
///
/// Extension matching is case-insensitive.
///
/// Examples:
///
/// ```text
/// app.exe + ["exe"] -> true
/// APP.EXE + ["exe"] -> true
/// notes.md + ["exe"] -> false
/// ```
pub fn is_excluded_extension(path: &Path, excluded_extensions: &[String]) -> bool {
    let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
        return false;
    };

    excluded_extensions
        .iter()
        .any(|excluded| excluded.eq_ignore_ascii_case(ext))
}

/// Returns true when an extension should be indexed as a lightweight file item.
///
/// These files can be useful in search and previewed by file URL renderers, but
/// their contents should not be read into memory during indexing.
pub fn is_metadata_only_file_extension(ext: &str) -> bool {
    metadata_only_file_category(ext).is_some()
}

/// Returns the broad category for metadata-only indexed file extensions.
pub fn metadata_only_file_category(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "pdf" => Some("pdf"),
        "doc" | "docm" | "docx" | "dotm" | "dotx" => Some("document"),
        "xls" | "xlsm" | "xlsx" | "xltm" | "xltx" => Some("spreadsheet"),
        "potm" | "potx" | "pps" | "ppsm" | "ppsx" | "ppt" | "pptm" | "pptx" => Some("presentation"),
        "aac" | "aif" | "aiff" | "flac" | "m4a" | "mp3" | "ogg" | "opus" | "wav" | "weba" => {
            Some("audio")
        }
        "avi" | "flv" | "m4v" | "mkv" | "mov" | "mp4" | "mpeg" | "mpg" | "ogv" | "webm" | "wmv" => {
            Some("video")
        }
        _ => None,
    }
}

fn is_metadata_only_file_path(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(is_metadata_only_file_extension)
}

/// Returns the directory associated with a path.
///
/// - If `path` is a directory, returns the path itself.
/// - If `path` is a file, returns its parent directory.
pub fn parent_dir(path: impl AsRef<Path>) -> Option<PathBuf> {
    let path = path.as_ref();

    if path.is_dir() {
        return Some(path.to_path_buf());
    }

    path.parent().map(|parent| parent.to_path_buf())
}

/// Returns true if the path should be indexed.
///
/// Filtering rules:
///
/// - Exclude internal `.glimpse` paths.
/// - Exclude non-file and non-directory paths.
/// - Exclude hidden paths when enabled.
/// - Exclude configured ignore patterns.
/// - Exclude files larger than the configured size limit.
/// - Exclude symbolic links.
/// - Exclude configured file extensions.
pub fn should_index_path(path: &Path, settings: &IndexingSettings) -> bool {
    if path.components().any(|c| c.as_os_str() == ".glimpse") {
        return false;
    }

    if !path.is_file() && !path.is_dir() {
        return false;
    }
    // -----------------------------
    // hidden files
    // -----------------------------

    if settings.ignore_hidden_files && is_hidden(path) {
        return false;
    }

    // -----------------------------
    // ignore patterns
    // -----------------------------

    if matches_ignore_patterns(path, &settings.ignore_patterns) {
        return false;
    }

    let metadata_only_file = is_metadata_only_file_path(path);

    if !metadata_only_file && is_large_file(path, settings.max_file_size_bytes) {
        return false;
    }

    if is_symlink(path) {
        return false;
    }

    if !metadata_only_file && is_excluded_extension(path, &settings.excluded_extensions) {
        return false;
    }

    true
}

/// Returns true if the path matches any configured ignore pattern.
///
/// Supported syntax examples:
///
/// ```text
/// node_modules/**
/// target/**
/// *.log
/// **/*.log
/// ```
///
/// Invalid glob patterns are ignored.
pub fn matches_ignore_patterns(path: &Path, patterns: &[String]) -> bool {
    if patterns.is_empty() {
        return false;
    }

    let mut builder = GlobSetBuilder::new();

    for pattern in patterns {
        let Ok(glob) = Glob::new(pattern) else {
            continue;
        };

        builder.add(glob);
    }

    let Ok(glob_set) = builder.build() else {
        return false;
    };

    glob_set.is_match(path)
}

/// Returns true if the path is a regular file larger than the configured limit.
///
/// If no limit is configured, this returns false.
///
/// Metadata read failures are treated as non-large so callers can decide
/// separately whether the path is valid.
pub fn is_large_file(path: &Path, max_file_size_bytes: Option<u64>) -> bool {
    let Some(limit) = max_file_size_bytes else {
        return false;
    };

    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };

    metadata.is_file() && metadata.len() > limit
}

/// Returns true if the path is a symbolic link.
///
/// Metadata read failures are treated as non-symlinks.
pub fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::models::settings::IndexingSettings;

    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_path(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("glimpse_path_test_{unique}_{name}"))
    }

    fn test_settings() -> IndexingSettings {
        IndexingSettings {
            ignore_hidden_files: true,
            ignore_patterns: Vec::new(),
            max_file_size_bytes: Some(1048576),
            excluded_extensions: vec!["exe".to_string(), "dll".to_string(), "zip".to_string()],
        }
    }

    #[test]
    fn detects_dotfile_as_hidden() {
        assert!(is_hidden(Path::new(".env")));
    }

    #[test]
    fn detects_dotdir_as_hidden() {
        assert!(is_hidden(Path::new(".git")));
    }

    #[test]
    fn normal_file_is_not_hidden() {
        assert!(!is_hidden(Path::new("notes.md")));
    }

    #[test]
    fn excluded_extension_matches_exactly() {
        let excluded = vec!["exe".to_string()];

        assert!(is_excluded_extension(Path::new("app.exe"), &excluded));
    }

    #[test]
    fn excluded_extension_matches_case_insensitive() {
        let excluded = vec!["exe".to_string()];

        assert!(is_excluded_extension(Path::new("APP.EXE"), &excluded));
    }

    #[test]
    fn normal_extension_is_not_excluded() {
        let excluded = vec!["exe".to_string()];

        assert!(!is_excluded_extension(Path::new("notes.md"), &excluded));
    }

    #[test]
    fn extensionless_file_is_not_excluded() {
        let excluded = vec!["exe".to_string()];

        assert!(!is_excluded_extension(Path::new("README"), &excluded));
    }

    #[test]
    fn parent_dir_returns_self_for_directory() {
        let path = unique_test_path("parent_dir");

        fs::create_dir_all(&path).unwrap();

        assert_eq!(parent_dir(&path), Some(path.clone()));

        fs::remove_dir_all(path).ok();
    }

    #[test]
    fn parent_dir_returns_parent_for_file() {
        let path = unique_test_path("parent_file.md");

        fs::write(&path, "# hello").unwrap();

        assert_eq!(parent_dir(&path), path.parent().map(|p| p.to_path_buf()));

        fs::remove_file(path).ok();
    }

    #[test]
    fn matches_ignore_patterns_matches_simple_glob() {
        let path = Path::new("notes/debug.log");

        let patterns = vec!["*.log".to_string(), "**/*.log".to_string()];

        assert!(matches_ignore_patterns(path, &patterns));
    }

    #[test]
    fn matches_ignore_patterns_matches_directory_glob() {
        let path = Path::new("node_modules/pkg/index.js");

        let patterns = vec!["node_modules/**".to_string()];

        assert!(matches_ignore_patterns(path, &patterns));
    }

    #[test]
    fn matches_ignore_patterns_ignores_invalid_glob() {
        let path = Path::new("notes.md");

        let patterns = vec!["[".to_string()];

        assert!(!matches_ignore_patterns(path, &patterns));
    }

    #[test]
    fn should_index_path_rejects_hidden_when_enabled() {
        let dir = unique_test_path("hidden");

        fs::create_dir_all(&dir).unwrap();

        let path = dir.join(".env");

        fs::write(&path, "SECRET=1").unwrap();

        let settings = test_settings();

        assert!(!should_index_path(&path, &settings));

        fs::remove_file(&path).ok();
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn should_index_path_accepts_hidden_when_disabled() {
        let path = unique_test_path(".env");

        fs::write(&path, "SECRET=1").unwrap();

        let settings = IndexingSettings {
            ignore_hidden_files: false,
            ..test_settings()
        };

        assert!(should_index_path(&path, &settings));

        fs::remove_file(path).ok();
    }

    #[test]
    fn should_index_path_rejects_ignored_pattern() {
        let settings = IndexingSettings {
            ignore_hidden_files: false,
            ignore_patterns: vec!["target/**".to_string()],
            ..test_settings()
        };

        assert!(!should_index_path(Path::new("target/debug/app"), &settings));
    }

    #[test]
    fn should_index_path_rejects_excluded_extension() {
        let settings = test_settings();

        assert!(!should_index_path(Path::new("app.exe"), &settings));
    }

    #[test]
    fn should_index_path_accepts_non_excluded_extension() {
        let md = unique_test_path("readme.md");
        let txt = unique_test_path("readme.txt");
        let png = unique_test_path("image.png");

        fs::write(&md, "# hello").unwrap();
        fs::write(&txt, "hello").unwrap();
        fs::write(&png, vec![0u8; 10]).unwrap();

        let settings = test_settings();

        assert!(should_index_path(&md, &settings));
        assert!(should_index_path(&txt, &settings));
        assert!(should_index_path(&png, &settings));

        fs::remove_file(md).ok();
        fs::remove_file(txt).ok();
        fs::remove_file(png).ok();
    }

    #[test]
    fn should_index_path_rejects_large_file() {
        let path = unique_test_path("large.md");

        fs::write(&path, vec![0u8; 1024]).unwrap();

        let settings = IndexingSettings {
            ignore_hidden_files: false,
            ignore_patterns: Vec::new(),
            max_file_size_bytes: Some(10),
            excluded_extensions: Vec::new(),
        };

        assert!(!should_index_path(&path, &settings));

        fs::remove_file(path).ok();
    }

    #[test]
    fn should_index_path_accepts_large_metadata_only_files() {
        let path = unique_test_path("large.pdf");

        fs::write(&path, vec![0u8; 1024]).unwrap();

        let settings = IndexingSettings {
            ignore_hidden_files: false,
            ignore_patterns: Vec::new(),
            max_file_size_bytes: Some(10),
            excluded_extensions: Vec::new(),
        };

        assert!(should_index_path(&path, &settings));

        fs::remove_file(path).ok();
    }

    #[test]
    fn should_index_path_accepts_metadata_only_files_even_when_legacy_excluded() {
        let path = unique_test_path("movie.mp4");

        fs::write(&path, vec![0u8; 10]).unwrap();

        let settings = IndexingSettings {
            ignore_hidden_files: false,
            ignore_patterns: Vec::new(),
            max_file_size_bytes: Some(1048576),
            excluded_extensions: vec!["mp4".to_string()],
        };

        assert!(should_index_path(&path, &settings));

        fs::remove_file(path).ok();
    }

    #[cfg(unix)]
    #[test]
    fn detects_symlink_on_unix() {
        use std::os::unix::fs::symlink;

        let target = unique_test_path("target.md");
        let link = unique_test_path("link.md");

        fs::write(&target, "# hello").unwrap();

        symlink(&target, &link).unwrap();

        assert!(is_symlink(&link));

        fs::remove_file(link).ok();
        fs::remove_file(target).ok();
    }

    #[cfg(windows)]
    #[test]
    fn detects_symlink_on_windows() {
        use std::os::windows::fs::symlink_file;

        let target = unique_test_path("target.md");
        let link = unique_test_path("link.md");

        fs::write(&target, "# hello").unwrap();

        if symlink_file(&target, &link).is_err() {
            fs::remove_file(target).ok();

            // Windows may require Developer Mode or admin privileges.
            return;
        }

        assert!(is_symlink(&link));

        fs::remove_file(link).ok();
        fs::remove_file(target).ok();
    }
}
