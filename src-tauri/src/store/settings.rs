//! Application settings storage.
//!
//! This module owns loading, saving, creating, and normalizing
//! `settings.json`.
//!
//! Responsibilities:
//!
//! - Load application settings from disk.
//! - Create default settings on first launch.
//! - Save settings as pretty-printed JSON.
//! - Normalize user-editable settings.
//! - Repair invalid current Target Group references.
//!
//! # Design
//!
//! `settings.json` is user-editable.
//!
//! Because of that, loaded settings are normalized before being returned.
//! This keeps the rest of the backend from having to handle common invalid
//! states such as:
//!
//! - empty Target Group IDs
//! - duplicate paths
//! - missing current Target Group
//! - unsupported language values
//! - duplicate command policy entries
//!
//! Invalid settings are never overwritten by an automatic save. A valid
//! backup is used for read-only fallback, while IPC reads report the error.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::models::settings::{
    AppSettings, CommandPolicyMode, IndexingSettings, KeybindingValue, TargetGroup,
};

/// Loads application settings from disk.
///
/// If the file exists and can be parsed, the parsed settings are normalized
/// before being returned.
///
/// If the file cannot be read or parsed, a valid backup is preferred over
/// defaults for internal, read-only callers. IPC callers use
/// [`try_load_settings`] to surface the error instead.
///
/// # Behavior
///
/// - Valid file → parse and normalize.
/// - Invalid JSON → use a valid backup, or in-memory defaults.
/// - Missing file → save defaults and return defaults.
///
/// # Notes
///
/// This function is intentionally forgiving because `settings.json` is
/// user-editable.
pub fn load_settings(path: &Path) -> AppSettings {
    match try_load_settings(path) {
        Ok(settings) => return settings,
        Err(error) => warn!(settings_path = %path.display(), %error, "failed to load settings"),
    }

    let backup = backup_path(path);
    if let Ok(settings) = try_load_settings(&backup) {
        warn!(backup_path = %backup.display(), "using settings backup in memory");
        return settings;
    }

    let settings = AppSettings::default();
    if !path.exists() {
        if let Err(error) = save_settings(path, &settings) {
            warn!(settings_path = %path.display(), %error, "failed to create default settings file");
        } else {
            info!(settings_path = %path.display(), "default settings file created");
        }
    }
    normalize_settings(settings)
}

/// Strict settings read for IPC mutations and UI. Never silently substitutes
/// defaults or a backup for a corrupt primary file.
pub fn try_load_settings(path: &Path) -> Result<AppSettings, String> {
    let content = fs::read(path)
        .map_err(|error| format!("failed to read settings {}: {error}", path.display()))?;
    serde_json::from_slice::<AppSettings>(&content)
        .map(normalize_settings)
        .map_err(|error| {
            let backup = backup_path(path);
            let recovery = if backup.is_file() {
                format!(" A backup may be available at {}.", backup.display())
            } else {
                String::new()
            };
            format!(
                "settings file {} is invalid: {error}. Fix it before saving.{recovery}",
                path.display()
            )
        })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsRecoveryStatus {
    pub needs_recovery: bool,
    pub backup_available: bool,
    pub error: Option<String>,
}

pub fn settings_recovery_status(path: &Path) -> SettingsRecoveryStatus {
    let error = try_load_settings(path).err();
    SettingsRecoveryStatus {
        needs_recovery: error.is_some(),
        backup_available: try_load_settings(&backup_path(path)).is_ok(),
        error,
    }
}

/// Restores only a validated backup. The current file is preserved verbatim
/// under a unique sibling name before the atomic replacement.
pub fn restore_settings_backup(path: &Path) -> Result<AppSettings, String> {
    let prepared = prepare_settings_backup(path)?;
    restore_prepared_settings_backup(path, &prepared)?;
    Ok(prepared.settings)
}

pub struct PreparedSettingsBackup {
    pub settings: AppSettings,
    bytes: Vec<u8>,
}

/// Reads and validates one backup snapshot without changing the current file.
pub fn prepare_settings_backup(path: &Path) -> Result<PreparedSettingsBackup, String> {
    let backup = backup_path(path);
    let backup_bytes = fs::read(&backup).map_err(|error| {
        format!(
            "failed to read settings backup {}: {error}",
            backup.display()
        )
    })?;
    let restored = serde_json::from_slice::<AppSettings>(&backup_bytes)
        .map(normalize_settings)
        .map_err(|error| format!("settings backup {} is invalid: {error}", backup.display()))?;

    Ok(PreparedSettingsBackup {
        settings: restored,
        bytes: backup_bytes,
    })
}

/// Commits the previously validated bytes, even if the backup changes later.
pub fn restore_prepared_settings_backup(
    path: &Path,
    prepared: &PreparedSettingsBackup,
) -> Result<(), String> {
    match fs::read(path) {
        Ok(current) => {
            let label = if try_load_settings(path).is_ok() {
                "before-restore"
            } else {
                "corrupt"
            };
            let preserved = path.with_file_name(format!(
                "{}.{}.{}",
                path.file_name()
                    .ok_or("settings path has no file name")?
                    .to_string_lossy(),
                label,
                Uuid::new_v4()
            ));
            atomic_write(&preserved, &current)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "failed to preserve current settings {}: {error}",
                path.display()
            ));
        }
    }

    atomic_write(path, &prepared.bytes)
}

/// Ensures that the initial `settings.json` file exists.
///
/// Used during application startup.
///
/// If the file already exists, it is left unchanged.
///
/// When creating the file, this function initializes:
///
/// - one default Target Group
/// - the current Target Group ID
/// - all other settings from [`AppSettings::default`]
///
/// # Default Target Group
///
/// ```text
/// id: welcome
/// name: Welcome
/// paths: [default_target_dir]
/// ```
pub fn ensure_default_settings(path: &Path, default_target_dir: &Path) -> Result<(), String> {
    if path.exists() {
        debug!(
            settings_path = %path.display(),
            "settings file already exists"
        );
        return Ok(());
    }

    info!(
        settings_path = %path.display(),
        default_target_dir = %default_target_dir.display(),
        "creating default settings"
    );

    let settings = AppSettings {
        target_groups: vec![TargetGroup {
            id: "welcome".to_string(),
            name: "Welcome".to_string(),
            paths: vec![default_target_dir.to_string_lossy().to_string()],
            active: true,
        }],
        current_target_group_id: Some("welcome".to_string()),
        ..Default::default()
    };

    save_settings(path, &settings)?;

    info!(
        settings_path = %path.display(),
        "default settings created"
    );

    Ok(())
}

/// Saves application settings as pretty-printed JSON using a same-directory
/// temporary file and atomic replacement. The previous valid version is
/// retained in `settings.json.bak`.
///
/// Parent directories are created automatically.
///
/// # Errors
///
/// Returns an error when:
///
/// - the parent directory cannot be created
/// - serialization fails
/// - the existing file is invalid or unreadable
/// - the temporary file cannot be written, synced, or renamed
pub fn save_settings(path: &Path, settings: &AppSettings) -> Result<(), String> {
    debug!(
        settings_path = %path.display(),
        "saving settings"
    );

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            warn!(
                settings_path = %path.display(),
                parent = %parent.display(),
                error = %error,
                "failed to create settings directory"
            );
            error.to_string()
        })?;
    }

    let content = serde_json::to_string_pretty(settings).map_err(|error| {
        warn!(
            settings_path = %path.display(),
            error = %error,
            "failed to serialize settings"
        );
        error.to_string()
    })?;

    let previous = match fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice::<AppSettings>(&bytes).map_err(|error| {
                format!(
                    "refusing to overwrite invalid settings file {}: {error}",
                    path.display()
                )
            })?;
            Some(bytes)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "failed to read existing settings {}: {error}",
                path.display()
            ));
        }
    };

    if let Some(previous) = previous {
        atomic_write(&backup_path(path), &previous)?;
    }
    atomic_write(path, content.as_bytes())?;

    debug!(
        settings_path = %path.display(),
        "settings saved"
    );

    Ok(())
}

fn backup_path(path: &Path) -> PathBuf {
    let mut backup = path.as_os_str().to_os_string();
    backup.push(".bak");
    PathBuf::from(backup)
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("settings path has no parent directory")?;
    let name = path.file_name().ok_or("settings path has no file name")?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        name.to_string_lossy(),
        Uuid::new_v4()
    ));
    let result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("failed to create {}: {error}", temporary.display()))?;
        file.write_all(content)
            .map_err(|error| format!("failed to write {}: {error}", temporary.display()))?;
        file.sync_all()
            .map_err(|error| format!("failed to sync {}: {error}", temporary.display()))?;
        drop(file);
        fs::rename(&temporary, path).map_err(|error| {
            format!(
                "failed to replace {} with {}: {error}",
                path.display(),
                temporary.display()
            )
        })?;
        #[cfg(unix)]
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("failed to sync {}: {error}", parent.display()))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Normalizes loaded settings.
///
/// This function repairs common user-editing issues and keeps the rest of
/// the backend working with a predictable settings structure.
pub(crate) fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    debug!("normalizing settings");

    normalize_commands(&mut settings);
    normalize_indexing(&mut settings.indexing);
    normalize_plugins(&mut settings);
    normalize_target_groups(&mut settings);
    normalize_ui(&mut settings);
    normalize_keybindings(&mut settings);

    debug!(
        target_group_count = settings.target_groups.len(),
        current_target_group_id = ?settings.current_target_group_id,
        keybinding_count = settings.keybindings.len(),
        "settings normalized"
    );

    settings
}

fn normalize_indexing(indexing: &mut IndexingSettings) {
    indexing.ignore_patterns = dedupe_non_empty(indexing.ignore_patterns.clone());
    indexing.excluded_extensions = dedupe_non_empty(indexing.excluded_extensions.clone())
        .into_iter()
        .map(|extension| extension.trim_start_matches('.').to_ascii_lowercase())
        .collect();
    let mut seen_extensions = HashSet::new();
    indexing
        .excluded_extensions
        .retain(|extension| seen_extensions.insert(extension.clone()));

    migrate_legacy_media_exclusions(indexing);
}

fn migrate_legacy_media_exclusions(indexing: &mut IndexingSettings) {
    let legacy_default_extensions = [
        "exe", "dll", "zip", "7z", "mp4", "mov", "db", "sqlite", "sqlite3",
    ];
    let looks_like_legacy_default = legacy_default_extensions.iter().all(|extension| {
        indexing
            .excluded_extensions
            .iter()
            .any(|entry| entry == extension)
    });

    if !looks_like_legacy_default {
        return;
    }

    indexing
        .excluded_extensions
        .retain(|extension| !matches!(extension.as_str(), "mp4" | "mov"));
}

/// Normalizes keybinding settings.
///
/// User-defined keybindings are merged over default keybindings.
/// Empty action names are ignored.
/// Empty keybinding lists are preserved to disable a default keybinding.
///
/// This keeps all known actions available while still allowing users to
/// override only part of the keybinding map.
fn normalize_keybindings(settings: &mut AppSettings) {
    let mut keybindings = crate::models::settings::default_keybindings();

    for (action, value) in settings.keybindings.clone() {
        let action = action.trim().to_string();

        if action.is_empty() {
            debug!("ignored keybinding with empty action name");
            continue;
        }

        match normalize_keybinding_value(value) {
            Some(value) => {
                let value = remove_legacy_search_boundary_keybindings(&action, value);

                let Some(value) = value else {
                    keybindings.remove(&action);
                    debug!(
                        action = %action,
                        "removed legacy search boundary keybinding"
                    );
                    continue;
                };

                let value = remove_legacy_copy_preview_content_keybinding(&action, value);

                keybindings.insert(action.clone(), value);
                debug!(
                    action = %action,
                    "normalized keybinding"
                );
            }
            None => {
                keybindings.remove(&action);
                debug!(
                    action = %action,
                    "removed empty keybinding"
                );
            }
        }
    }

    settings.keybindings = keybindings;
}

fn remove_legacy_copy_preview_content_keybinding(
    action: &str,
    value: KeybindingValue,
) -> KeybindingValue {
    if action != "copyActivePreviewContent" {
        return value;
    }

    match value {
        KeybindingValue::One(key) if key == "Ctrl+C" => KeybindingValue::Many(Vec::new()),
        KeybindingValue::One(key) => KeybindingValue::One(key),
        KeybindingValue::Many(keys) => {
            let keys: Vec<String> = keys.into_iter().filter(|key| key != "Ctrl+C").collect();

            match keys.len() {
                0 => KeybindingValue::Many(Vec::new()),
                1 => keys.into_iter().next().map(KeybindingValue::One).unwrap(),
                _ => KeybindingValue::Many(keys),
            }
        }
    }
}

fn remove_legacy_search_boundary_keybindings(
    action: &str,
    value: KeybindingValue,
) -> Option<KeybindingValue> {
    let legacy_key = match action {
        "selectFirstItem" => "Home",
        "selectLastItem" => "End",
        _ => return Some(value),
    };

    match value {
        KeybindingValue::One(key) if key == legacy_key => None,
        KeybindingValue::One(key) => Some(KeybindingValue::One(key)),
        KeybindingValue::Many(keys) => {
            let keys: Vec<String> = keys.into_iter().filter(|key| key != legacy_key).collect();

            match keys.len() {
                0 => None,
                1 => keys.into_iter().next().map(KeybindingValue::One),
                _ => Some(KeybindingValue::Many(keys)),
            }
        }
    }
}

/// Normalizes a single keybinding value.
///
/// Supports both:
///
/// - `"Ctrl+L"`
/// - `["Ctrl+L", "Ctrl+/"]`
/// - `[]` to disable the action
fn normalize_keybinding_value(value: KeybindingValue) -> Option<KeybindingValue> {
    match value {
        KeybindingValue::One(key) => {
            let key = key.trim();

            if key.is_empty() {
                None
            } else {
                Some(KeybindingValue::One(key.to_string()))
            }
        }

        KeybindingValue::Many(keys) => {
            let keys = dedupe_non_empty(keys);

            if keys.is_empty() {
                Some(KeybindingValue::Many(Vec::new()))
            } else {
                Some(KeybindingValue::Many(keys))
            }
        }
    }
}

/// Normalizes UI-related settings.
///
/// Currently supported languages:
///
/// - `en`
/// - `ja`
///
/// Unsupported or empty language values fall back to `en`.
fn normalize_ui(settings: &mut AppSettings) {
    let language = settings.ui.language.trim();

    settings.ui.language = match language {
        "en" | "ja" => language.to_string(),
        invalid => {
            warn!(
                language = %invalid,
                "unsupported UI language; falling back to en"
            );
            "en".to_string()
        }
    };
}

fn normalize_plugins(settings: &mut AppSettings) {
    settings.plugins.retain(|plugin_id, plugin_settings| {
        let keep = is_valid_plugin_id(plugin_id);

        if keep {
            normalize_plugin_trust(plugin_id, plugin_settings);
            normalize_plugin_provenance(plugin_id, plugin_settings);
            normalize_plugin_search_result_copy_settings(
                &mut plugin_settings.copy_successful_search_results,
            );
            normalize_plugin_preferences(&mut plugin_settings.preferences);
        } else {
            warn!(
                plugin_id = %plugin_id,
                "removed invalid plugin settings record"
            );
        }

        keep && (plugin_settings.trust.is_some()
            || plugin_settings.provenance.is_some()
            || !plugin_settings.copy_successful_search_results.is_empty()
            || !plugin_settings.preferences.is_empty())
    });
}

fn normalize_plugin_trust(
    plugin_id: &str,
    plugin_settings: &mut crate::models::settings::PluginSettings,
) {
    let keep = plugin_settings.trust.as_ref().is_some_and(|record| {
        record
            .manifest_fingerprint
            .as_ref()
            .is_some_and(|fingerprint| !fingerprint.trim().is_empty())
            && record
                .version
                .as_ref()
                .is_some_and(|version| !version.trim().is_empty())
    });

    if !keep && plugin_settings.trust.is_some() {
        warn!(
            plugin_id = %plugin_id,
            "removed invalid plugin trust record"
        );
        plugin_settings.trust = None;
    }
}

fn normalize_plugin_provenance(
    plugin_id: &str,
    plugin_settings: &mut crate::models::settings::PluginSettings,
) {
    let keep =
        plugin_settings
            .provenance
            .as_ref()
            .is_some_and(|record| match record.install_source {
                crate::models::settings::PluginInstallSource::Local => true,
                crate::models::settings::PluginInstallSource::Remote => {
                    non_empty_option(record.registry_url.as_deref())
                        && non_empty_option(record.download_url.as_deref())
                        && non_empty_option(record.registry_sha256.as_deref())
                        && non_empty_option(record.installed_package_sha256.as_deref())
                }
            });

    if !keep && plugin_settings.provenance.is_some() {
        warn!(
            plugin_id = %plugin_id,
            "removed invalid plugin provenance record"
        );
        plugin_settings.provenance = None;
    }
}

fn non_empty_option(value: Option<&str>) -> bool {
    value.is_some_and(|value| !value.trim().is_empty())
}

fn normalize_plugin_search_result_copy_settings(action_settings: &mut HashMap<String, bool>) {
    action_settings.retain(|action_id, enabled| {
        let keep = *enabled && is_valid_plugin_action_id(action_id);

        if !keep {
            warn!(
                action_id = %action_id,
                "removed invalid plugin search result copy setting"
            );
        }

        keep
    });
}

fn normalize_plugin_preferences(preferences: &mut HashMap<String, String>) {
    preferences.retain(|key, value| {
        let keep = is_valid_plugin_action_id(key) && !value.trim().is_empty();

        if !keep {
            warn!(
                preference = %key,
                "removed invalid plugin preference"
            );
        }

        keep
    });
}

/// Normalizes command execution policy settings.
///
/// This removes empty and duplicate entries from:
///
/// - whitelist
/// - blacklist
/// - trusted directories
///
/// The policy mode itself is currently represented by an enum, so invalid
/// values should already be handled during deserialization/defaulting.
fn normalize_commands(settings: &mut AppSettings) {
    let whitelist_before = settings.commands.whitelist.len();
    let blacklist_before = settings.commands.blacklist.len();
    let trusted_before = settings.commands.trusted_directories.len();

    settings.commands.whitelist = dedupe_non_empty(settings.commands.whitelist.clone());
    settings.commands.blacklist = dedupe_non_empty(settings.commands.blacklist.clone());
    settings.commands.trusted_directories =
        dedupe_non_empty(settings.commands.trusted_directories.clone());

    debug!(
        whitelist_before,
        whitelist_after = settings.commands.whitelist.len(),
        blacklist_before,
        blacklist_after = settings.commands.blacklist.len(),
        trusted_directories_before = trusted_before,
        trusted_directories_after = settings.commands.trusted_directories.len(),
        policy_mode = ?settings.commands.policy_mode,
        "normalized command policy settings"
    );

    match settings.commands.policy_mode {
        CommandPolicyMode::None | CommandPolicyMode::Whitelist | CommandPolicyMode::Blacklist => {}
    }
}

/// Normalizes Target Group settings.
///
/// Invalid groups are removed.
///
/// A Target Group is considered invalid when:
///
/// - `id` is empty
/// - `name` is empty
///
/// If the current Target Group does not exist after normalization, the first
/// valid Target Group becomes current.
fn normalize_target_groups(settings: &mut AppSettings) {
    let before_count = settings.target_groups.len();
    let previous_current = settings.current_target_group_id.clone();

    settings.target_groups = settings
        .target_groups
        .iter()
        .filter_map(normalize_target_group)
        .collect();

    let current_exists = settings
        .current_target_group_id
        .as_ref()
        .is_some_and(|current_id| {
            settings
                .target_groups
                .iter()
                .any(|group| &group.id == current_id)
        });

    if !current_exists {
        settings.current_target_group_id =
            settings.target_groups.first().map(|group| group.id.clone());

        warn!(
            previous_current_target_group_id = ?previous_current,
            current_target_group_id = ?settings.current_target_group_id,
            "repaired current target group"
        );
    }

    if let Some(current_id) = settings.current_target_group_id.as_deref() {
        if let Some(current_group) = settings
            .target_groups
            .iter_mut()
            .find(|group| group.id == current_id)
        {
            current_group.active = true;
        }
    }

    debug!(
        before_count,
        after_count = settings.target_groups.len(),
        current_target_group_id = ?settings.current_target_group_id,
        "normalized target groups"
    );
}

/// Normalizes a single Target Group.
///
/// This trims:
///
/// - group ID
/// - group name
/// - paths
///
/// Empty and duplicate paths are removed.
///
/// Returns `None` when the group has no usable ID or name.
fn normalize_target_group(group: &TargetGroup) -> Option<TargetGroup> {
    let id = group.id.trim();
    let name = group.name.trim();

    if id.is_empty() || name.is_empty() {
        warn!(
            raw_id = %group.id,
            raw_name = %group.name,
            "removed invalid target group"
        );
        return None;
    }

    let path_count_before = group.paths.len();
    let paths = dedupe_non_empty(group.paths.clone());

    debug!(
        id = %id,
        name = %name,
        path_count_before,
        path_count_after = paths.len(),
        "normalized target group"
    );

    Some(TargetGroup {
        id: id.to_string(),
        name: name.to_string(),
        paths,
        active: group.active,
    })
}

/// Removes empty and duplicate string values while preserving order.
///
/// Each value is trimmed before comparison.
///
/// Example:
///
/// ```text
/// [" rust ", "", "tauri", "rust"]
/// -> ["rust", "tauri"]
/// ```
fn dedupe_non_empty(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();

    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn is_valid_plugin_id(plugin_id: &str) -> bool {
    let mut characters = plugin_id.chars();

    matches!(characters.next(), Some(character) if character.is_ascii_lowercase() || character.is_ascii_digit())
        && characters.all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '-' | '_' | '.')
        })
}

fn is_valid_plugin_action_id(action_id: &str) -> bool {
    !action_id.is_empty()
        && !action_id.contains("..")
        && action_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::models::settings::{AppSettings, TargetGroup};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir(name: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("glimpse_settings_test_{unique}_{name}"))
    }

    #[test]
    fn default_settings_create_welcome_target_group_for_default_workspace() {
        let settings_dir = unique_test_dir("settings");
        let settings_path = settings_dir.join("settings.json");
        let default_target_dir = unique_test_dir("workspace").join("Glimpse");

        ensure_default_settings(&settings_path, &default_target_dir).unwrap();

        let settings = load_settings(&settings_path);

        assert_eq!(settings.current_target_group_id, Some("welcome".into()));
        assert_eq!(settings.target_groups.len(), 1);
        assert_eq!(settings.target_groups[0].id, "welcome");
        assert_eq!(settings.target_groups[0].name, "Welcome");
        assert_eq!(
            settings.target_groups[0].paths,
            vec![default_target_dir.to_string_lossy().to_string()]
        );
        assert!(settings.target_groups[0].active);

        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn save_replaces_settings_and_keeps_previous_valid_backup() {
        let dir = unique_test_dir("atomic-backup");
        let path = dir.join("settings.json");
        let first = AppSettings {
            theme: "first".into(),
            ..Default::default()
        };
        save_settings(&path, &first).unwrap();
        let mut second = first.clone();
        second.theme = "second".into();
        save_settings(&path, &second).unwrap();

        assert_eq!(try_load_settings(&path).unwrap().theme, "second");
        assert_eq!(
            try_load_settings(&backup_path(&path)).unwrap().theme,
            "first"
        );
        assert!(fs::read_dir(&dir).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn corrupt_primary_is_not_overwritten_and_backup_is_available_for_read_only_use() {
        let dir = unique_test_dir("corrupt-backup");
        let path = dir.join("settings.json");
        let first = AppSettings {
            theme: "first".into(),
            ..Default::default()
        };
        save_settings(&path, &first).unwrap();
        let mut second = first.clone();
        second.theme = "second".into();
        save_settings(&path, &second).unwrap();
        fs::write(&path, b"{ incomplete").unwrap();

        assert!(try_load_settings(&path).unwrap_err().contains("invalid"));
        assert_eq!(load_settings(&path).theme, "first");
        assert!(save_settings(&path, &second)
            .unwrap_err()
            .contains("refusing"));
        assert_eq!(fs::read(&path).unwrap(), b"{ incomplete");
        assert_eq!(
            try_load_settings(&backup_path(&path)).unwrap().theme,
            "first"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn interrupted_temporary_write_does_not_change_settings() {
        let dir = unique_test_dir("interrupted-temp");
        let path = dir.join("settings.json");
        let settings = AppSettings::default();
        save_settings(&path, &settings).unwrap();
        let original = fs::read(&path).unwrap();
        fs::write(dir.join(".settings.json.interrupted.tmp"), b"{ incomplete").unwrap();

        assert_eq!(fs::read(&path).unwrap(), original);
        assert!(try_load_settings(&path).is_ok());
        save_settings(&path, &settings).unwrap();
        assert!(try_load_settings(&path).is_ok());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_backup_replacement_leaves_primary_unchanged() {
        let dir = unique_test_dir("backup-failure");
        let path = dir.join("settings.json");
        let first = AppSettings::default();
        save_settings(&path, &first).unwrap();
        let original = fs::read(&path).unwrap();
        fs::create_dir(backup_path(&path)).unwrap();
        let mut second = first.clone();
        second.theme = "changed".into();

        assert!(save_settings(&path, &second).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert!(try_load_settings(&path).is_ok());
        assert!(fs::read_dir(&dir).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn locked_primary_replacement_leaves_previous_settings_and_cleans_temporary_file() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = unique_test_dir("locked-primary");
        let path = dir.join("settings.json");
        let first = AppSettings::default();
        save_settings(&path, &first).unwrap();
        let original = fs::read(&path).unwrap();
        // Permit reading/writing but deny the delete access required to replace
        // an open destination on Windows.
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(0x0000_0001 | 0x0000_0002)
            .open(&path)
            .unwrap();
        let mut second = first.clone();
        second.theme = "changed".into();

        assert!(save_settings(&path, &second).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(
            try_load_settings(&backup_path(&path)).unwrap().theme,
            first.theme
        );
        assert!(fs::read_dir(&dir).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));
        drop(held);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn corrupt_primary_and_backup_are_reported_without_overwriting_either() {
        let dir = unique_test_dir("both-corrupt");
        let path = dir.join("settings.json");
        save_settings(&path, &AppSettings::default()).unwrap();
        fs::write(&path, b"{ broken primary").unwrap();
        fs::write(backup_path(&path), b"{ broken backup").unwrap();

        let status = settings_recovery_status(&path);
        assert!(status.needs_recovery);
        assert!(!status.backup_available);
        assert!(status.error.is_some());
        assert_eq!(load_settings(&path).theme, AppSettings::default().theme);
        assert!(restore_settings_backup(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{ broken primary");
        assert_eq!(fs::read(backup_path(&path)).unwrap(), b"{ broken backup");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn restore_valid_backup_preserves_corrupt_primary() {
        let dir = unique_test_dir("restore-corrupt");
        let path = dir.join("settings.json");
        let first = AppSettings {
            theme: "first".into(),
            ..Default::default()
        };
        save_settings(&path, &first).unwrap();
        let mut second = first.clone();
        second.theme = "second".into();
        save_settings(&path, &second).unwrap();
        let corrupt = b"{ incomplete";
        fs::write(&path, corrupt).unwrap();

        let status = settings_recovery_status(&path);
        assert!(status.needs_recovery);
        assert!(status.backup_available);
        let restored = restore_settings_backup(&path).unwrap();
        assert_eq!(restored.theme, "first");
        assert_eq!(try_load_settings(&path).unwrap().theme, "first");
        assert!(!settings_recovery_status(&path).needs_recovery);
        let preserved = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|entry| {
                entry
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("settings.json.corrupt.")
            })
            .unwrap();
        assert_eq!(fs::read(preserved).unwrap(), corrupt);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn restore_valid_backup_preserves_valid_primary() {
        let dir = unique_test_dir("restore-valid");
        let path = dir.join("settings.json");
        let first = AppSettings {
            theme: "first".into(),
            ..Default::default()
        };
        save_settings(&path, &first).unwrap();
        let mut second = first.clone();
        second.theme = "second".into();
        save_settings(&path, &second).unwrap();
        let current = fs::read(&path).unwrap();

        let status = settings_recovery_status(&path);
        assert!(!status.needs_recovery);
        assert!(status.backup_available);
        assert_eq!(restore_settings_backup(&path).unwrap().theme, "first");
        let preserved = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|entry| {
                entry
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("settings.json.before-restore.")
            })
            .unwrap();
        assert_eq!(fs::read(preserved).unwrap(), current);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn prepared_restore_uses_validated_snapshot_even_if_backup_changes() {
        let dir = unique_test_dir("prepared-restore");
        let path = dir.join("settings.json");
        let first = AppSettings {
            theme: "first".into(),
            ..Default::default()
        };
        save_settings(&path, &first).unwrap();
        let second = AppSettings {
            theme: "second".into(),
            ..Default::default()
        };
        save_settings(&path, &second).unwrap();

        let prepared = prepare_settings_backup(&path).unwrap();
        fs::write(backup_path(&path), b"{ changed after validation").unwrap();
        restore_prepared_settings_backup(&path, &prepared).unwrap();

        assert_eq!(try_load_settings(&path).unwrap().theme, "first");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_backup_cannot_replace_corrupt_primary() {
        let dir = unique_test_dir("restore-invalid-backup");
        let path = dir.join("settings.json");
        save_settings(&path, &AppSettings::default()).unwrap();
        fs::write(&path, b"{ corrupt primary").unwrap();
        fs::write(backup_path(&path), b"{ corrupt backup").unwrap();

        let status = settings_recovery_status(&path);
        assert!(status.needs_recovery);
        assert!(!status.backup_available);
        assert!(restore_settings_backup(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{ corrupt primary");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn removes_duplicate_commands() {
        let mut settings = AppSettings::default();

        settings.commands.whitelist = vec!["python".into(), "python".into(), "".into()];

        let settings = normalize_settings(settings);

        assert_eq!(settings.commands.whitelist, vec!["python"]);
    }

    #[test]
    fn normalizes_indexing_extensions_and_migrates_legacy_media_exclusions() {
        let mut settings = AppSettings::default();

        settings.indexing.excluded_extensions = vec![
            "exe".into(),
            "dll".into(),
            "zip".into(),
            "7z".into(),
            "MP4".into(),
            "mov".into(),
            "db".into(),
            "sqlite".into(),
            "sqlite3".into(),
            ".TMP".into(),
            "tmp".into(),
        ];

        let settings = normalize_settings(settings);

        assert!(!settings
            .indexing
            .excluded_extensions
            .contains(&"mp4".to_string()));
        assert!(!settings
            .indexing
            .excluded_extensions
            .contains(&"mov".to_string()));
        assert!(settings
            .indexing
            .excluded_extensions
            .contains(&"tmp".to_string()));
        assert_eq!(
            settings
                .indexing
                .excluded_extensions
                .iter()
                .filter(|extension| extension.as_str() == "tmp")
                .count(),
            1
        );
    }

    #[test]
    fn removes_invalid_target_groups() {
        let settings = AppSettings {
            target_groups: vec![
                TargetGroup {
                    id: "".into(),
                    name: "Invalid".into(),
                    paths: vec![],
                    active: true,
                },
                TargetGroup {
                    id: "work".into(),
                    name: "Work".into(),
                    paths: vec![],
                    active: true,
                },
            ],
            ..AppSettings::default()
        };

        let settings = normalize_settings(settings);

        assert_eq!(settings.target_groups.len(), 1);
    }

    #[test]
    fn fixes_invalid_current_target_group() {
        let settings = AppSettings {
            target_groups: vec![TargetGroup {
                id: "work".into(),
                name: "Work".into(),
                paths: vec![],
                active: true,
            }],
            current_target_group_id: Some("unknown".into()),
            ..AppSettings::default()
        };

        let settings = normalize_settings(settings);

        assert_eq!(settings.current_target_group_id, Some("work".into()));
    }

    #[test]
    fn keeps_current_target_group_active() {
        let settings = AppSettings {
            target_groups: vec![TargetGroup {
                id: "work".into(),
                name: "Work".into(),
                paths: vec![],
                active: false,
            }],
            current_target_group_id: Some("work".into()),
            ..AppSettings::default()
        };

        let settings = normalize_settings(settings);

        assert!(settings.target_groups[0].active);
    }

    #[test]
    fn removes_duplicate_trusted_directories() {
        let mut settings = AppSettings::default();

        settings.commands.trusted_directories =
            vec!["/usr/bin".into(), "/usr/bin".into(), "".into()];

        let settings = normalize_settings(settings);

        assert_eq!(settings.commands.trusted_directories, vec!["/usr/bin"]);
    }

    #[test]
    fn fixes_invalid_ui_language() {
        let mut settings = AppSettings::default();

        settings.ui.language = "unknown".into();

        let settings = normalize_settings(settings);

        assert_eq!(settings.ui.language, "en");
    }

    #[test]
    fn removes_invalid_plugin_trust_records() {
        let mut settings = AppSettings::default();

        settings.plugins.insert(
            "sample-plugin".into(),
            crate::models::settings::PluginSettings {
                trust: Some(crate::models::settings::PluginTrustRecord {
                    trusted_at: Some("2026-07-26T00:00:00Z".into()),
                    manifest_fingerprint: Some("abc".into()),
                    version: Some("1.0.0".into()),
                }),
                ..Default::default()
            },
        );
        settings.plugins.insert(
            "../escape".into(),
            crate::models::settings::PluginSettings {
                trust: Some(crate::models::settings::PluginTrustRecord {
                    trusted_at: Some("2026-07-26T00:00:00Z".into()),
                    manifest_fingerprint: Some("abc".into()),
                    version: Some("1.0.0".into()),
                }),
                ..Default::default()
            },
        );
        settings.plugins.insert(
            "missing-fingerprint".into(),
            crate::models::settings::PluginSettings {
                trust: Some(crate::models::settings::PluginTrustRecord {
                    trusted_at: Some("2026-07-26T00:00:00Z".into()),
                    manifest_fingerprint: None,
                    version: Some("1.0.0".into()),
                }),
                ..Default::default()
            },
        );

        let settings = normalize_settings(settings);

        assert!(settings.plugins["sample-plugin"].trust.is_some());
        assert!(!settings.plugins.contains_key("../escape"));
        assert!(!settings.plugins.contains_key("missing-fingerprint"));
    }

    #[test]
    fn normalizes_plugin_search_result_copy_settings() {
        let mut settings = AppSettings::default();

        settings.plugins.insert(
            "date-calculator-plugin".into(),
            crate::models::settings::PluginSettings {
                copy_successful_search_results: std::collections::HashMap::from([
                    ("calculate".into(), true),
                    ("".into(), true),
                    ("../escape".into(), true),
                    ("disabled".into(), false),
                ]),
                ..Default::default()
            },
        );
        settings.plugins.insert(
            "../escape".into(),
            crate::models::settings::PluginSettings {
                copy_successful_search_results: std::collections::HashMap::from([(
                    "calculate".into(),
                    true,
                )]),
                ..Default::default()
            },
        );

        let settings = normalize_settings(settings);
        let action_settings =
            &settings.plugins["date-calculator-plugin"].copy_successful_search_results;

        assert_eq!(action_settings.len(), 1);
        assert_eq!(action_settings.get("calculate"), Some(&true));
        assert!(!settings.plugins.contains_key("../escape"));
    }

    #[test]
    fn does_not_migrate_legacy_plugin_settings_shape() {
        let settings_dir = unique_test_dir("legacy_plugins");
        let settings_path = settings_dir.join("settings.json");

        fs::create_dir_all(&settings_dir).unwrap();
        fs::write(
            &settings_path,
            r#"{
  "theme": "nord",
  "plugins": {
    "trustedPlugins": {
      "sample-plugin": {
        "trusted": true,
        "trustedAt": "2026-07-26T00:00:00Z",
        "manifestFingerprint": "abc",
        "version": "1.0.0"
      }
    },
    "copySuccessfulPlaygroundResults": {
      "sample-plugin": {
        "calculate": true
      }
    }
  }
}"#,
        )
        .unwrap();

        let settings = load_settings(&settings_path);

        assert!(settings.plugins.is_empty());

        fs::remove_dir_all(settings_dir).ok();
    }

    #[test]
    fn merges_keybindings_with_defaults() {
        let mut settings = AppSettings::default();

        settings.keybindings.clear();
        settings.keybindings.insert(
            "focusSearch".into(),
            KeybindingValue::Many(vec!["Ctrl+Space".into()]),
        );

        let settings = normalize_settings(settings);

        assert!(settings.keybindings.contains_key("openActiveItem"));

        match settings.keybindings.get("focusSearch").unwrap() {
            KeybindingValue::Many(keys) => {
                assert_eq!(keys, &vec!["Ctrl+Space".to_string()]);
            }
            _ => panic!("expected many keybindings"),
        }
    }

    #[test]
    fn empty_keybinding_list_disables_default_keybinding() {
        let mut settings = AppSettings::default();

        settings
            .keybindings
            .insert("switchTargetGroup".into(), KeybindingValue::Many(vec![]));

        let settings = normalize_settings(settings);

        match settings.keybindings.get("switchTargetGroup").unwrap() {
            KeybindingValue::Many(keys) => {
                assert!(keys.is_empty());
            }
            _ => panic!("expected disabled keybinding list"),
        }
    }

    #[test]
    fn removes_legacy_home_end_search_navigation_keybindings() {
        let mut settings = AppSettings::default();

        settings.keybindings.insert(
            "selectFirstItem".into(),
            KeybindingValue::One("Home".into()),
        );
        settings
            .keybindings
            .insert("selectLastItem".into(), KeybindingValue::One("End".into()));

        let settings = normalize_settings(settings);

        assert!(!settings.keybindings.contains_key("selectFirstItem"));
        assert!(!settings.keybindings.contains_key("selectLastItem"));
    }

    #[test]
    fn disables_legacy_copy_preview_content_ctrl_c_keybinding() {
        let mut settings = AppSettings::default();

        settings.keybindings.insert(
            "copyActivePreviewContent".into(),
            KeybindingValue::One("Ctrl+C".into()),
        );

        let settings = normalize_settings(settings);

        match settings
            .keybindings
            .get("copyActivePreviewContent")
            .unwrap()
        {
            KeybindingValue::Many(keys) => {
                assert!(keys.is_empty());
            }
            _ => panic!("expected disabled keybinding list"),
        }
    }

    #[test]
    fn preserves_custom_copy_preview_content_keybinding() {
        let mut settings = AppSettings::default();

        settings.keybindings.insert(
            "copyActivePreviewContent".into(),
            KeybindingValue::One("Ctrl+Shift+C".into()),
        );

        let settings = normalize_settings(settings);

        match settings
            .keybindings
            .get("copyActivePreviewContent")
            .unwrap()
        {
            KeybindingValue::One(key) => {
                assert_eq!(key, "Ctrl+Shift+C");
            }
            _ => panic!("expected custom keybinding"),
        }
    }
}
