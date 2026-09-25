//! Plugin discovery and shared plugin storage paths.
//!
//! Production plugins are discovered from the application config directory:
//!
//! ```text
//! <app_data_dir>/plugins/<plugin-id>/manifest.json
//! ```
//!
//! Installation, trust, source access, archive validation, and manifest parsing
//! live in focused submodules.

use std::fs;
use std::path::{Path, PathBuf};

use crate::models::plugins::{PluginDiscoveryError, PluginDiscoveryReport, PluginManifest};

mod archive;
mod install;
mod manifest;
mod remote;
mod source;
mod trust;
mod validation;

#[cfg(test)]
use crate::store::settings::{load_settings, save_settings};
#[cfg(test)]
use install::copy_dir_all;
#[cfg(test)]
use manifest::validate_page_definition;
#[cfg(test)]
use remote::{validate_plugin_archive_download_url, validate_sha256_digest, verify_sha256_digest};
#[cfg(test)]
use trust::set_remote_plugin_provenance;

pub use install::{
    install_plugin_from_archive, install_plugin_from_path, install_plugin_from_url,
    uninstall_plugin,
};
pub use source::{
    read_plugin_asset_source, read_plugin_entrypoint_source, read_plugin_readme_source,
};
pub use trust::{ensure_plugin_trusted, get_plugin_trust_status, set_plugin_trust};

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

fn is_plain_plugin_id(plugin_id: &str) -> bool {
    !plugin_id.is_empty()
        && !plugin_id.contains('/')
        && !plugin_id.contains('\\')
        && plugin_id != "."
        && plugin_id != ".."
}

pub use manifest::load_plugin_manifest;

#[cfg(test)]
#[path = "plugins/tests.rs"]
mod tests;
