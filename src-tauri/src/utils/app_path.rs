//! Application path utilities.
//!
//! This module centralizes filesystem locations used by Glimpse.
//!
//! Currently managed locations:
//!
//! - Application data directory
//! - Default workspace directory
//!
//! The path layout is intentionally isolated behind helper functions so that
//! future changes such as:
//!
//! - portable mode
//! - multiple profiles
//! - workspace switching
//! - custom storage locations
//!
//! can be implemented without affecting other modules.

use std::path::PathBuf;
use tauri::Manager;

/// Returns the application data directory.
///
/// This directory stores application-managed files such as:
///
/// - `settings.json`
/// - themes
/// - logs
/// - future profile information
///
/// Current layout:
///
/// ```text
/// ~/.config/glimpse
/// ```
///
/// If the system home directory cannot be resolved,
/// `./.config/glimpse` is used as a fallback.
///
/// Future plans:
///
/// - profile switching
/// - portable mode
/// - multi-dictionary environments
pub fn get_app_data_dir(app: &tauri::App) -> PathBuf {
    app.path()
        .home_dir()
        .unwrap_or_else(|_| PathBuf::from("./"))
        .join(".config")
        .join("glimpse")
}

/// Returns the default workspace directory.
///
/// The workspace is the default filesystem location indexed by Glimpse.
///
/// Current layout:
///
/// ```text
/// ~/Documents/Glimpse
/// ```
///
/// During first launch, this directory is automatically created and
/// populated with starter documents.
///
/// If the system documents directory is unavailable, the following
/// fallbacks are used:
///
/// 1. `~/Documents`
/// 2. `./Documents`
pub fn get_default_target_dir(app: &tauri::App) -> PathBuf {
    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir().map(|home| home.join("Documents")))
        .unwrap_or_else(|_| PathBuf::from("./Documents"))
        .join("Glimpse")
}
