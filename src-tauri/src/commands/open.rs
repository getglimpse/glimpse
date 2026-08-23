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
