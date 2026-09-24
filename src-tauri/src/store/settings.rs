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
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::models::settings::{AppSettings, TargetGroup};

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

mod normalize;
pub(crate) use normalize::normalize_settings;

#[cfg(test)]
#[path = "settings/tests.rs"]
mod tests;
