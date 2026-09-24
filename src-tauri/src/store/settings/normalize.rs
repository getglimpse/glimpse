//! Normalize user-editable settings after loading.

use std::collections::{HashMap, HashSet};

use tracing::{debug, warn};

use crate::models::settings::{
    AppSettings, CommandPolicyMode, IndexingSettings, KeybindingValue, TargetGroup,
};

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
