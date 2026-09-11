//! Plugin-related IPC commands.

use tauri::State;

use crate::app_state::{SharedAppDataDir, SharedSettingsPath};
use crate::models::plugins::{
    PluginAssetSource, PluginDiscoveryReport, PluginEntrypointSource, PluginInstallResult,
    PluginManifest, PluginReadmeSource, PluginTrustStatus, PluginUninstallResult,
};
use crate::store::plugins::{
    ensure_plugin_trusted, ensure_plugins_dir,
    get_plugin_trust_status as get_plugin_trust_status_store,
    install_plugin_from_archive as install_plugin_from_archive_store,
    install_plugin_from_path as install_plugin_from_path_store,
    install_plugin_from_url as install_plugin_from_url_store, load_plugin_discovery_report,
    load_plugin_manifests, read_plugin_asset_source, read_plugin_entrypoint_source,
    read_plugin_readme_source, set_plugin_trust as set_plugin_trust_store,
    uninstall_plugin as uninstall_plugin_store,
};

#[tauri::command]
pub fn get_plugin_manifests(
    app_data_dir: State<SharedAppDataDir>,
) -> Result<Vec<PluginManifest>, String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;

    load_plugin_manifests(&app_data_dir)
}

#[tauri::command]
pub fn get_plugin_discovery_report(
    app_data_dir: State<SharedAppDataDir>,
) -> Result<PluginDiscoveryReport, String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;

    load_plugin_discovery_report(&app_data_dir)
}

#[tauri::command]
pub fn open_plugins_folder(app_data_dir: State<SharedAppDataDir>) -> Result<(), String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;
    let plugins_dir = ensure_plugins_dir(&app_data_dir)?;

    opener::open(plugins_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn install_plugin_from_path(
    app_data_dir: State<SharedAppDataDir>,
    settings_path: State<SharedSettingsPath>,
    source_path: String,
    replace: bool,
) -> Result<PluginInstallResult, String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;
    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?;

    install_plugin_from_path_store(&app_data_dir, &settings_path, &source_path, replace)
}

#[tauri::command]
pub fn install_plugin_from_archive(
    app_data_dir: State<SharedAppDataDir>,
    settings_path: State<SharedSettingsPath>,
    archive_path: String,
    replace: bool,
) -> Result<PluginInstallResult, String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;
    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?;

    install_plugin_from_archive_store(&app_data_dir, &settings_path, &archive_path, replace)
}

#[tauri::command]
pub async fn install_plugin_from_url(
    app_data_dir: State<'_, SharedAppDataDir>,
    settings_path: State<'_, SharedSettingsPath>,
    download_url: String,
    sha256: String,
    registry_url: Option<String>,
    replace: bool,
) -> Result<PluginInstallResult, String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?.clone();
    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?.clone();

    install_plugin_from_url_store(
        &app_data_dir,
        &settings_path,
        &download_url,
        &sha256,
        registry_url.as_deref(),
        replace,
    )
    .await
}

#[tauri::command]
pub fn uninstall_plugin(
    app_data_dir: State<SharedAppDataDir>,
    settings_path: State<SharedSettingsPath>,
    plugin_id: String,
) -> Result<PluginUninstallResult, String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;
    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?;

    uninstall_plugin_store(&app_data_dir, &settings_path, &plugin_id)
}

#[tauri::command]
pub fn get_plugin_trust_status(
    app_data_dir: State<SharedAppDataDir>,
    settings_path: State<SharedSettingsPath>,
    plugin_id: String,
) -> Result<PluginTrustStatus, String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;
    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?;

    get_plugin_trust_status_store(&app_data_dir, &settings_path, &plugin_id)
}

#[tauri::command]
pub fn set_plugin_trust(
    app_data_dir: State<SharedAppDataDir>,
    settings_path: State<SharedSettingsPath>,
    plugin_id: String,
    trusted: bool,
) -> Result<PluginTrustStatus, String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;
    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?;

    set_plugin_trust_store(&app_data_dir, &settings_path, &plugin_id, trusted)
}

#[tauri::command]
pub fn get_plugin_entrypoint_source(
    app_data_dir: State<SharedAppDataDir>,
    settings_path: State<SharedSettingsPath>,
    plugin_id: String,
    entrypoint: String,
) -> Result<PluginEntrypointSource, String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;
    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?;

    ensure_plugin_trusted(&app_data_dir, &settings_path, &plugin_id)?;

    read_plugin_entrypoint_source(&app_data_dir, &plugin_id, &entrypoint)
}

#[tauri::command]
pub fn get_plugin_asset_source(
    app_data_dir: State<SharedAppDataDir>,
    settings_path: State<SharedSettingsPath>,
    plugin_id: String,
    asset: String,
) -> Result<PluginAssetSource, String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;
    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?;

    ensure_plugin_trusted(&app_data_dir, &settings_path, &plugin_id)?;

    read_plugin_asset_source(&app_data_dir, &plugin_id, &asset)
}

#[tauri::command]
pub fn get_plugin_readme_source(
    app_data_dir: State<SharedAppDataDir>,
    plugin_id: String,
) -> Result<PluginReadmeSource, String> {
    let app_data_dir = app_data_dir.0.lock().map_err(|e| e.to_string())?;

    read_plugin_readme_source(&app_data_dir, &plugin_id)
}
