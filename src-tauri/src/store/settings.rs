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
//! Invalid or unreadable settings fall back to [`AppSettings::default`].

use std::collections::HashSet;
use std::fs;
use std::path::Path;
use tracing::{debug, info, warn};

use crate::models::settings::{
    AppSettings, CommandPolicyMode, IndexingSettings, KeybindingValue, TargetGroup,
};

/// Loads application settings from disk.
///
/// If the file exists and can be parsed, the parsed settings are normalized
/// before being returned.
///
/// If the file cannot be read or parsed, default settings are returned.
/// When the file is missing, this function also attempts to create it.
///
/// # Behavior
///
/// - Valid file → parse and normalize.
/// - Invalid JSON → return normalized defaults.
/// - Missing file → save defaults and return defaults.
///
/// # Notes
///
/// This function is intentionally forgiving because `settings.json` is
/// user-editable.
pub fn load_settings(path: &Path) -> AppSettings {
    debug!(
        settings_path = %path.display(),
        "loading settings"
    );

    if let Ok(content) = fs::read_to_string(path) {
        let settings = match serde_json::from_str::<AppSettings>(&content) {
            Ok(settings) => {
                debug!(
                    settings_path = %path.display(),
                    "settings parsed"
                );
                settings
            }
            Err(error) => {
                warn!(
                    settings_path = %path.display(),
                    error = %error,
                    "failed to parse settings; using defaults"
                );
                AppSettings::default()
            }
        };

        return normalize_settings(settings);
    }

    warn!(
        settings_path = %path.display(),
        "settings file missing or unreadable; using defaults"
    );

    let settings = AppSettings::default();

    if let Err(error) = save_settings(path, &settings) {
        warn!(
            settings_path = %path.display(),
            error = %error,
            "failed to create default settings file"
        );
    } else {
        info!(
            settings_path = %path.display(),
            "default settings file created"
        );
    }

    normalize_settings(settings)
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

/// Saves application settings as pretty-printed JSON.
///
/// Parent directories are created automatically.
///
/// # Errors
///
/// Returns an error when:
///
/// - the parent directory cannot be created
/// - serialization fails
/// - the file cannot be written
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

    fs::write(path, content).map_err(|error| {
        warn!(
            settings_path = %path.display(),
            error = %error,
            "failed to write settings file"
        );
        error.to_string()
    })?;

    debug!(
        settings_path = %path.display(),
        "settings saved"
    );

    Ok(())
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
    settings
        .plugins
        .trusted_plugins
        .retain(|plugin_id, record| {
            let keep = is_valid_plugin_id(plugin_id)
                && record.trusted
                && record
                    .manifest_fingerprint
                    .as_ref()
                    .is_some_and(|fingerprint| !fingerprint.trim().is_empty());

            if !keep {
                warn!(
                    plugin_id = %plugin_id,
                    "removed invalid plugin trust record"
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
        let mut settings = AppSettings::default();

        settings.target_groups = vec![
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
        ];

        let settings = normalize_settings(settings);

        assert_eq!(settings.target_groups.len(), 1);
    }

    #[test]
    fn fixes_invalid_current_target_group() {
        let mut settings = AppSettings::default();

        settings.target_groups = vec![TargetGroup {
            id: "work".into(),
            name: "Work".into(),
            paths: vec![],
            active: true,
        }];

        settings.current_target_group_id = Some("unknown".into());

        let settings = normalize_settings(settings);

        assert_eq!(settings.current_target_group_id, Some("work".into()));
    }

    #[test]
    fn keeps_current_target_group_active() {
        let mut settings = AppSettings::default();

        settings.target_groups = vec![TargetGroup {
            id: "work".into(),
            name: "Work".into(),
            paths: vec![],
            active: false,
        }];

        settings.current_target_group_id = Some("work".into());

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

        settings.plugins.trusted_plugins.insert(
            "sample-plugin".into(),
            crate::models::settings::PluginTrustRecord {
                trusted: true,
                trusted_at: Some("2026-07-26T00:00:00Z".into()),
                manifest_fingerprint: Some("abc".into()),
                version: Some("1.0.0".into()),
            },
        );
        settings.plugins.trusted_plugins.insert(
            "../escape".into(),
            crate::models::settings::PluginTrustRecord {
                trusted: true,
                trusted_at: Some("2026-07-26T00:00:00Z".into()),
                manifest_fingerprint: Some("abc".into()),
                version: Some("1.0.0".into()),
            },
        );
        settings.plugins.trusted_plugins.insert(
            "missing-fingerprint".into(),
            crate::models::settings::PluginTrustRecord {
                trusted: true,
                trusted_at: Some("2026-07-26T00:00:00Z".into()),
                manifest_fingerprint: None,
                version: Some("1.0.0".into()),
            },
        );

        let settings = normalize_settings(settings);

        assert!(settings
            .plugins
            .trusted_plugins
            .contains_key("sample-plugin"));
        assert!(!settings.plugins.trusted_plugins.contains_key("../escape"));
        assert!(!settings
            .plugins
            .trusted_plugins
            .contains_key("missing-fingerprint"));
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
}
