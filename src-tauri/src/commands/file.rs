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
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

use crate::app_state::SharedSettingsPath;
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

#[tauri::command]
pub fn read_text_file(
    settings_path: State<SharedSettingsPath>,
    file_path: String,
) -> Result<String, String> {
    crate::store::file::read_text_file(&resolve_settings_path(&settings_path)?, file_path)
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

    if old_path != PathBuf::from(&next_path) {
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

    if old_path != PathBuf::from(&next_path) {
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

fn resolve_settings_path(settings_path: &State<SharedSettingsPath>) -> Result<PathBuf, String> {
    settings_path
        .0
        .lock()
        .map_err(|error| error.to_string())
        .map(|path| path.clone())
}
