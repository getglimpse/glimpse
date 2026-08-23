//! File storage utilities for Glimpse.
//!
//! This module provides safe file operations used by the frontend editor.
//!
//! Current responsibilities:
//!
//! - Read text files.
//! - Create Markdown files.
//! - Update Markdown file bodies.
//! - Rename Markdown files.
//! - Restrict file access to configured Target Groups.
//!
//! # Security model
//!
//! All read and write operations are restricted to directories belonging
//! to configured Target Groups.
//!
//! Files outside the configured workspace are rejected.
//!
//! # Supported files
//!
//! Currently:
//!
//! - Markdown (`.md`) creation
//! - Markdown (`.md`) title updates
//! - Markdown (`.md`) body updates
//! - Generic UTF-8 text reading
//! - Generic binary reading as base64
//!
//! Binary file editing is intentionally unsupported.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use chrono::Local;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::settings::{AppSettings, TargetGroup};
use crate::store::settings::load_settings;

const MAX_BINARY_READ_BYTES: u64 = 32 * 1024 * 1024;
const MAX_TEXT_READ_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub size_bytes: u64,
}

/// Reads a UTF-8 text file from a configured Target Group.
///
/// # Security
///
/// The file path must:
///
/// - exist
/// - be a file
/// - belong to a configured Target Group
///
/// Files outside configured target directories are rejected.
///
/// # Returns
///
/// Returns the file contents as UTF-8 text.
pub fn read_text_file(settings_path: &Path, file_path: String) -> Result<String, String> {
    let settings = load_settings(settings_path);
    let path = canonicalize_existing_file(file_path)?;

    ensure_path_is_in_configured_target_group(&path, &settings)?;
    ensure_text_file_size_within_limit(&path)?;

    fs::read_to_string(&path)
        .map_err(|error| format!("failed to read file: {}: {error}", path.display()))
}

/// Reads a UTF-8 text file from one configured Target Group.
///
/// # Security
///
/// The Target Group is resolved from settings in the backend. The file path and
/// configured roots are canonicalized before comparison, preventing caller
/// supplied root injection, `..` traversal, and symbolic-link based escapes.
pub fn read_text_file_in_target_group(
    settings_path: &Path,
    file_path: String,
    target_group_id: String,
) -> Result<String, String> {
    let settings = load_settings(settings_path);
    let path = canonicalize_existing_file(file_path)?;
    let group = settings
        .target_groups
        .iter()
        .find(|group| group.id == target_group_id)
        .ok_or_else(|| format!("target group not found: {target_group_id}"))?;

    ensure_path_is_in_roots(&path, &group.paths, "target group directories")?;
    ensure_text_file_size_within_limit(&path)?;

    fs::read_to_string(&path)
        .map_err(|error| format!("failed to read file: {}: {error}", path.display()))
}

/// Reads file metadata from a configured Target Group.
pub fn get_file_metadata(settings_path: &Path, file_path: String) -> Result<FileMetadata, String> {
    let settings = load_settings(settings_path);
    let path = canonicalize_existing_file(file_path)?;

    ensure_path_is_in_configured_target_group(&path, &settings)?;

    file_metadata(&path)
}

/// Reads file metadata from one configured Target Group.
pub fn get_file_metadata_in_target_group(
    settings_path: &Path,
    file_path: String,
    target_group_id: String,
) -> Result<FileMetadata, String> {
    let settings = load_settings(settings_path);
    let path = canonicalize_existing_file(file_path)?;
    let group = settings
        .target_groups
        .iter()
        .find(|group| group.id == target_group_id)
        .ok_or_else(|| format!("target group not found: {target_group_id}"))?;

    ensure_path_is_in_roots(&path, &group.paths, "target group directories")?;

    file_metadata(&path)
}

/// Reads a binary file from a configured Target Group as base64.
///
/// The same target-directory restrictions as [`read_text_file`] apply.
pub fn read_binary_file(settings_path: &Path, file_path: String) -> Result<String, String> {
    let settings = load_settings(settings_path);
    let path = canonicalize_existing_file(file_path)?;

    ensure_path_is_in_configured_target_group(&path, &settings)?;
    ensure_binary_file_size_within_limit(&path)?;

    fs::read(&path)
        .map(|bytes| BASE64_STANDARD.encode(bytes))
        .map_err(|error| format!("failed to read file: {}: {error}", path.display()))
}

/// Reads a binary file from one configured Target Group as base64.
pub fn read_binary_file_in_target_group(
    settings_path: &Path,
    file_path: String,
    target_group_id: String,
) -> Result<String, String> {
    let settings = load_settings(settings_path);
    let path = canonicalize_existing_file(file_path)?;
    let group = settings
        .target_groups
        .iter()
        .find(|group| group.id == target_group_id)
        .ok_or_else(|| format!("target group not found: {target_group_id}"))?;

    ensure_path_is_in_roots(&path, &group.paths, "target group directories")?;
    ensure_binary_file_size_within_limit(&path)?;

    fs::read(&path)
        .map(|bytes| BASE64_STANDARD.encode(bytes))
        .map_err(|error| format!("failed to read file: {}: {error}", path.display()))
}

fn ensure_binary_file_size_within_limit(path: &Path) -> Result<(), String> {
    let size = file_metadata(path)?.size_bytes;

    if size > MAX_BINARY_READ_BYTES {
        return Err(format!(
            "binary file is too large to preview: {} bytes exceeds {} bytes",
            size, MAX_BINARY_READ_BYTES
        ));
    }

    Ok(())
}

fn ensure_text_file_size_within_limit(path: &Path) -> Result<(), String> {
    let size = file_metadata(path)?.size_bytes;

    if size > MAX_TEXT_READ_BYTES {
        return Err(format!(
            "text file is too large to preview: {} bytes exceeds {} bytes",
            size, MAX_TEXT_READ_BYTES
        ));
    }

    Ok(())
}

fn file_metadata(path: &Path) -> Result<FileMetadata, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("failed to read file metadata: {}: {error}", path.display()))?;

    Ok(FileMetadata {
        size_bytes: metadata.len(),
    })
}

/// Creates a new Markdown file in the current Target Group.
///
/// The file is created in the primary directory of the current
/// Target Group.
///
/// # File naming
///
/// The filename is generated from `title`.
///
/// Example:
///
/// ```text
/// Rust Notes
/// ↓
/// Rust Notes.md
/// ```
///
/// If the file already exists:
///
/// ```text
/// Rust Notes.md
/// Rust Notes 2.md
/// Rust Notes 3.md
/// ```
///
/// is used automatically.
///
/// Empty titles generate a timestamp-based filename.
///
/// # Returns
///
/// Returns the created file path.
pub fn create_markdown_file_in_current_target(
    settings_path: &Path,
    title: String,
    body: String,
) -> Result<String, String> {
    let settings = load_settings(settings_path);
    let target_dir = current_target_primary_dir(&settings)?;

    let file_name = markdown_file_name_from_title(&title)?;
    let file_path = unique_file_path(&target_dir, &file_name);

    fs::write(&file_path, body)
        .map_err(|error| format!("failed to write file: {}: {error}", file_path.display()))?;

    Ok(file_path.to_string_lossy().to_string())
}

/// Updates only the title / filename of an existing Markdown file.
///
/// This function does not update file contents.
pub fn update_markdown_file_title(
    settings_path: &Path,
    file_path: String,
    title: String,
) -> Result<String, String> {
    let settings = load_settings(settings_path);

    let current_path = canonicalize_existing_file(file_path)?;
    ensure_path_is_in_configured_target_group(&current_path, &settings)?;

    let parent = current_path
        .parent()
        .ok_or_else(|| "file has no parent directory".to_string())?;

    let file_name = markdown_file_name_from_title(&title)?;
    let desired_path = parent.join(file_name);

    if normalize_path(&desired_path) == normalize_path(&current_path) {
        return Ok(current_path.to_string_lossy().to_string());
    }

    if desired_path.exists() {
        return Err(format!("file already exists: {}", desired_path.display()));
    }

    fs::rename(&current_path, &desired_path).map_err(|error| {
        format!(
            "failed to rename file: {} -> {}: {error}",
            current_path.display(),
            desired_path.display()
        )
    })?;

    Ok(desired_path.to_string_lossy().to_string())
}

/// Updates only the body of an existing Markdown file.
///
/// This function never renames the file.
pub fn update_markdown_file_body(
    settings_path: &Path,
    file_path: String,
    body: String,
) -> Result<(), String> {
    let settings = load_settings(settings_path);

    let path = canonicalize_existing_file(file_path)?;
    ensure_path_is_in_configured_target_group(&path, &settings)?;

    fs::write(&path, body)
        .map_err(|error| format!("failed to write file: {}: {error}", path.display()))?;

    Ok(())
}

/// Returns the current Target Group.
///
/// Fails when:
///
/// - no current group is selected
/// - the selected group no longer exists
fn current_target_group(settings: &AppSettings) -> Result<&TargetGroup, String> {
    let current_id = settings
        .current_target_group_id
        .as_ref()
        .ok_or_else(|| "current target group is not set".to_string())?;

    settings
        .target_groups
        .iter()
        .find(|group| &group.id == current_id)
        .ok_or_else(|| format!("current target group not found: {current_id}"))
}

/// Returns the primary directory of the current Target Group.
///
/// The first non-empty path is used.
///
/// The directory must exist and is canonicalized before being returned.
fn current_target_primary_dir(settings: &AppSettings) -> Result<PathBuf, String> {
    let group = current_target_group(settings)?;

    let path = group
        .paths
        .iter()
        .map(|path| path.trim())
        .find(|path| !path.is_empty())
        .ok_or_else(|| "current target group has no target directory".to_string())?;

    canonicalize_existing_dir(path)
}

/// Ensures that a path belongs to a configured Target Group.
///
/// Every file read/write operation must pass this check.
///
/// The comparison is performed using canonicalized absolute paths,
/// preventing path traversal and symbolic-link based escapes.
///
/// # Errors
///
/// Returns an error if the path is outside all configured target
/// directories.
fn ensure_path_is_in_configured_target_group(
    path: &Path,
    settings: &AppSettings,
) -> Result<(), String> {
    for group in &settings.target_groups {
        for root in &group.paths {
            let Ok(root) = canonicalize_existing_dir(root) else {
                continue;
            };

            if path_starts_with(path, &root) {
                return Ok(());
            }
        }
    }

    Err(format!(
        "path is outside configured target group directories: {}",
        path.display()
    ))
}

fn ensure_path_is_in_roots(path: &Path, roots: &[String], label: &str) -> Result<(), String> {
    for root in roots {
        let Ok(root) = canonicalize_existing_dir(root) else {
            continue;
        };

        if path_starts_with(path, &root) {
            return Ok(());
        }
    }

    Err(format!("path is outside {label}: {}", path.display()))
}

fn normalize_input_path(path: impl AsRef<Path>) -> PathBuf {
    let value = path.as_ref().to_string_lossy();

    #[cfg(windows)]
    {
        let normalized = value
            .strip_prefix(r"\\?\")
            .or_else(|| value.strip_prefix(r"//?/"))
            .unwrap_or(&value);

        PathBuf::from(normalized)
    }

    #[cfg(not(windows))]
    {
        PathBuf::from(value.to_string())
    }
}

/// Resolves an existing file into its canonical absolute path.
///
/// Validation:
///
/// - path exists
/// - path is a file
/// - canonicalization succeeds
fn canonicalize_existing_file(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = normalize_input_path(path);

    if !path.exists() {
        return Err(format!("file does not exist: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!("path is not a file: {}", path.display()));
    }

    path.canonicalize()
        .map(|path| normalize_input_path(path))
        .map_err(|error| format!("failed to canonicalize file: {}: {error}", path.display()))
}

/// Resolves an existing directory into its canonical absolute path.
///
/// Validation:
///
/// - path exists
/// - path is a directory
/// - canonicalization succeeds
fn canonicalize_existing_dir(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = normalize_input_path(path);

    if !path.exists() {
        return Err(format!("directory does not exist: {}", path.display()));
    }

    if !path.is_dir() {
        return Err(format!("path is not a directory: {}", path.display()));
    }

    path.canonicalize()
        .map(|path| normalize_input_path(path))
        .map_err(|error| {
            format!(
                "failed to canonicalize directory: {}: {error}",
                path.display()
            )
        })
}

fn path_starts_with(path: &Path, root: &Path) -> bool {
    normalize_comparison_path(path).starts_with(&normalize_comparison_path(root))
}

fn normalize_comparison_path(path: &Path) -> PathBuf {
    let path = normalize_input_path(path);

    #[cfg(windows)]
    {
        PathBuf::from(path.to_string_lossy().to_lowercase())
    }

    #[cfg(not(windows))]
    {
        path
    }
}

/// Converts a title into a safe Markdown filename.
///
/// Examples:
///
/// ```text
/// Rust Notes
/// -> Rust Notes.md
///
/// hello/world
/// -> hello_world.md
/// ```
///
/// Empty titles generate a timestamp-based filename.
///
/// Invalid filesystem characters are replaced with `_`.
fn markdown_file_name_from_title(title: &str) -> Result<String, String> {
    let title = title.trim();

    let title = if title.is_empty() {
        Local::now().format("%Y-%m-%d %H.#M.%S").to_string()
    } else {
        title.to_string()
    };

    let sanitized = sanitize_file_stem(&title);

    if sanitized.is_empty() {
        return Err("title does not contain usable filename characters".to_string());
    }

    Ok(format!("{sanitized}.md"))
}

/// Sanitizes a filename stem for filesystem safety.
///
/// Replaces:
///
/// - < > : " / \ | ? *
/// - control characters
///
/// with `_`.
///
/// Leading and trailing dots are removed.
fn sanitize_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string()
}

/// Generates a unique Markdown file path.
///
/// If the requested filename already exists,
/// incrementing suffixes are added:
///
/// ```text
/// Note.md
/// Note 2.md
/// Note 3.md
/// ```
fn unique_file_path(dir: &Path, file_name: &str) -> PathBuf {
    let base = file_name.trim_end_matches(".md");

    let mut path = dir.join(file_name);

    if !path.exists() {
        return path;
    }

    for index in 2.. {
        path = dir.join(format!("{base} {index}.md"));

        if !path.exists() {
            return path;
        }
    }

    unreachable!()
}

/// Returns the canonical path when possible.
///
/// Falls back to the original path if canonicalization fails.
///
/// Used for path equality checks during file renaming.
fn normalize_path(path: &Path) -> PathBuf {
    path.canonicalize()
        .map(|path| normalize_input_path(path))
        .unwrap_or_else(|_| normalize_input_path(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::models::settings::{AppSettings, TargetGroup};
    use crate::store::settings::save_settings;

    fn unique_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("glimpse_file_test_{unique}_{name}"))
    }

    fn target_group(id: &str, paths: Vec<PathBuf>) -> TargetGroup {
        TargetGroup {
            id: id.to_string(),
            name: id.to_string(),
            paths: paths
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect(),
            active: true,
        }
    }

    fn write_settings(settings_path: &Path, target_dir: &Path) {
        let settings = AppSettings {
            target_groups: vec![target_group("default", vec![target_dir.to_path_buf()])],
            current_target_group_id: Some("default".to_string()),
            ..Default::default()
        };

        save_settings(settings_path, &settings).unwrap();
    }

    fn write_settings_with_groups(
        settings_path: &Path,
        groups: Vec<TargetGroup>,
        current_id: &str,
    ) {
        let settings = AppSettings {
            target_groups: groups,
            current_target_group_id: Some(current_id.to_string()),
            ..Default::default()
        };

        save_settings(settings_path, &settings).unwrap();
    }

    fn assert_same_path(left: impl AsRef<Path>, right: impl AsRef<Path>) {
        let left = left.as_ref().canonicalize().unwrap();
        let right = right.as_ref().canonicalize().unwrap();

        assert_eq!(left, right);
    }

    #[test]
    fn create_markdown_file_creates_file_in_current_target_primary_dir() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = create_markdown_file_in_current_target(
            &settings_path,
            "Hello World".to_string(),
            "# Hello".to_string(),
        )
        .unwrap();

        let file_path = PathBuf::from(file_path);

        assert_same_path(&file_path, target_dir.join("Hello World.md"));
        assert_eq!(fs::read_to_string(file_path).unwrap(), "# Hello");

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn create_markdown_file_uses_unique_name_when_file_exists() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        fs::write(target_dir.join("Note.md"), "existing").unwrap();

        let file_path = create_markdown_file_in_current_target(
            &settings_path,
            "Note".to_string(),
            "new".to_string(),
        )
        .unwrap();

        assert_same_path(PathBuf::from(file_path), target_dir.join("Note 2.md"));

        assert_eq!(
            fs::read_to_string(target_dir.join("Note 2.md")).unwrap(),
            "new"
        );

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn create_markdown_file_sanitizes_title() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = create_markdown_file_in_current_target(
            &settings_path,
            "a/b:c*?".to_string(),
            "body".to_string(),
        )
        .unwrap();

        assert_same_path(PathBuf::from(file_path), target_dir.join("a_b_c__.md"));

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn read_text_file_reads_file_inside_current_target_group() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = target_dir.join("Note.md");
        fs::write(&file_path, "content").unwrap();

        let content =
            read_text_file(&settings_path, file_path.to_string_lossy().to_string()).unwrap();

        assert_eq!(content, "content");

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn read_binary_file_reads_base64_inside_current_target_group() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = target_dir.join("Report.docx");
        fs::write(&file_path, b"hello").unwrap();

        let content =
            read_binary_file(&settings_path, file_path.to_string_lossy().to_string()).unwrap();

        assert_eq!(content, "aGVsbG8=");

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn get_file_metadata_returns_size_inside_current_target_group() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = target_dir.join("Book.pdf");
        fs::write(&file_path, b"hello").unwrap();

        let metadata =
            get_file_metadata(&settings_path, file_path.to_string_lossy().to_string()).unwrap();

        assert_eq!(metadata.size_bytes, 5);

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn get_file_metadata_in_target_group_rejects_other_groups() {
        let active_dir = unique_test_dir("active");
        let other_dir = unique_test_dir("other");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&active_dir).unwrap();
        fs::create_dir_all(&other_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings_with_groups(
            &settings_path,
            vec![
                target_group("active", vec![active_dir.clone()]),
                target_group("other", vec![other_dir.clone()]),
            ],
            "active",
        );

        let file_path = other_dir.join("Other.pdf");
        fs::write(&file_path, b"hello").unwrap();

        let result = get_file_metadata_in_target_group(
            &settings_path,
            file_path.to_string_lossy().to_string(),
            "active".to_string(),
        );

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("path is outside target group directories"));

        fs::remove_dir_all(active_dir).ok();
        fs::remove_dir_all(other_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn read_binary_file_rejects_files_over_preview_limit() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = target_dir.join("Huge.docx");
        let file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&file_path)
            .unwrap();
        file.set_len(MAX_BINARY_READ_BYTES + 1).unwrap();

        let result = read_binary_file(&settings_path, file_path.to_string_lossy().to_string());

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("binary file is too large"));

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn read_text_file_rejects_files_over_preview_limit() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = target_dir.join("Huge.csv");
        let file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&file_path)
            .unwrap();
        file.set_len(MAX_TEXT_READ_BYTES + 1).unwrap();

        let result = read_text_file(&settings_path, file_path.to_string_lossy().to_string());

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("text file is too large"));

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn read_text_file_reads_file_inside_non_current_target_group() {
        let active_dir = unique_test_dir("active");
        let inactive_dir = unique_test_dir("inactive");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&active_dir).unwrap();
        fs::create_dir_all(&inactive_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings_with_groups(
            &settings_path,
            vec![
                target_group("active", vec![active_dir.clone()]),
                target_group("inactive", vec![inactive_dir.clone()]),
            ],
            "active",
        );

        let file_path = inactive_dir.join("tools.gjson");
        fs::write(&file_path, r#"{"items":[]}"#).unwrap();

        let content =
            read_text_file(&settings_path, file_path.to_string_lossy().to_string()).unwrap();

        assert_eq!(content, r#"{"items":[]}"#);

        fs::remove_dir_all(active_dir).ok();
        fs::remove_dir_all(inactive_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn read_text_file_in_target_group_reads_file_inside_named_group() {
        let target_dir = unique_test_dir("scoped_root");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings_with_groups(
            &settings_path,
            vec![target_group("active", vec![target_dir.clone()])],
            "active",
        );

        let file_path = target_dir.join("Note.md");
        fs::write(&file_path, "scoped content").unwrap();

        let content = read_text_file_in_target_group(
            &settings_path,
            file_path.to_string_lossy().to_string(),
            "active".to_string(),
        )
        .unwrap();

        assert_eq!(content, "scoped content");

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn read_text_file_in_target_group_rejects_parent_traversal_into_inactive_root() {
        let parent_dir = unique_test_dir("scoped_roots");
        let active_dir = parent_dir.join("active");
        let inactive_dir = parent_dir.join("inactive");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&active_dir).unwrap();
        fs::create_dir_all(&inactive_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings_with_groups(
            &settings_path,
            vec![
                target_group("active", vec![active_dir.clone()]),
                target_group("inactive", vec![inactive_dir.clone()]),
            ],
            "active",
        );

        let file_path = inactive_dir.join("Secret.md");
        fs::write(&file_path, "secret").unwrap();

        let traversal_path = active_dir.join("..").join("inactive").join("Secret.md");
        let result = read_text_file_in_target_group(
            &settings_path,
            traversal_path.to_string_lossy().to_string(),
            "active".to_string(),
        );

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("path is outside target group directories"));

        fs::remove_dir_all(parent_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn read_text_file_in_target_group_rejects_unknown_target_group() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = target_dir.join("Note.md");
        fs::write(&file_path, "content").unwrap();

        let result = read_text_file_in_target_group(
            &settings_path,
            file_path.to_string_lossy().to_string(),
            "other".to_string(),
        );

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("target group not found: other"));

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[cfg(windows)]
    #[test]
    fn read_text_file_accepts_windows_verbatim_source_path() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = target_dir.join("Note.md");
        fs::write(&file_path, "content").unwrap();

        let verbatim_path = format!(r"\\?\{}", file_path.display());
        let content = read_text_file(&settings_path, verbatim_path).unwrap();

        assert_eq!(content, "content");

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn read_text_file_rejects_file_outside_current_target_group() {
        let target_dir = unique_test_dir("target");
        let outside_dir = unique_test_dir("outside");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&outside_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = outside_dir.join("Secret.md");
        fs::write(&file_path, "secret").unwrap();

        let result = read_text_file(&settings_path, file_path.to_string_lossy().to_string());

        assert!(result.is_err());

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(outside_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn update_markdown_file_body_updates_body_without_renaming() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = target_dir.join("Note.md");
        fs::write(&file_path, "old").unwrap();

        update_markdown_file_body(
            &settings_path,
            file_path.to_string_lossy().to_string(),
            "new".to_string(),
        )
        .unwrap();

        assert!(file_path.exists());
        assert_eq!(fs::read_to_string(file_path).unwrap(), "new");

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn update_markdown_file_title_renames_file() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = target_dir.join("Old.md");
        fs::write(&file_path, "old").unwrap();

        let updated_path = update_markdown_file_title(
            &settings_path,
            file_path.to_string_lossy().to_string(),
            "New".to_string(),
        )
        .unwrap();

        assert_same_path(PathBuf::from(updated_path), target_dir.join("New.md"));
        assert!(!file_path.exists());
        assert_eq!(
            fs::read_to_string(target_dir.join("New.md")).unwrap(),
            "old"
        );

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn update_markdown_file_title_returns_same_path_when_title_matches() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let file_path = target_dir.join("Note.md");
        fs::write(&file_path, "body").unwrap();

        let updated_path = update_markdown_file_title(
            &settings_path,
            file_path.to_string_lossy().to_string(),
            "Note".to_string(),
        )
        .unwrap();

        assert_same_path(PathBuf::from(updated_path), &file_path);
        assert_eq!(fs::read_to_string(file_path).unwrap(), "body");

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn update_markdown_file_title_rejects_rename_when_destination_exists() {
        let target_dir = unique_test_dir("target");
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(&settings_dir).unwrap();

        write_settings(&settings_path, &target_dir);

        let old_path = target_dir.join("Old.md");
        let new_path = target_dir.join("New.md");

        fs::write(&old_path, "old").unwrap();
        fs::write(&new_path, "existing").unwrap();

        let result = update_markdown_file_title(
            &settings_path,
            old_path.to_string_lossy().to_string(),
            "New".to_string(),
        );

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(old_path).unwrap(), "old");
        assert_eq!(fs::read_to_string(new_path).unwrap(), "existing");

        fs::remove_dir_all(target_dir).ok();
        fs::remove_dir_all(settings_dir).ok();
    }
}
