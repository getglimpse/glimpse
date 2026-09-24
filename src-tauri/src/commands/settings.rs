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
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, error, info};

use crate::app_state::SharedSettingsPath;
use crate::models::settings::{AppSettings, PartialAppSettings, TargetGroup};
use crate::shortcuts::{
    global_shortcut_settings_changed, register_global_shortcuts, validate_global_shortcuts,
};
use crate::store::indexer::runtime::IndexerRuntime;
use crate::store::settings::{
    load_settings, normalize_settings, prepare_settings_backup, restore_prepared_settings_backup,
    save_settings, settings_recovery_status, try_load_settings, SettingsRecoveryStatus,
};

static SETTINGS_UPDATE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

trait SettingsEffects {
    async fn apply_runtime(&self, previous: &AppSettings, next: &AppSettings)
        -> Result<(), String>;
    fn register_shortcuts(&self, settings: &AppSettings) -> Result<(), String>;
}

struct AppSettingsEffects<'a> {
    app: &'a AppHandle,
    runtime: &'a IndexerRuntime,
}

impl SettingsEffects for AppSettingsEffects<'_> {
    async fn apply_runtime(
        &self,
        previous: &AppSettings,
        next: &AppSettings,
    ) -> Result<(), String> {
        self.runtime
            .apply_settings_update(previous, next.clone())
            .await
    }

    fn register_shortcuts(&self, settings: &AppSettings) -> Result<(), String> {
        register_global_shortcuts(self.app, settings)
    }
}

async fn rollback_settings_effects<E: SettingsEffects>(
    effects: &E,
    previous: &AppSettings,
    next: &AppSettings,
    rollback_runtime: bool,
    rollback_shortcuts: bool,
    original_error: String,
) -> String {
    let mut errors = vec![original_error];
    if rollback_shortcuts {
        if let Err(error) = effects.register_shortcuts(previous) {
            errors.push(format!("shortcut rollback failed: {error}"));
        }
    }
    if rollback_runtime {
        if let Err(error) = effects.apply_runtime(next, previous).await {
            errors.push(format!("runtime rollback failed: {error}"));
        }
    }
    errors.join("; ")
}

async fn apply_settings_transaction<E, F>(
    effects: &E,
    previous: &AppSettings,
    next: &AppSettings,
    commit: F,
) -> Result<(), String>
where
    E: SettingsEffects,
    F: FnOnce() -> Result<(), String>,
{
    let update_runtime = indexer_runtime_inputs_changed(previous, next);
    let update_shortcuts = global_shortcut_settings_changed(previous, next);
    if update_shortcuts {
        validate_global_shortcuts(next)?;
    }

    if update_runtime {
        if let Err(error) = effects.apply_runtime(previous, next).await {
            return Err(
                rollback_settings_effects(effects, previous, next, true, false, error).await,
            );
        }
    }
    if update_shortcuts {
        if let Err(error) = effects.register_shortcuts(next) {
            return Err(rollback_settings_effects(
                effects,
                previous,
                next,
                update_runtime,
                true,
                error,
            )
            .await);
        }
    }
    if let Err(error) = commit() {
        return Err(rollback_settings_effects(
            effects,
            previous,
            next,
            update_runtime,
            update_shortcuts,
            error,
        )
        .await);
    }
    Ok(())
}

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

    try_load_settings(&path)
}

#[tauri::command]
pub fn get_settings_recovery_status(
    settings_path: State<SharedSettingsPath>,
) -> Result<SettingsRecoveryStatus, String> {
    let path = settings_path
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    Ok(settings_recovery_status(&path))
}

#[tauri::command]
pub async fn restore_settings_backup(
    app: AppHandle,
    runtime: State<'_, Arc<IndexerRuntime>>,
    settings_path: State<'_, SharedSettingsPath>,
) -> Result<AppSettings, String> {
    let _update_guard = SETTINGS_UPDATE_LOCK.lock().await;
    let path = settings_path
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    let previous_settings = load_settings(&path);
    let prepared = prepare_settings_backup(&path)?;
    let effects = AppSettingsEffects {
        app: &app,
        runtime: runtime.inner().as_ref(),
    };
    apply_settings_transaction(&effects, &previous_settings, &prepared.settings, || {
        restore_prepared_settings_backup(&path, &prepared)
    })
    .await?;

    if let Err(error) = app.emit(crate::store::settings_watch::SETTINGS_CHANGED_EVENT, ()) {
        error!(error = %error, "failed to notify settings restore");
    }

    Ok(prepared.settings)
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
    let _update_guard = SETTINGS_UPDATE_LOCK.lock().await;
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

    let previous_settings = try_load_settings(&path)?;
    let mut settings = previous_settings.clone();

    apply_partial_settings(&mut settings, partial);
    settings = normalize_settings(settings);
    let effects = AppSettingsEffects {
        app: &app,
        runtime: runtime.inner().as_ref(),
    };
    apply_settings_transaction(&effects, &previous_settings, &settings, || {
        save_settings(&path, &settings)
    })
    .await?;

    info!(
        settings_path = %path.display(),
        "settings saved"
    );

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

        if let Some(close_to_tray) = ui.close_to_tray {
            debug!(close_to_tray, "applying partial setting: ui.close_to_tray");
            settings.ui.close_to_tray = close_to_tray;
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

    runtime
        .switch_next_target_group()
        .await
        .inspect(|settings| {
            info!(
                current_target_group_id = ?settings.current_target_group_id,
                "switched to next target group"
            );
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

    runtime
        .switch_target_group(group_id)
        .await
        .inspect(|settings| {
            info!(
                current_target_group_id = ?settings.current_target_group_id,
                "switched target group"
            );
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::models::settings::{
        KeybindingValue, PartialExperimentalSettings, PartialUiSettings,
    };
    use std::cell::Cell;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeSettingsEffects {
        events: Mutex<Vec<&'static str>>,
        fail_runtime_apply: bool,
        fail_shortcut_apply: bool,
        fail_runtime_rollback: bool,
        fail_shortcut_rollback: bool,
    }

    impl SettingsEffects for FakeSettingsEffects {
        async fn apply_runtime(
            &self,
            _previous: &AppSettings,
            next: &AppSettings,
        ) -> Result<(), String> {
            let rollback = next.theme == "old";
            self.events.lock().unwrap().push(if rollback {
                "runtime:old"
            } else {
                "runtime:new"
            });
            if (rollback && self.fail_runtime_rollback) || (!rollback && self.fail_runtime_apply) {
                Err("injected runtime failure".into())
            } else {
                Ok(())
            }
        }

        fn register_shortcuts(&self, settings: &AppSettings) -> Result<(), String> {
            let rollback = settings.theme == "old";
            self.events.lock().unwrap().push(if rollback {
                "shortcuts:old"
            } else {
                "shortcuts:new"
            });
            if (rollback && self.fail_shortcut_rollback) || (!rollback && self.fail_shortcut_apply)
            {
                Err("injected shortcut failure".into())
            } else {
                Ok(())
            }
        }
    }

    fn settings_transition() -> (AppSettings, AppSettings) {
        let mut previous = AppSettings {
            theme: "old".into(),
            current_target_group_id: Some("old".into()),
            ..Default::default()
        };
        previous.keybindings.insert(
            "toggleMainWindow".into(),
            KeybindingValue::One("Ctrl+Space".into()),
        );
        let mut next = previous.clone();
        next.theme = "new".into();
        next.current_target_group_id = Some("new".into());
        next.keybindings.insert(
            "toggleMainWindow".into(),
            KeybindingValue::One("Alt+Space".into()),
        );
        (previous, next)
    }

    #[tokio::test]
    async fn runtime_failure_does_not_commit_settings() {
        let (previous, next) = settings_transition();
        let effects = FakeSettingsEffects {
            fail_runtime_apply: true,
            ..Default::default()
        };
        let committed = Cell::new(false);
        let result = apply_settings_transaction(&effects, &previous, &next, || {
            committed.set(true);
            Ok(())
        })
        .await;

        assert!(result.unwrap_err().contains("injected runtime failure"));
        assert!(!committed.get());
        assert_eq!(
            *effects.events.lock().unwrap(),
            ["runtime:new", "runtime:old"]
        );
    }

    #[tokio::test]
    async fn shortcut_failure_restores_previous_runtime_and_shortcuts() {
        let (previous, next) = settings_transition();
        let effects = FakeSettingsEffects {
            fail_shortcut_apply: true,
            ..Default::default()
        };
        let committed = Cell::new(false);
        let result = apply_settings_transaction(&effects, &previous, &next, || {
            committed.set(true);
            Ok(())
        })
        .await;

        assert!(result.unwrap_err().contains("injected shortcut failure"));
        assert!(!committed.get());
        assert_eq!(
            *effects.events.lock().unwrap(),
            [
                "runtime:new",
                "shortcuts:new",
                "shortcuts:old",
                "runtime:old"
            ]
        );
    }

    #[tokio::test]
    async fn settings_commit_failure_restores_both_effects() {
        let (previous, next) = settings_transition();
        let effects = FakeSettingsEffects::default();
        let result = apply_settings_transaction(&effects, &previous, &next, || {
            Err("injected disk failure".into())
        })
        .await;

        assert!(result.unwrap_err().contains("injected disk failure"));
        assert_eq!(
            *effects.events.lock().unwrap(),
            [
                "runtime:new",
                "shortcuts:new",
                "shortcuts:old",
                "runtime:old"
            ]
        );
    }

    #[tokio::test]
    async fn rollback_failures_are_reported_without_skipping_other_rollback() {
        let (previous, next) = settings_transition();
        let effects = FakeSettingsEffects {
            fail_shortcut_rollback: true,
            fail_runtime_rollback: true,
            ..Default::default()
        };
        let error = apply_settings_transaction(&effects, &previous, &next, || {
            Err("injected disk failure".into())
        })
        .await
        .unwrap_err();

        assert!(error.contains("shortcut rollback failed"));
        assert!(error.contains("runtime rollback failed"));
        assert_eq!(effects.events.lock().unwrap().len(), 4);
    }

    #[tokio::test]
    async fn backup_restore_shortcut_failure_keeps_primary_settings() {
        let dir = crate::test_utils::fixtures::unique_test_path("glimpse-restore-test-", "");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let (previous, backup_settings) = settings_transition();
        save_settings(&path, &backup_settings).unwrap();
        save_settings(&path, &previous).unwrap();
        let prepared = prepare_settings_backup(&path).unwrap();
        let effects = FakeSettingsEffects {
            fail_shortcut_apply: true,
            ..Default::default()
        };

        let result = apply_settings_transaction(&effects, &previous, &prepared.settings, || {
            restore_prepared_settings_backup(&path, &prepared)
        })
        .await;

        assert!(result.is_err());
        assert_eq!(try_load_settings(&path).unwrap().theme, "old");
        std::fs::remove_dir_all(dir).unwrap();
    }

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

    #[test]
    fn applies_partial_close_to_tray_setting() {
        let mut settings = AppSettings::default();

        apply_partial_settings(
            &mut settings,
            PartialAppSettings {
                ui: Some(PartialUiSettings {
                    close_to_tray: Some(false),
                    ..Default::default()
                }),
                ..Default::default()
            },
        );

        assert!(!settings.ui.close_to_tray);
    }
}
