//! Theme-related IPC commands.
//!
//! This module exposes custom CSS theme functionality to the frontend.
//!
//! Supported operations:
//!
//! - load user-defined CSS themes
//! - open the themes directory
//!
//! Theme files are stored under:
//!
//! ```text
//! <app_data_dir>/themes/*.css
//! ```
//!
//! The actual filesystem operations are implemented in:
//!
//! - `store::themes`

use tauri::State;

use crate::app_state::SharedAppDataDir;
use crate::models::theme::CssTheme;
use crate::store::themes::{ensure_themes_dir, load_custom_themes};

/// Returns all available custom CSS themes.
///
/// Themes are loaded from the application's themes directory.
///
/// Invalid theme files may be skipped depending on the underlying
/// implementation.
///
/// # Returns
///
/// A list of loaded [`CssTheme`] definitions.
#[tauri::command]
pub fn get_custom_themes(app_data_dir: State<SharedAppDataDir>) -> Result<Vec<CssTheme>, String> {
    let dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;

    load_custom_themes(&dir)
}

/// Opens the themes directory using the operating system's file explorer.
///
/// The themes directory is created automatically if it does not already exist.
///
/// This command allows users to:
///
/// - add custom CSS themes
/// - edit existing CSS theme files
/// - manage theme files directly
///
/// # Directory
///
/// ```text
/// <app_data_dir>/themes
/// ```
#[tauri::command]
pub fn open_themes_folder(app_data_dir: State<SharedAppDataDir>) -> Result<(), String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;

    let themes_dir = ensure_themes_dir(&app_data_dir)?;

    opener::open(themes_dir).map_err(|e| e.to_string())
}
