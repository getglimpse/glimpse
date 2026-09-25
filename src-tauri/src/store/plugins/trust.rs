//! Plugin trust records, provenance, and content fingerprints.

use std::fs;
use std::path::Path;

use chrono::Utc;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::models::plugins::{PluginManifest, PluginTrustStatus};
use crate::models::settings::{PluginInstallProvenance, PluginInstallSource, PluginTrustRecord};
use crate::store::settings::{load_settings, save_settings};

use super::archive::path_to_archive_string;
use super::source::{plugin_root_for_manifest, resolve_plugin_child_file};
use super::{load_plugin_manifest, resolve_plugin_manifest_path};

pub fn get_plugin_trust_status(
    app_data_dir: &Path,
    settings_path: &Path,
    plugin_id: &str,
) -> Result<PluginTrustStatus, String> {
    let manifest_path = resolve_plugin_manifest_path(app_data_dir, plugin_id)?;
    let manifest = load_plugin_manifest(&manifest_path)?;
    let fingerprint = plugin_manifest_fingerprint(&manifest_path, &manifest)?;
    let settings = load_settings(settings_path);

    Ok(build_plugin_trust_status(&manifest, &settings, fingerprint))
}

pub fn set_plugin_trust(
    app_data_dir: &Path,
    settings_path: &Path,
    plugin_id: &str,
    trusted: bool,
) -> Result<PluginTrustStatus, String> {
    let manifest_path = resolve_plugin_manifest_path(app_data_dir, plugin_id)?;
    let manifest = load_plugin_manifest(&manifest_path)?;
    let fingerprint = plugin_manifest_fingerprint(&manifest_path, &manifest)?;
    let mut settings = load_settings(settings_path);

    if trusted {
        let plugin_settings = settings.plugins.entry(manifest.id.clone()).or_default();

        plugin_settings.trust = Some(PluginTrustRecord {
            trusted_at: Some(Utc::now().to_rfc3339()),
            manifest_fingerprint: Some(fingerprint.clone()),
            version: Some(manifest.version.clone()),
        });
    } else {
        remove_plugin_trust(&mut settings.plugins, &manifest.id);
    }

    save_settings(settings_path, &settings)?;

    Ok(build_plugin_trust_status(&manifest, &settings, fingerprint))
}

pub(super) fn clear_plugin_install_security_record(
    settings_path: &Path,
    plugin_id: &str,
) -> Result<(), String> {
    let mut settings = load_settings(settings_path);
    clear_plugin_trust_and_provenance(&mut settings.plugins, plugin_id);
    save_settings(settings_path, &settings)
}

pub(super) fn set_remote_plugin_provenance(
    settings_path: &Path,
    plugin_id: &str,
    registry_url: &str,
    download_url: &str,
    registry_sha256: &str,
    installed_package_sha256: &str,
) -> Result<(), String> {
    let mut settings = load_settings(settings_path);
    let plugin_settings = settings.plugins.entry(plugin_id.to_string()).or_default();

    plugin_settings.provenance = Some(PluginInstallProvenance {
        install_source: PluginInstallSource::Remote,
        registry_url: Some(registry_url.to_string()),
        download_url: Some(download_url.to_string()),
        registry_sha256: Some(registry_sha256.to_string()),
        installed_package_sha256: Some(installed_package_sha256.to_string()),
        installed_at: Some(Utc::now().to_rfc3339()),
    });

    save_settings(settings_path, &settings)
}

pub(super) fn remove_plugin_settings_record(
    settings_path: &Path,
    plugin_id: &str,
) -> Result<(), String> {
    let mut settings = load_settings(settings_path);
    settings.plugins.remove(plugin_id);
    save_settings(settings_path, &settings)
}

fn remove_plugin_trust(settings: &mut crate::models::settings::PluginSettingsMap, plugin_id: &str) {
    if let Some(plugin_settings) = settings.get_mut(plugin_id) {
        plugin_settings.trust = None;

        if plugin_settings.copy_successful_search_results.is_empty()
            && plugin_settings.preferences.is_empty()
            && plugin_settings.provenance.is_none()
        {
            settings.remove(plugin_id);
        }
    }
}

fn clear_plugin_trust_and_provenance(
    settings: &mut crate::models::settings::PluginSettingsMap,
    plugin_id: &str,
) {
    if let Some(plugin_settings) = settings.get_mut(plugin_id) {
        plugin_settings.trust = None;
        plugin_settings.provenance = None;

        if plugin_settings.copy_successful_search_results.is_empty()
            && plugin_settings.preferences.is_empty()
        {
            settings.remove(plugin_id);
        }
    }
}

pub fn ensure_plugin_trusted(
    app_data_dir: &Path,
    settings_path: &Path,
    plugin_id: &str,
) -> Result<(), String> {
    let status = get_plugin_trust_status(app_data_dir, settings_path, plugin_id)?;

    if status.trusted {
        return Ok(());
    }

    Err(format!(
        "plugin is not trusted: {}; {}",
        status.plugin_id,
        status
            .reason
            .unwrap_or_else(|| "open Plugin Page and trust this plugin".to_string())
    ))
}

fn build_plugin_trust_status(
    manifest: &PluginManifest,
    settings: &crate::models::settings::AppSettings,
    fingerprint: String,
) -> PluginTrustStatus {
    let record = settings
        .plugins
        .get(&manifest.id)
        .and_then(|plugin_settings| plugin_settings.trust.as_ref());
    let provenance = settings
        .plugins
        .get(&manifest.id)
        .and_then(|plugin_settings| plugin_settings.provenance.clone());
    let trusted_fingerprint = record.and_then(|record| record.manifest_fingerprint.clone());
    let trusted_version = record.and_then(|record| record.version.clone());
    let trusted_at = record.and_then(|record| record.trusted_at.clone());
    let fingerprint_matches = trusted_fingerprint.as_deref() == Some(fingerprint.as_str());
    let version_matches = trusted_version.as_deref() == Some(manifest.version.as_str());
    let trusted = record.is_some() && fingerprint_matches && version_matches;
    let reason = if trusted {
        None
    } else if record.is_none() {
        Some("plugin has not been trusted yet".to_string())
    } else if !version_matches {
        Some("plugin version changed since it was trusted".to_string())
    } else if !fingerprint_matches {
        Some("plugin files changed since it was trusted".to_string())
    } else {
        Some("plugin must be trusted before it can run".to_string())
    };

    PluginTrustStatus {
        plugin_id: manifest.id.clone(),
        trusted,
        trust_required: true,
        reason,
        trusted_at,
        manifest_fingerprint: fingerprint,
        trusted_fingerprint,
        version: manifest.version.clone(),
        trusted_version,
        provenance,
    }
}

fn plugin_manifest_fingerprint(
    manifest_path: &Path,
    manifest: &PluginManifest,
) -> Result<String, String> {
    let plugin_root = plugin_root_for_manifest(manifest_path)?;
    let mut hasher = Sha256::new();

    hash_file_contents(&mut hasher, "manifest", manifest_path)?;

    let main_entry = manifest
        .entrypoints
        .as_ref()
        .and_then(|entrypoints| entrypoints.main.as_deref())
        .unwrap_or("./main.js");
    hash_optional_child_file_contents(&mut hasher, plugin_root, "main", main_entry)?;

    if let Some(page_entry) = manifest
        .entrypoints
        .as_ref()
        .and_then(|entrypoints| entrypoints.page.as_deref())
    {
        hash_optional_child_file_contents(&mut hasher, plugin_root, "page", page_entry)?;
    }

    if let Some(page_definition) = manifest.page.as_deref() {
        hash_optional_child_file_contents(
            &mut hasher,
            plugin_root,
            "pageDefinition",
            page_definition,
        )?;
    }

    if let Some(i18n_path) = manifest.i18n_path.as_deref() {
        hash_optional_child_file_contents(&mut hasher, plugin_root, "i18n", i18n_path)?;
    }

    hash_optional_child_file_contents(&mut hasher, plugin_root, "styles", "styles.css")?;
    hash_optional_assets_dir(&mut hasher, plugin_root)?;

    Ok(format!("{:x}", hasher.finalize()))
}

fn hash_optional_assets_dir(hasher: &mut Sha256, plugin_root: &Path) -> Result<(), String> {
    let assets_root = plugin_root.join("assets");

    write_hash_label(hasher, "assets");

    if !assets_root.exists() {
        write_hash_label(hasher, "missing");
        return Ok(());
    }

    if !assets_root.is_dir() {
        return Err(format!(
            "plugin assets path exists but is not a directory: {}",
            assets_root.display()
        ));
    }

    let canonical_plugin_root = plugin_root.canonicalize().map_err(|error| {
        format!(
            "failed to resolve plugin root for assets fingerprint: {}: {error}",
            plugin_root.display()
        )
    })?;
    let canonical_assets_root = assets_root.canonicalize().map_err(|error| {
        format!(
            "failed to resolve plugin assets directory: {}: {error}",
            assets_root.display()
        )
    })?;

    if !canonical_assets_root.starts_with(&canonical_plugin_root) {
        return Err(format!(
            "plugin assets directory escapes plugin root: {}",
            assets_root.display()
        ));
    }

    let mut asset_paths = Vec::new();

    for entry in WalkDir::new(&canonical_assets_root).follow_links(false) {
        let entry = entry.map_err(|error| {
            format!(
                "failed to inspect plugin assets directory: {}: {error}",
                canonical_assets_root.display()
            )
        })?;

        if entry.file_type().is_file() {
            asset_paths.push(entry.path().to_path_buf());
        } else if entry.file_type().is_symlink() {
            return Err(format!(
                "plugin assets symlink is not allowed: {}",
                entry.path().display()
            ));
        }
    }

    asset_paths.sort();

    for path in asset_paths {
        let relative_path = path.strip_prefix(&canonical_plugin_root).map_err(|_| {
            format!(
                "plugin asset escapes plugin root during fingerprint: {}",
                path.display()
            )
        })?;
        let relative_path = path_to_archive_string(relative_path);

        write_hash_label(hasher, &relative_path);
        hash_file_contents(hasher, "asset", &path)?;
    }

    Ok(())
}

fn hash_optional_child_file_contents(
    hasher: &mut Sha256,
    plugin_root: &Path,
    label: &str,
    relative_path: &str,
) -> Result<(), String> {
    let path = plugin_root.join(relative_path);

    write_hash_label(hasher, label);
    write_hash_label(hasher, relative_path);

    if !path.exists() {
        write_hash_label(hasher, "missing");
        return Ok(());
    }

    let canonical = resolve_plugin_child_file(plugin_root, &path, label)?;
    hash_file_contents(hasher, label, &canonical)
}

fn hash_file_contents(hasher: &mut Sha256, label: &str, path: &Path) -> Result<(), String> {
    write_hash_label(hasher, label);

    let bytes = fs::read(path).map_err(|error| {
        format!(
            "failed to read plugin file for fingerprint: {}: {error}",
            path.display()
        )
    })?;

    hasher.update(bytes.len().to_le_bytes());
    hasher.update(&bytes);

    Ok(())
}

fn write_hash_label(hasher: &mut Sha256, label: &str) {
    hasher.update(label.len().to_le_bytes());
    hasher.update(label.as_bytes());
}
