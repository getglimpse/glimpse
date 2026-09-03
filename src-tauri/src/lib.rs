//! Glimpse backend bootstrap and Tauri application setup.
//!
//! This module wires together the backend services used by the desktop app.
//!
//! Responsibilities:
//!
//! - Initialize the Tauri application
//! - Register frontend IPC commands
//! - Register global shortcuts
//! - Resolve application data paths
//! - Ensure the default workspace and settings exist
//! - Initialize the SQLite database
//! - Initialize the search engine
//! - Start the indexing runtime
//!
//! The actual feature implementations are delegated to dedicated modules:
//!
//! - `commands/` → frontend IPC entrypoints
//! - `models/` → shared backend data models
//! - `search/` → search engine abstraction and implementations
//! - `store/` → filesystem, database, settings, and indexing orchestration
//! - `shortcuts/` → global shortcut registration
//! - `utils/` → path, command, and security helpers
//!
//! This file should stay focused on application startup and dependency wiring.
//! Feature-specific logic should live in the corresponding submodules.

pub mod app_state;
pub mod commands;
pub mod models;
pub mod search;
pub mod shortcuts;
pub mod store;
pub mod tray;
pub mod utils;

#[cfg(test)]
pub mod test_utils;

use app_state::{SharedAppDataDir, SharedSettingsPath};
use search::ActiveSearchEngine;
use shortcuts::register_global_shortcuts_from_settings_path;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tracing::{error, info, warn};

use store::db::init_db;
use store::indexer::runtime::IndexerRuntime;
use store::plugins::ensure_plugins_dir;
use store::settings::ensure_default_settings;
use store::settings_watch::start_settings_watch;
use store::workspace::ensure_default_workspace;
use utils::app_path::{get_app_data_dir, get_default_target_dir};

/// Starts the Glimpse desktop application.
///
/// This is the main backend entrypoint called by the Tauri runtime.
///
/// Startup flow:
///
/// 1. Register Tauri plugins.
/// 2. Register frontend IPC commands.
/// 3. Run [`setup_app`] to initialize backend state.
/// 4. Start the Tauri event loop.
///
/// The IPC command list should be kept explicit so that frontend/backend
/// boundaries remain easy to audit.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::search::search_items,
            commands::search::get_items_by_source_path,
            commands::open::reveal_in_explorer,
            commands::open::open_source_file,
            commands::action::run_item_command,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::settings::open_settings_file,
            commands::settings::switch_next_target_group,
            commands::settings::switch_target_group,
            commands::indexing::get_indexing_stats,
            commands::indexing::full_scan,
            commands::indexing::cleanup_missing_source_paths,
            commands::stats::get_stats,
            commands::stats::get_tag_cloud,
            commands::themes::get_custom_themes,
            commands::themes::open_themes_folder,
            commands::plugins::get_plugin_manifests,
            commands::plugins::get_plugin_discovery_report,
            commands::plugins::install_plugin_from_path,
            commands::plugins::uninstall_plugin,
            commands::plugins::get_plugin_trust_status,
            commands::plugins::set_plugin_trust,
            commands::plugins::get_plugin_entrypoint_source,
            commands::plugins::get_plugin_asset_source,
            commands::plugins::open_plugins_folder,
            commands::command_log::get_command_execution_logs,
            commands::command_log::open_command_logs_file,
            commands::about::get_about_info,
            commands::file::read_text_file,
            commands::file::read_plugin_text_input,
            commands::file::read_text_file_in_target_group,
            commands::file::get_file_metadata,
            commands::file::get_file_metadata_in_target_group,
            commands::file::read_binary_file,
            commands::file::read_binary_file_in_target_group,
            commands::file::create_markdown_file,
            commands::file::create_text_file,
            commands::file::get_default_download_directory,
            commands::file::write_plugin_text_output,
            commands::file::update_markdown_file_title,
            commands::file::update_text_file_title,
            commands::file::update_markdown_file_body,
            commands::file::update_text_file_body,
            commands::preview::get_preview,
        ])
        .setup(setup_app)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Initializes Glimpse backend state before the main window becomes active.
///
/// This function performs the backend wiring required by IPC commands:
///
/// - Register global shortcuts.
/// - Resolve and create the app data directory.
/// - Store shared app paths in Tauri managed state.
/// - Ensure the default target workspace exists.
/// - Ensure `settings.json` exists.
/// - Create the internal `.glimpse` directory.
/// - Initialize the SQLite index database.
/// - Create the SQLite search engine.
/// - Create and register the indexing runtime.
/// - Start indexing and filesystem watching asynchronously.
///
/// Most shared values are wrapped in `Arc<Mutex<_>>` because they are accessed
/// from multiple Tauri commands and background tasks.
///
/// Failure during required setup returns an error and prevents the application
/// from starting. Global shortcut registration is treated as non-fatal because
/// the app can still run without shortcuts.
fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    info!("Setting up Glimpse backend");

    let app_dir = get_app_data_dir(app);
    ensure_dir(&app_dir, "app data directory")?;
    ensure_plugins_dir(&app_dir)?;

    let app_data_dir = Arc::new(Mutex::new(app_dir.clone()));
    let settings_path = Arc::new(Mutex::new(app_dir.join("settings.json")));

    app.manage(SharedAppDataDir(app_data_dir));
    app.manage(SharedSettingsPath(settings_path.clone()));

    let settings_file_path = settings_path.lock().map_err(|e| e.to_string())?.clone();

    let target_dir = get_default_target_dir(app);
    ensure_default_workspace(&target_dir)?;

    ensure_default_settings(&settings_file_path, &target_dir)?;
    tray::setup_tray(app, settings_file_path.clone())?;

    if let Err(error) =
        register_global_shortcuts_from_settings_path(app.handle(), &settings_file_path)
    {
        warn!(error = %error, "Failed to register global shortcuts");
    }

    let settings_watch_task =
        start_settings_watch(app.handle().clone(), settings_file_path.clone());
    app.manage(SettingsWatchTask {
        _handle: settings_watch_task,
    });

    let glimpse_dir = target_dir.join(".glimpse");
    ensure_dir(&glimpse_dir, ".glimpse directory")?;

    let db_path = glimpse_dir.join("index.db");
    let connection = init_db(&db_path)?;

    let shared_connection = Arc::new(Mutex::new(connection));
    let tantivy_index_dir = glimpse_dir.join("tantivy");
    let search_engine = Arc::new(ActiveSearchEngine::new(
        shared_connection.clone(),
        tantivy_index_dir,
    )?);

    let indexer_runtime = Arc::new(IndexerRuntime::new(
        search_engine.clone(),
        shared_connection.clone(),
        target_dir,
        settings_path.clone(),
    ));

    let indexing_stats = indexer_runtime.stats();

    app.manage(shared_connection);
    app.manage(search_engine);
    app.manage(indexing_stats);
    app.manage(indexer_runtime.clone());

    tauri::async_runtime::spawn(async move {
        if let Err(error) = indexer_runtime.start().await {
            error!("Indexer runtime error: {error}");
        }
    });

    info!("Glimpse backend setup completed");

    Ok(())
}

/// Ensures that a directory exists.
///
/// Returns an error when the path already exists but is not a directory.
/// Otherwise, creates the directory and any missing parent directories.
///
/// `label` is used only for human-readable error messages.
fn ensure_dir(path: &Path, label: &str) -> Result<(), String> {
    if path.exists() && !path.is_dir() {
        return Err(format!(
            "{label} exists but is not a directory: {}",
            path.display()
        ));
    }

    std::fs::create_dir_all(path)
        .map_err(|error| format!("failed to create {label}: {}: {error}", path.display()))
}

struct SettingsWatchTask {
    _handle: Option<tauri::async_runtime::JoinHandle<()>>,
}
