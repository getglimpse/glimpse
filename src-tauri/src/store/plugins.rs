//! Plugin discovery, installation, trust, and source access.
//!
//! Production plugins are discovered from the application config directory:
//!
//! ```text
//! <app_data_dir>/plugins/<plugin-id>/manifest.json
//! ```
//!
//! Archive validation and manifest parsing live in separate submodules.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::models::plugins::{
    PluginAssetSource, PluginDiscoveryError, PluginDiscoveryReport, PluginEntrypointSource,
    PluginInstallResult, PluginManifest, PluginReadmeSource, PluginTrustStatus,
    PluginUninstallResult,
};
use crate::models::settings::{PluginInstallProvenance, PluginInstallSource, PluginTrustRecord};
use crate::store::settings::{load_settings, save_settings};

mod archive;
mod manifest;
mod remote;
mod validation;

use archive::{
    extract_plugin_archive, path_to_archive_string, read_archive_manifest_plugin_id,
    validate_archive_plugin_package,
};
#[cfg(test)]
use manifest::validate_page_definition;
#[cfg(test)]
use remote::verify_sha256_digest;
use remote::{
    download_plugin_archive, validate_plugin_archive_download_url, validate_plugin_registry_url,
    validate_sha256_digest,
};

const SUPPORTED_PLUGIN_API_VERSION: &str = "0.2.0";
const DEFAULT_PLUGIN_API_VERSION: &str = SUPPORTED_PLUGIN_API_VERSION;
const PLUGIN_ARCHIVE_EXTENSION: &str = ".glimpse-plugin.zip";
const PLUGIN_ARCHIVE_MAX_BYTES: u64 = 20 * 1024 * 1024;
const PLUGIN_ARCHIVE_MAX_UNCOMPRESSED_BYTES: u64 = 64 * 1024 * 1024;
const PLUGIN_ARCHIVE_MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const PLUGIN_ARCHIVE_MAX_ENTRIES: usize = 256;
const PLUGIN_ARCHIVE_MAX_PATH_CHARS: usize = 240;
const PLUGIN_ARCHIVE_MAX_DEPTH: usize = 8;
const PLUGIN_ARCHIVE_MAX_COMPRESSION_RATIO: u64 = 100;
const PLUGIN_README_MAX_BYTES: u64 = 100 * 1024;
const OFFICIAL_PLUGIN_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/getglimpse/plugins/main/registry.json";

pub fn ensure_plugins_dir(app_data_dir: &Path) -> Result<PathBuf, String> {
    let plugins_dir = app_data_dir.join("plugins");

    if plugins_dir.exists() && !plugins_dir.is_dir() {
        return Err(format!(
            "plugins path exists but is not a directory: {}",
            plugins_dir.display()
        ));
    }

    fs::create_dir_all(&plugins_dir).map_err(|error| {
        format!(
            "failed to create plugins directory: {}: {error}",
            plugins_dir.display()
        )
    })?;

    Ok(plugins_dir)
}

pub fn load_plugin_manifests(app_data_dir: &Path) -> Result<Vec<PluginManifest>, String> {
    Ok(load_plugin_discovery_report(app_data_dir)?.manifests)
}

pub fn load_plugin_discovery_report(app_data_dir: &Path) -> Result<PluginDiscoveryReport, String> {
    let plugins_dir = ensure_plugins_dir(app_data_dir)?;
    let mut manifest_paths = Vec::new();

    for entry in fs::read_dir(&plugins_dir).map_err(|error| {
        format!(
            "failed to read plugins directory: {}: {error}",
            plugins_dir.display()
        )
    })? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if path.is_dir() && !is_hidden_plugin_work_dir(&path) {
            let manifest_path = path.join("manifest.json");

            if manifest_path.is_file() {
                manifest_paths.push(manifest_path);
            }
        }
    }

    manifest_paths.sort();

    let mut manifests = Vec::new();
    let mut errors = Vec::new();

    for path in manifest_paths {
        match load_plugin_manifest(&path) {
            Ok(manifest) => manifests.push(manifest),
            Err(error) => errors.push(PluginDiscoveryError {
                path: path.display().to_string(),
                error,
            }),
        }
    }

    Ok(PluginDiscoveryReport { manifests, errors })
}

fn is_hidden_plugin_work_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

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

fn clear_plugin_install_security_record(
    settings_path: &Path,
    plugin_id: &str,
) -> Result<(), String> {
    let mut settings = load_settings(settings_path);
    clear_plugin_trust_and_provenance(&mut settings.plugins, plugin_id);
    save_settings(settings_path, &settings)
}

fn set_remote_plugin_provenance(
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

fn remove_plugin_settings_record(settings_path: &Path, plugin_id: &str) -> Result<(), String> {
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

pub fn read_plugin_entrypoint_source(
    app_data_dir: &Path,
    plugin_id: &str,
    entrypoint: &str,
) -> Result<PluginEntrypointSource, String> {
    let manifest_path = resolve_plugin_manifest_path(app_data_dir, plugin_id)?;
    let plugin_root = plugin_root_for_manifest(&manifest_path)?;
    let manifest = load_plugin_manifest(&manifest_path)?;
    let relative_entry = match entrypoint {
        "main" => manifest
            .entrypoints
            .as_ref()
            .and_then(|entrypoints| entrypoints.main.as_deref())
            .unwrap_or("./main.js"),
        "page" => manifest
            .entrypoints
            .as_ref()
            .and_then(|entrypoints| entrypoints.page.as_deref())
            .unwrap_or("./page.js"),
        _ => return Err(format!("unsupported plugin entrypoint: {entrypoint}")),
    };
    let (path, source) =
        read_plugin_child_source(plugin_root, relative_entry, "plugin entrypoint", None)?;

    Ok(PluginEntrypointSource {
        plugin_id: manifest.id,
        entrypoint: entrypoint.to_string(),
        path,
        source,
    })
}

pub fn read_plugin_asset_source(
    app_data_dir: &Path,
    plugin_id: &str,
    asset: &str,
) -> Result<PluginAssetSource, String> {
    let manifest_path = resolve_plugin_manifest_path(app_data_dir, plugin_id)?;
    let plugin_root = plugin_root_for_manifest(&manifest_path)?;
    let relative_path = match asset {
        "styles" => "styles.css",
        _ => return Err(format!("unsupported plugin asset: {asset}")),
    };
    let (path, source) =
        read_plugin_child_source(plugin_root, relative_path, "plugin asset", None)?;
    let manifest = load_plugin_manifest(&manifest_path)?;

    Ok(PluginAssetSource {
        plugin_id: manifest.id,
        asset: asset.to_string(),
        path,
        source,
    })
}

pub fn read_plugin_readme_source(
    app_data_dir: &Path,
    plugin_id: &str,
) -> Result<PluginReadmeSource, String> {
    let manifest_path = resolve_plugin_manifest_path(app_data_dir, plugin_id)?;
    let plugin_root = plugin_root_for_manifest(&manifest_path)?;
    let (path, source) = read_plugin_child_source(
        plugin_root,
        "README.md",
        "plugin README",
        Some(PLUGIN_README_MAX_BYTES),
    )?;
    let manifest = load_plugin_manifest(&manifest_path)?;

    Ok(PluginReadmeSource {
        plugin_id: manifest.id,
        path,
        source,
    })
}

fn plugin_root_for_manifest(manifest_path: &Path) -> Result<&Path, String> {
    manifest_path.parent().ok_or_else(|| {
        format!(
            "plugin manifest has no parent directory: {}",
            manifest_path.display()
        )
    })
}

fn read_plugin_child_source(
    plugin_root: &Path,
    relative_path: &str,
    label: &str,
    max_bytes: Option<u64>,
) -> Result<(String, String), String> {
    let child_path = plugin_root.join(relative_path);
    let canonical_child = resolve_plugin_child_file(plugin_root, &child_path, label)?;

    if let Some(max_bytes) = max_bytes {
        let metadata = canonical_child.metadata().map_err(|error| {
            format!(
                "failed to inspect {label}: {}: {error}",
                canonical_child.display()
            )
        })?;

        if metadata.len() > max_bytes {
            return Err(format!("{label} is too large: {} bytes", metadata.len()));
        }
    }

    let source = fs::read_to_string(&canonical_child).map_err(|error| {
        format!(
            "failed to read {label}: {}: {error}",
            canonical_child.display()
        )
    })?;

    Ok((canonical_child.display().to_string(), source))
}

fn resolve_plugin_manifest_path(app_data_dir: &Path, plugin_id: &str) -> Result<PathBuf, String> {
    if !is_plain_plugin_id(plugin_id) {
        return Err(format!("invalid plugin id: {plugin_id}"));
    }

    let manifest_path = ensure_plugins_dir(app_data_dir)?
        .join(plugin_id)
        .join("manifest.json");

    if !manifest_path.is_file() {
        return Err(format!(
            "plugin manifest not found: {}",
            manifest_path.display()
        ));
    }

    let manifest = load_plugin_manifest(&manifest_path)?;

    if manifest.id != plugin_id {
        return Err(format!(
            "plugin id mismatch: requested {plugin_id}, manifest contains {}",
            manifest.id
        ));
    }

    Ok(manifest_path)
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

fn is_plain_plugin_id(plugin_id: &str) -> bool {
    !plugin_id.is_empty()
        && !plugin_id.contains('/')
        && !plugin_id.contains('\\')
        && plugin_id != "."
        && plugin_id != ".."
}

fn resolve_plugin_child_file(
    plugin_root: &Path,
    child_path: &Path,
    label: &str,
) -> Result<PathBuf, String> {
    if !child_path.is_file() {
        return Err(format!("{label} not found: {}", child_path.display()));
    }

    let canonical_root = plugin_root.canonicalize().map_err(|error| {
        format!(
            "failed to resolve plugin root: {}: {error}",
            plugin_root.display()
        )
    })?;
    let canonical_child = child_path.canonicalize().map_err(|error| {
        format!(
            "failed to resolve {label}: {}: {error}",
            child_path.display()
        )
    })?;

    if !canonical_child.starts_with(&canonical_root) {
        return Err(format!(
            "{label} escapes plugin root: {}",
            child_path.display()
        ));
    }

    Ok(canonical_child)
}

fn copy_dir_all(source: &Path, destination: &Path) -> std::io::Result<()> {
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

pub use manifest::load_plugin_manifest;

#[cfg(test)]
#[path = "plugins/tests.rs"]
mod tests;
