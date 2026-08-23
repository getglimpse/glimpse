//! Application settings IPC commands.
//!
//! This module exposes settings-related operations to the frontend.
//!
//! Supported operations:
//!
//! - load application settings
//! - update application settings
//! - open `settings.json`
//! - switch current target groups
//!
//! The actual settings persistence is implemented in:
//!
//! - `store::settings`
//!
//! Target-group switching and related indexing behavior are delegated to:
//!
//! - `IndexerRuntime`

use std::sync::Arc;
use tauri::{AppHandle, State};
use tracing::{debug, error, info};

use crate::app_state::SharedSettingsPath;
use crate::models::settings::{AppSettings, PartialAppSettings, TargetGroup};
use crate::shortcuts::register_global_shortcuts;
use crate::store::indexer::runtime::IndexerRuntime;
use crate::store::settings::{load_settings, normalize_settings, save_settings};

/// Loads the current application settings.
///
/// Settings are read from `settings.json` stored in the application data
/// directory.
///
/// # Returns
///
/// Fully populated [`AppSettings`].
#[tauri::command]
pub fn get_settings(settings_path: State<SharedSettingsPath>) -> Result<AppSettings, String> {
    let path = settings_path
        .0
        .lock()
        .map_err(|error| {
            error!(error = %error, "failed to lock settings path");
            error.to_string()
        })?
        .clone();

    debug!(settings_path = %path.display(), "loading settings");

    Ok(load_settings(&path))
}

/// Updates application settings.
///
/// This command:
///
/// 1. Loads the existing settings.
/// 2. Applies partial updates.
/// 3. Saves the updated settings back to disk.
///
/// Only fields present in [`PartialAppSettings`] are modified.
///
/// # Returns
///
/// The updated [`AppSettings`] after persistence.
#[tauri::command]
pub async fn set_settings(
    app: AppHandle,
    runtime: tauri::State<'_, Arc<IndexerRuntime>>,
    settings_path: State<'_, SharedSettingsPath>,
    partial: PartialAppSettings,
) -> Result<AppSettings, String> {
    let path = settings_path
        .0
        .lock()
        .map_err(|error| {
            error!(error = %error, "failed to lock settings path");
            error.to_string()
        })?
        .clone();

    debug!(
        settings_path = %path.display(),
        "updating settings"
    );

    let previous_settings = load_settings(&path);
    let mut settings = previous_settings.clone();

    apply_partial_settings(&mut settings, partial);
    settings = normalize_settings(settings);
    let should_update_indexer_runtime =
        indexer_runtime_inputs_changed(&previous_settings, &settings);

    save_settings(&path, &settings)?;

    info!(
        settings_path = %path.display(),
        "settings saved"
    );

    if let Err(error) = register_global_shortcuts(&app, &settings) {
        error!(
            error = %error,
            "failed to reload global shortcuts"
        );
    } else {
        debug!("global shortcuts reloaded");
    }

    if should_update_indexer_runtime {
        runtime
            .apply_settings_update(&previous_settings, settings.clone())
            .await?;
    }

    Ok(settings)
}

fn indexer_runtime_inputs_changed(previous: &AppSettings, next: &AppSettings) -> bool {
    previous.current_target_group_id != next.current_target_group_id
        || indexing_settings_changed(previous, next)
        || target_group_runtime_inputs_changed(&previous.target_groups, &next.target_groups)
}

fn indexing_settings_changed(previous: &AppSettings, next: &AppSettings) -> bool {
    previous.indexing.ignore_hidden_files != next.indexing.ignore_hidden_files
        || previous.indexing.ignore_patterns != next.indexing.ignore_patterns
        || previous.indexing.max_file_size_bytes != next.indexing.max_file_size_bytes
        || previous.indexing.excluded_extensions != next.indexing.excluded_extensions
}

fn target_group_runtime_inputs_changed(previous: &[TargetGroup], next: &[TargetGroup]) -> bool {
    previous.len() != next.len()
        || previous.iter().zip(next).any(|(previous, next)| {
            previous.id != next.id || previous.name != next.name || previous.paths != next.paths
        })
}

/// Applies partial settings updates.
///
/// This helper performs field-by-field merging so callers can update only a
/// subset of settings without replacing the entire configuration.
///
/// Nested settings are merged selectively where appropriate.
fn apply_partial_settings(settings: &mut AppSettings, partial: PartialAppSettings) {
    if let Some(theme) = partial.theme {
        debug!("applying partial setting: theme");
        settings.theme = theme;
    }

    if let Some(target_groups) = partial.target_groups {
        debug!(
            count = target_groups.len(),
            "applying partial setting: target_groups"
        );
        settings.target_groups = target_groups;
    }

    if let Some(current_target_group_id) = partial.current_target_group_id {
        debug!(
            current_target_group_id = %current_target_group_id,
            "applying partial setting: current_target_group_id"
        );
        settings.current_target_group_id = Some(current_target_group_id);
    }

    if let Some(indexing) = partial.indexing {
        debug!("applying partial setting: indexing");
        settings.indexing = indexing;
    }

    if let Some(commands) = partial.commands {
        debug!("applying partial setting: commands");
        settings.commands = commands;
    }

    if let Some(plugins) = partial.plugins {
        debug!("applying partial setting: plugins");
        settings.plugins = plugins;
    }

    if let Some(ui) = partial.ui {
        debug!("applying partial setting: ui");

        if let Some(compact_list_items) = ui.compact_list_items {
            debug!(
                compact_list_items,
                "applying partial setting: ui.compact_list_items"
            );
            settings.ui.compact_list_items = compact_list_items;
        }

        if let Some(language) = ui.language {
            debug!(
                language = ?language,
                "applying partial setting: ui.language"
            );
            settings.ui.language = language;
        }
    }

    if let Some(experimental) = partial.experimental {
        debug!("applying partial setting: experimental");

        if let Some(capture_selected_text_on_activation) =
            experimental.capture_selected_text_on_activation
        {
            debug!(
                capture_selected_text_on_activation,
                "applying partial setting: experimental.capture_selected_text_on_activation"
            );
            settings.experimental.capture_selected_text_on_activation =
                capture_selected_text_on_activation;
        }
    }

    if let Some(keybindings) = partial.keybindings {
        debug!(
            count = keybindings.len(),
            "applying partial setting: keybindings"
        );
        settings.keybindings = keybindings;
    }
}

/// Opens `settings.json` with the operating system's default application.
///
/// This allows users to edit the configuration file directly.
#[tauri::command]
pub fn open_settings_file(settings_path: State<SharedSettingsPath>) -> Result<(), String> {
    let path = settings_path
        .0
        .lock()
        .map_err(|error| {
            error!(error = %error, "failed to lock settings path");
            error.to_string()
        })?
        .clone();

    debug!(
        settings_path = %path.display(),
        "opening settings file"
    );

    opener::open(&path).map_err(|error| {
        error!(
            settings_path = %path.display(),
            error = %error,
            "failed to open settings file"
        );
        error.to_string()
    })
}

/// Switches to the next target group.
///
/// The switching logic is delegated to [`IndexerRuntime`], which updates
/// both runtime state and persisted settings.
///
/// # Returns
///
/// Updated [`AppSettings`] reflecting the new current target group.
#[tauri::command]
pub async fn switch_next_target_group(
    runtime: tauri::State<'_, Arc<IndexerRuntime>>,
) -> Result<AppSettings, String> {
    debug!("switching to next target group");

    runtime.switch_next_target_group().await.map(|settings| {
        info!(
            current_target_group_id = ?settings.current_target_group_id,
            "switched to next target group"
        );

        settings
    })
}

/// Switches to a specific target group by ID.
///
/// The runtime validates the group, updates the active selection, and
/// persists the result to `settings.json`.
///
/// # Arguments
///
/// - `group_id`
///
///   Identifier of the target group to activate.
///
/// # Returns
///
/// Updated [`AppSettings`] after the switch operation.
#[tauri::command]
pub async fn switch_target_group(
    runtime: tauri::State<'_, Arc<IndexerRuntime>>,
    group_id: String,
) -> Result<AppSettings, String> {
    debug!(
        group_id = %group_id,
        "switching target group"
    );

    runtime.switch_target_group(group_id).await.map(|settings| {
        info!(
            current_target_group_id = ?settings.current_target_group_id,
            "switched target group"
        );

        settings
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::models::settings::PartialExperimentalSettings;

    fn target_group(id: &str, active: bool, paths: Vec<&str>) -> TargetGroup {
        TargetGroup {
            id: id.to_string(),
            name: id.to_string(),
            paths: paths.into_iter().map(String::from).collect(),
            active,
        }
    }

    #[test]
    fn active_only_target_group_change_does_not_update_indexer_runtime() {
        let previous = AppSettings {
            target_groups: vec![
                target_group("work", true, vec!["/work"]),
                target_group("archive", true, vec!["/archive"]),
            ],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        let next = AppSettings {
            target_groups: vec![
                target_group("work", true, vec!["/work"]),
                target_group("archive", false, vec!["/archive"]),
            ],
            ..previous.clone()
        };

        assert!(!indexer_runtime_inputs_changed(&previous, &next));
    }

    #[test]
    fn target_group_path_change_updates_indexer_runtime() {
        let previous = AppSettings {
            target_groups: vec![target_group("work", true, vec!["/work"])],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        let next = AppSettings {
            target_groups: vec![target_group("work", true, vec!["/work", "/docs"])],
            ..previous.clone()
        };

        assert!(indexer_runtime_inputs_changed(&previous, &next));
    }

    #[test]
    fn current_target_group_change_updates_indexer_runtime() {
        let previous = AppSettings {
            target_groups: vec![
                target_group("work", true, vec!["/work"]),
                target_group("docs", true, vec!["/docs"]),
            ],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        let next = AppSettings {
            current_target_group_id: Some("docs".to_string()),
            ..previous.clone()
        };

        assert!(indexer_runtime_inputs_changed(&previous, &next));
    }

    #[test]
    fn indexing_change_updates_indexer_runtime() {
        let previous = AppSettings {
            target_groups: vec![target_group("work", true, vec!["/work"])],
            current_target_group_id: Some("work".to_string()),
            ..Default::default()
        };

        let mut next = previous.clone();
        next.indexing.ignore_patterns.push("tmp/**".to_string());

        assert!(indexer_runtime_inputs_changed(&previous, &next));
    }

    #[test]
    fn applies_partial_experimental_settings() {
        let mut settings = AppSettings::default();

        apply_partial_settings(
            &mut settings,
            PartialAppSettings {
                experimental: Some(PartialExperimentalSettings {
                    capture_selected_text_on_activation: Some(true),
                }),
                ..Default::default()
            },
        );

        assert!(settings.experimental.capture_selected_text_on_activation);
    }
}
