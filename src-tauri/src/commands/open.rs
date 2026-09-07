//! File opening IPC commands.
//!
//! This module provides simple file-opening actions exposed to the frontend.
//!
//! Supported operations:
//!
//! - reveal a file in the system file explorer
//! - open a source file with the operating system's default application
//!
//! These commands intentionally do not execute arbitrary programs.
//! They delegate opening behavior to the OS through the `opener` crate.

use std::path::PathBuf;

use crate::utils::path::parent_dir;

/// Opens an external URL in the operating system's default browser.
///
/// # Security
///
/// The renderer must not call the Tauri opener plugin directly. This command
/// accepts only normalized `http` and `https` URLs and rejects embedded
/// credentials so untrusted search metadata cannot trigger arbitrary schemes
/// such as `file:`, `javascript:`, or OS-specific protocol handlers.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;

    opener::open(url).map_err(|error| error.to_string())?;

    Ok(())
}

/// Opens the parent directory of a source file.
///
/// This command is intended for:
///
/// - revealing indexed files in Explorer/Finder/File Manager
/// - navigating to the original file location
///
/// Empty paths are ignored and treated as a no-op.
///
/// # Errors
///
/// Returns an error when:
///
/// - the parent directory cannot be resolved
/// - the operating system fails to open the directory
#[tauri::command]
pub fn reveal_in_explorer(source_path: String) -> Result<(), String> {
    if source_path.trim().is_empty() {
        return Ok(());
    }

    let path = PathBuf::from(source_path);

    let dir = parent_dir(&path).ok_or_else(|| "failed to resolve parent directory".to_string())?;

    opener::open(dir).map_err(|e| e.to_string())?;

    Ok(())
}

/// Opens a source file using the operating system's default application.
///
/// Examples:
///
/// - Markdown → editor or viewer
/// - Image → image viewer
/// - PDF → PDF reader
///
/// Empty paths are ignored and treated as a no-op.
///
/// This command relies entirely on the operating system's file association
/// settings.
#[tauri::command]
pub fn open_source_file(source_path: String) -> Result<(), String> {
    if source_path.trim().is_empty() {
        return Ok(());
    }

    let path = PathBuf::from(source_path);

    opener::open(path).map_err(|e| e.to_string())?;

    Ok(())
}

fn validate_external_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err("external URL is empty".to_string());
    }

    let url = url::Url::parse(trimmed).map_err(|error| format!("invalid external URL: {error}"))?;

    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("unsupported external URL scheme: {}", url.scheme()));
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err("external URL credentials are not allowed".to_string());
    }

    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::validate_external_url;

    #[test]
    fn validate_external_url_allows_http_and_https() {
        assert_eq!(
            validate_external_url("https://example.com/path?q=1").unwrap(),
            "https://example.com/path?q=1"
        );
        assert_eq!(
            validate_external_url(" http://example.com ").unwrap(),
            "http://example.com/"
        );
    }

    #[test]
    fn validate_external_url_rejects_non_web_schemes() {
        assert!(validate_external_url("file:///C:/Users/j/secret.txt")
            .unwrap_err()
            .contains("unsupported external URL scheme: file"));
        assert!(validate_external_url("javascript:alert(1)")
            .unwrap_err()
            .contains("unsupported external URL scheme: javascript"));
    }

    #[test]
    fn validate_external_url_rejects_embedded_credentials() {
        assert_eq!(
            validate_external_url("https://user:password@example.com").unwrap_err(),
            "external URL credentials are not allowed"
        );
    }
}
