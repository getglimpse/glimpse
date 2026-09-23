//! File operation IPC commands.
//!
//! This module exposes file-related operations to the frontend.
//!
//! Supported operations:
//!
//! - read text files
//! - read binary files
//! - create Markdown files
//! - update Markdown file titles
//! - update Markdown file bodies
//!
//! Unlike the lower-level store layer, these commands are responsible for
//! keeping the search index synchronized after filesystem changes.
//!
//! The actual filesystem implementation lives in:
//!
//! - `store::file`

use serde::Deserialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::app_state::SharedSettingsPath;
use crate::plugin_file_grants::{PluginFileGrant, PluginFileGrants};
use crate::store::file::FileMetadata;
use crate::store::indexer::runtime::IndexerRuntime;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMarkdownFilePayload {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTextFilePayload {
    pub title: String,
    pub body: String,
    pub extension: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTextFileAtPathPayload {
    pub file_path: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTextFilePayload {
    pub file_path: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritePluginTextOutputPayload {
    pub grant_token: String,
    pub file_name: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverwritePluginTextInputPayload {
    pub grant_token: String,
    pub body: String,
}

#[tauri::command]
pub fn read_text_file(
    settings_path: State<SharedSettingsPath>,
    file_path: String,
) -> Result<String, String> {
    crate::store::file::read_text_file(&resolve_settings_path(&settings_path)?, file_path)
}

#[tauri::command]
pub fn claim_plugin_text_inputs(
    window: Window,
    grants: State<PluginFileGrants>,
    paths: Vec<String>,
) -> Result<Vec<PluginFileGrant>, String> {
    grants.claim_drop(window.label(), &paths)
}

#[tauri::command]
pub async fn select_plugin_text_inputs(
    window: Window,
    grants: State<'_, PluginFileGrants>,
    multiple: bool,
    extensions: Vec<String>,
) -> Result<Option<Vec<PluginFileGrant>>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let allowed = extensions
        .iter()
        .map(String::as_str)
        .filter(|extension| matches!(*extension, "txt" | "md" | "markdown"))
        .collect::<Vec<_>>();
    let allowed = if allowed.is_empty() {
        vec!["txt", "md", "markdown"]
    } else {
        allowed
    };
    let dialog = window
        .dialog()
        .file()
        .add_filter("Text and Markdown", &allowed);
    if multiple {
        dialog.pick_files(move |selection| {
            let _ = sender.send(selection);
        });
    } else {
        dialog.pick_file(move |selection| {
            let _ = sender.send(selection.map(|file| vec![file]));
        });
    }
    let selection = receiver.await.map_err(|error| error.to_string())?;
    selection
        .map(|files| {
            let paths = files
                .into_iter()
                .map(|file| file.into_path().map_err(|error| error.to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            grants.grant_picked_inputs(window.label(), &paths)
        })
        .transpose()
}

#[tauri::command]
pub fn read_plugin_text_input(
    window: Window,
    grants: State<PluginFileGrants>,
    grant_token: String,
) -> Result<String, String> {
    let (_, file) = grants.open_input(window.label(), &grant_token, false)?;
    let mut bytes = Vec::new();
    file.take(crate::store::file::MAX_TEXT_READ_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > crate::store::file::MAX_TEXT_READ_BYTES {
        return Err("plugin input text file is too large".into());
    }
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_text_file_in_target_group(
    settings_path: State<SharedSettingsPath>,
    file_path: String,
    target_group_id: String,
) -> Result<String, String> {
    crate::store::file::read_text_file_in_target_group(
        &resolve_settings_path(&settings_path)?,
        file_path,
        target_group_id,
    )
}

#[tauri::command]
pub fn get_file_metadata(
    settings_path: State<SharedSettingsPath>,
    file_path: String,
) -> Result<FileMetadata, String> {
    crate::store::file::get_file_metadata(&resolve_settings_path(&settings_path)?, file_path)
}

#[tauri::command]
pub fn get_file_metadata_in_target_group(
    settings_path: State<SharedSettingsPath>,
    file_path: String,
    target_group_id: String,
) -> Result<FileMetadata, String> {
    crate::store::file::get_file_metadata_in_target_group(
        &resolve_settings_path(&settings_path)?,
        file_path,
        target_group_id,
    )
}

#[tauri::command]
pub fn read_binary_file(
    settings_path: State<SharedSettingsPath>,
    file_path: String,
) -> Result<String, String> {
    crate::store::file::read_binary_file(&resolve_settings_path(&settings_path)?, file_path)
}

#[tauri::command]
pub fn read_binary_file_in_target_group(
    settings_path: State<SharedSettingsPath>,
    file_path: String,
    target_group_id: String,
) -> Result<String, String> {
    crate::store::file::read_binary_file_in_target_group(
        &resolve_settings_path(&settings_path)?,
        file_path,
        target_group_id,
    )
}

#[tauri::command]
pub fn read_preview_asset_data_url(
    settings_path: State<SharedSettingsPath>,
    source_path: String,
    asset_path: String,
) -> Result<String, String> {
    crate::store::file::read_preview_asset_data_url(
        &resolve_settings_path(&settings_path)?,
        source_path,
        asset_path,
    )
}

#[tauri::command]
pub async fn create_markdown_file(
    settings_path: State<'_, SharedSettingsPath>,
    runtime: State<'_, Arc<IndexerRuntime>>,
    payload: CreateMarkdownFilePayload,
) -> Result<String, String> {
    let file_path = crate::store::file::create_markdown_file_in_current_target(
        &resolve_settings_path(&settings_path)?,
        payload.title,
        payload.body,
    )?;

    runtime.index_file(PathBuf::from(&file_path)).await?;

    Ok(file_path)
}

#[tauri::command]
pub async fn create_text_file(
    settings_path: State<'_, SharedSettingsPath>,
    runtime: State<'_, Arc<IndexerRuntime>>,
    payload: CreateTextFilePayload,
) -> Result<String, String> {
    let file_path = crate::store::file::create_text_file_in_current_target(
        &resolve_settings_path(&settings_path)?,
        payload.title,
        payload.body,
        payload.extension,
    )?;

    runtime.index_file(PathBuf::from(&file_path)).await?;

    Ok(file_path)
}

#[tauri::command]
pub async fn create_text_file_at_path(
    settings_path: State<'_, SharedSettingsPath>,
    runtime: State<'_, Arc<IndexerRuntime>>,
    payload: CreateTextFileAtPathPayload,
) -> Result<String, String> {
    let file_path = crate::store::file::create_text_file_at_path(
        &resolve_settings_path(&settings_path)?,
        payload.file_path,
        payload.body,
    )?;

    runtime.index_file(PathBuf::from(&file_path)).await?;

    Ok(file_path)
}

#[tauri::command]
pub fn get_default_download_directory() -> Result<String, String> {
    crate::store::file::default_download_directory()
}

#[tauri::command]
pub async fn select_plugin_output_directory(
    window: Window,
    grants: State<'_, PluginFileGrants>,
) -> Result<Option<PluginFileGrant>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window.dialog().file().pick_folder(move |selection| {
        let _ = sender.send(selection);
    });
    let selection = receiver.await.map_err(|error| error.to_string())?;
    selection
        .map(|path| {
            let path = path.into_path().map_err(|error| error.to_string())?;
            grants.grant_output(window.label(), &path)
        })
        .transpose()
}

#[tauri::command]
pub fn get_plugin_output_directory_grant(
    window: Window,
    grants: State<PluginFileGrants>,
    directory: String,
) -> Result<Option<PluginFileGrant>, String> {
    let path = PathBuf::from(directory);
    if let Ok(default) = crate::store::file::default_download_directory() {
        let default = PathBuf::from(default);
        if let (Ok(requested), Ok(default_path)) = (
            std::fs::canonicalize(&path),
            std::fs::canonicalize(&default),
        ) {
            if requested == default_path {
                return grants.grant_output(window.label(), &default).map(Some);
            }
        }
    }
    grants.existing_output(window.label(), &path)
}

#[tauri::command]
pub fn write_plugin_text_output(
    window: Window,
    grants: State<PluginFileGrants>,
    payload: WritePluginTextOutputPayload,
) -> Result<String, String> {
    let directory = grants.authorize(window.label(), &payload.grant_token, "output")?;
    crate::store::file::write_text_file_in_directory(
        directory.to_string_lossy().into_owned(),
        payload.file_name,
        payload.body,
    )
}

#[tauri::command]
pub fn overwrite_plugin_text_input(
    window: Window,
    grants: State<PluginFileGrants>,
    payload: OverwritePluginTextInputPayload,
) -> Result<String, String> {
    if payload.body.len() > crate::store::file::MAX_PLUGIN_TEXT_OUTPUT_BYTES {
        return Err("plugin output is too large".into());
    }
    let (path, mut file) = grants.open_input(window.label(), &payload.grant_token, true)?;
    file.set_len(0).map_err(|error| error.to_string())?;
    file.write_all(payload.body.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn update_markdown_file_title(
    settings_path: State<'_, SharedSettingsPath>,
    runtime: State<'_, Arc<IndexerRuntime>>,
    file_path: String,
    title: String,
) -> Result<String, String> {
    let old_path = PathBuf::from(&file_path);

    let next_path = crate::store::file::update_markdown_file_title(
        &resolve_settings_path(&settings_path)?,
        file_path,
        title,
    )?;

    if old_path != Path::new(&next_path) {
        runtime.delete_file_from_index(old_path).await?;
    }

    runtime.index_file(PathBuf::from(&next_path)).await?;

    Ok(next_path)
}

#[tauri::command]
pub async fn update_text_file_title(
    settings_path: State<'_, SharedSettingsPath>,
    runtime: State<'_, Arc<IndexerRuntime>>,
    file_path: String,
    title: String,
) -> Result<String, String> {
    let old_path = PathBuf::from(&file_path);

    let next_path = crate::store::file::update_text_file_title(
        &resolve_settings_path(&settings_path)?,
        file_path,
        title,
    )?;

    if old_path != Path::new(&next_path) {
        runtime.delete_file_from_index(old_path).await?;
    }

    runtime.index_file(PathBuf::from(&next_path)).await?;

    Ok(next_path)
}

#[tauri::command]
pub async fn update_markdown_file_body(
    settings_path: State<'_, SharedSettingsPath>,
    runtime: State<'_, Arc<IndexerRuntime>>,
    file_path: String,
    body: String,
) -> Result<(), String> {
    let path = PathBuf::from(&file_path);

    crate::store::file::update_markdown_file_body(
        &resolve_settings_path(&settings_path)?,
        file_path,
        body,
    )?;

    runtime.index_file(path).await?;

    Ok(())
}

#[tauri::command]
pub async fn update_text_file_body(
    settings_path: State<'_, SharedSettingsPath>,
    runtime: State<'_, Arc<IndexerRuntime>>,
    file_path: String,
    body: String,
) -> Result<(), String> {
    let path = PathBuf::from(&file_path);

    crate::store::file::update_text_file_body(
        &resolve_settings_path(&settings_path)?,
        file_path,
        body,
    )?;

    runtime.index_file(path).await?;

    Ok(())
}

#[tauri::command]
pub async fn save_text_file(
    settings_path: State<'_, SharedSettingsPath>,
    runtime: State<'_, Arc<IndexerRuntime>>,
    payload: SaveTextFilePayload,
) -> Result<String, String> {
    let old_path = PathBuf::from(&payload.file_path);
    let next_path = crate::store::file::save_text_file(
        &resolve_settings_path(&settings_path)?,
        payload.file_path,
        payload.title,
        payload.body,
    )?;
    if old_path != Path::new(&next_path) {
        if let Err(error) = runtime.delete_file_from_index(old_path).await {
            tracing::warn!(%error, "saved file but failed to remove old index entry");
        }
    }
    if let Err(error) = runtime.index_file(PathBuf::from(&next_path)).await {
        tracing::warn!(%error, "saved file but failed to refresh index entry");
    }
    Ok(next_path)
}

fn resolve_settings_path(settings_path: &State<SharedSettingsPath>) -> Result<PathBuf, String> {
    settings_path
        .0
        .lock()
        .map_err(|error| error.to_string())
        .map(|path| path.clone())
}
