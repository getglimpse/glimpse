//! Plugin installation, replacement, and removal.

use std::fs;
use std::path::{Path, PathBuf};

use url::Url;
use uuid::Uuid;

use crate::models::plugins::{PluginInstallResult, PluginUninstallResult};

use super::archive::{
    extract_plugin_archive, read_archive_manifest_plugin_id, validate_archive_plugin_package,
};
use super::remote::{
    download_plugin_archive, validate_plugin_archive_download_url, validate_plugin_registry_url,
    validate_sha256_digest,
};
use super::trust::{
    clear_plugin_install_security_record, remove_plugin_settings_record,
    set_remote_plugin_provenance,
};
use super::{
    ensure_plugins_dir, is_plain_plugin_id, load_plugin_manifest, PLUGIN_ARCHIVE_EXTENSION,
    PLUGIN_ARCHIVE_MAX_BYTES,
};

pub fn install_plugin_from_path(
    app_data_dir: &Path,
    settings_path: &Path,
    source_path: &str,
    replace: bool,
) -> Result<PluginInstallResult, String> {
    let source_path = source_path.trim();

    if source_path.is_empty() {
        return Err("plugin source path is required".to_string());
    }

    let source_root = PathBuf::from(source_path);

    if !source_root.is_dir() {
        return Err(format!(
            "plugin source path is not a directory: {}",
            source_root.display()
        ));
    }

    let source_manifest_path = source_root.join("manifest.json");

    if !source_manifest_path.is_file() {
        return Err(format!(
            "plugin manifest not found in source directory: {}",
            source_manifest_path.display()
        ));
    }

    let source_manifest = load_plugin_manifest(&source_manifest_path)?;
    let plugins_dir = ensure_plugins_dir(app_data_dir)?;
    let destination_root = plugins_dir.join(&source_manifest.id);
    let canonical_plugins_dir = plugins_dir.canonicalize().map_err(|error| {
        format!(
            "failed to resolve plugins directory: {}: {error}",
            plugins_dir.display()
        )
    })?;
    let canonical_source = source_root.canonicalize().map_err(|error| {
        format!(
            "failed to resolve plugin source directory: {}: {error}",
            source_root.display()
        )
    })?;
    let replaced = destination_root.exists();
    let canonical_destination = if replaced {
        Some(destination_root.canonicalize().map_err(|error| {
            format!(
                "failed to resolve existing plugin directory: {}: {error}",
                destination_root.display()
            )
        })?)
    } else {
        None
    };

    if let Some(canonical_destination) = canonical_destination.as_deref() {
        if canonical_source == canonical_destination {
            return Err("plugin source is already installed".to_string());
        }

        if canonical_source.starts_with(canonical_destination) {
            return Err("plugin source is inside the installed plugin directory".to_string());
        }

        if !canonical_destination.starts_with(&canonical_plugins_dir) {
            return Err(format!(
                "installed plugin directory escapes plugins root: {}",
                destination_root.display()
            ));
        }

        if !replace {
            return Err(format!(
                "plugin is already installed: {}; pass replace=true to overwrite",
                source_manifest.id
            ));
        }
    }

    let staging_parent = plugins_dir.join(format!(".install_{}", Uuid::new_v4().simple()));
    let staging_root = staging_parent.join(&source_manifest.id);

    copy_dir_all(&canonical_source, &staging_root).map_err(|error| {
        let _ = fs::remove_dir_all(&staging_parent);
        format!(
            "failed to stage plugin install: {} -> {}: {error}",
            canonical_source.display(),
            staging_root.display()
        )
    })?;

    let staged_manifest_path = staging_root.join("manifest.json");
    let manifest = match load_plugin_manifest(&staged_manifest_path) {
        Ok(manifest) => manifest,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging_parent);
            return Err(error);
        }
    };

    if manifest.id != source_manifest.id {
        let _ = fs::remove_dir_all(&staging_parent);
        return Err(format!(
            "staged plugin manifest id changed during install: expected {}, got {}",
            source_manifest.id, manifest.id
        ));
    }

    if let Err(error) = promote_staged_plugin_install(&staging_root, &destination_root, replaced) {
        let _ = fs::remove_dir_all(&staging_parent);
        return Err(error);
    }

    let cleanup_result = fs::remove_dir_all(&staging_parent);

    clear_plugin_install_security_record(settings_path, &manifest.id)?;

    cleanup_result.map_err(|error| {
        format!(
            "failed to clean plugin install staging directory: {}: {error}",
            staging_parent.display()
        )
    })?;

    Ok(PluginInstallResult {
        plugin_id: manifest.id.clone(),
        installed_path: destination_root.display().to_string(),
        replaced,
        manifest,
    })
}

pub fn install_plugin_from_archive(
    app_data_dir: &Path,
    settings_path: &Path,
    archive_path: &str,
    replace: bool,
) -> Result<PluginInstallResult, String> {
    let archive_path = archive_path.trim();

    if archive_path.is_empty() {
        return Err("plugin archive path is required".to_string());
    }

    if !archive_path.ends_with(PLUGIN_ARCHIVE_EXTENSION) {
        return Err(format!(
            "plugin archive must end with {PLUGIN_ARCHIVE_EXTENSION}: {archive_path}"
        ));
    }

    let archive_path = PathBuf::from(archive_path);

    if !archive_path.is_file() {
        return Err(format!(
            "plugin archive path is not a file: {}",
            archive_path.display()
        ));
    }

    let archive_size = archive_path
        .metadata()
        .map_err(|error| {
            format!(
                "failed to read plugin archive metadata: {}: {error}",
                archive_path.display()
            )
        })?
        .len();

    if archive_size > PLUGIN_ARCHIVE_MAX_BYTES {
        return Err(format!(
            "plugin archive is too large: {archive_size} bytes; limit is {PLUGIN_ARCHIVE_MAX_BYTES} bytes"
        ));
    }

    let temp_root = std::env::temp_dir().join(format!(
        "glimpse_plugin_archive_{}",
        Uuid::new_v4().simple()
    ));

    fs::create_dir_all(&temp_root).map_err(|error| {
        format!(
            "failed to create plugin archive temp directory: {}: {error}",
            temp_root.display()
        )
    })?;

    let result = install_plugin_from_archive_inner(
        app_data_dir,
        settings_path,
        &archive_path,
        &temp_root,
        replace,
    );
    let cleanup_result = fs::remove_dir_all(&temp_root);

    match (result, cleanup_result) {
        (Ok(result), Ok(())) => Ok(result),
        (Ok(_), Err(error)) => Err(format!(
            "failed to clean plugin archive temp directory: {}: {error}",
            temp_root.display()
        )),
        (Err(error), _) => Err(error),
    }
}

pub async fn install_plugin_from_url(
    app_data_dir: &Path,
    settings_path: &Path,
    download_url: &str,
    expected_sha256: &str,
    registry_url: Option<&str>,
    replace: bool,
) -> Result<PluginInstallResult, String> {
    let download_url = validate_plugin_archive_download_url(download_url)?;
    let expected_sha256 = validate_sha256_digest(expected_sha256)?;
    let registry_url = registry_url
        .ok_or_else(|| "plugin registry URL is required".to_string())
        .and_then(validate_plugin_registry_url)?;
    let temp_root = std::env::temp_dir().join(format!(
        "glimpse_plugin_download_{}",
        Uuid::new_v4().simple()
    ));

    fs::create_dir_all(&temp_root).map_err(|error| {
        format!(
            "failed to create plugin download temp directory: {}: {error}",
            temp_root.display()
        )
    })?;

    let result = install_plugin_from_url_inner(
        app_data_dir,
        settings_path,
        &download_url,
        &expected_sha256,
        registry_url.as_str(),
        &temp_root,
        replace,
    )
    .await;
    let cleanup_result = fs::remove_dir_all(&temp_root);

    match (result, cleanup_result) {
        (Ok(result), Ok(())) => Ok(result),
        (Ok(_), Err(error)) => Err(format!(
            "failed to clean plugin download temp directory: {}: {error}",
            temp_root.display()
        )),
        (Err(error), _) => Err(error),
    }
}

async fn install_plugin_from_url_inner(
    app_data_dir: &Path,
    settings_path: &Path,
    download_url: &Url,
    expected_sha256: &str,
    registry_url: &str,
    temp_root: &Path,
    replace: bool,
) -> Result<PluginInstallResult, String> {
    let archive_path = temp_root.join("download.glimpse-plugin.zip");

    let actual_sha256 =
        download_plugin_archive(download_url, expected_sha256, &archive_path).await?;
    let result = install_plugin_from_archive(
        app_data_dir,
        settings_path,
        &archive_path.display().to_string(),
        replace,
    )?;

    set_remote_plugin_provenance(
        settings_path,
        &result.plugin_id,
        registry_url,
        download_url.as_str(),
        expected_sha256,
        &actual_sha256,
    )?;

    Ok(result)
}

fn install_plugin_from_archive_inner(
    app_data_dir: &Path,
    settings_path: &Path,
    archive_path: &Path,
    temp_root: &Path,
    replace: bool,
) -> Result<PluginInstallResult, String> {
    let unpacked_root = temp_root.join("unpacked");
    let archive_plugin_root = extract_plugin_archive(archive_path, &unpacked_root)?;
    let plugin_id = read_archive_manifest_plugin_id(&archive_plugin_root)?;
    let normalized_parent = temp_root.join("normalized");
    let normalized_plugin_root = normalized_parent.join(plugin_id);

    copy_dir_all(&archive_plugin_root, &normalized_plugin_root).map_err(|error| {
        format!(
            "failed to normalize plugin archive root: {} -> {}: {error}",
            archive_plugin_root.display(),
            normalized_plugin_root.display()
        )
    })?;

    validate_archive_plugin_package(&normalized_plugin_root)?;

    install_plugin_from_path(
        app_data_dir,
        settings_path,
        &normalized_plugin_root.display().to_string(),
        replace,
    )
}

pub fn uninstall_plugin(
    app_data_dir: &Path,
    settings_path: &Path,
    plugin_id: &str,
) -> Result<PluginUninstallResult, String> {
    if !is_plain_plugin_id(plugin_id) {
        return Err(format!("invalid plugin id: {plugin_id}"));
    }

    let plugins_dir = ensure_plugins_dir(app_data_dir)?;
    let plugin_root = plugins_dir.join(plugin_id);

    if !plugin_root.is_dir() {
        return Err(format!(
            "installed plugin directory not found: {}",
            plugin_root.display()
        ));
    }

    let canonical_plugins_dir = plugins_dir.canonicalize().map_err(|error| {
        format!(
            "failed to resolve plugins directory: {}: {error}",
            plugins_dir.display()
        )
    })?;
    let canonical_plugin_root = plugin_root.canonicalize().map_err(|error| {
        format!(
            "failed to resolve installed plugin directory: {}: {error}",
            plugin_root.display()
        )
    })?;

    if !canonical_plugin_root.starts_with(&canonical_plugins_dir) {
        return Err(format!(
            "installed plugin directory escapes plugins root: {}",
            plugin_root.display()
        ));
    }

    fs::remove_dir_all(&canonical_plugin_root).map_err(|error| {
        format!(
            "failed to remove installed plugin directory: {}: {error}",
            canonical_plugin_root.display()
        )
    })?;
    remove_plugin_settings_record(settings_path, plugin_id)?;

    Ok(PluginUninstallResult {
        plugin_id: plugin_id.to_string(),
        removed_path: canonical_plugin_root.display().to_string(),
        removed: true,
    })
}

pub(super) fn copy_dir_all(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::create_dir_all(destination)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_all(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

fn promote_staged_plugin_install(
    staging_root: &Path,
    destination_root: &Path,
    replaced: bool,
) -> Result<(), String> {
    if !replaced {
        fs::rename(staging_root, destination_root).map_err(|error| {
            format!(
                "failed to promote staged plugin install: {} -> {}: {error}",
                staging_root.display(),
                destination_root.display()
            )
        })?;

        return Ok(());
    }

    let destination_parent = destination_root.parent().ok_or_else(|| {
        format!(
            "installed plugin destination has no parent directory: {}",
            destination_root.display()
        )
    })?;
    let plugin_dir_name = destination_root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            format!(
                "installed plugin destination has invalid directory name: {}",
                destination_root.display()
            )
        })?;
    let backup_root = destination_parent.join(format!(
        ".replace_{}_{}",
        plugin_dir_name,
        Uuid::new_v4().simple()
    ));

    fs::rename(destination_root, &backup_root).map_err(|error| {
        format!(
            "failed to backup installed plugin before replacement: {} -> {}: {error}",
            destination_root.display(),
            backup_root.display()
        )
    })?;

    if let Err(promote_error) = fs::rename(staging_root, destination_root) {
        let restore_result = fs::rename(&backup_root, destination_root);

        return match restore_result {
            Ok(()) => Err(format!(
                "failed to replace installed plugin; existing plugin was restored: {}: {promote_error}",
                destination_root.display()
            )),
            Err(restore_error) => Err(format!(
                "failed to replace installed plugin: {}; also failed to restore backup {}: {restore_error}",
                promote_error,
                backup_root.display()
            )),
        };
    }

    let _ = fs::remove_dir_all(&backup_root);

    Ok(())
}
