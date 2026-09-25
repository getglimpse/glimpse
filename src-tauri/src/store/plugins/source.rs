//! Read files belonging to installed plugins.

use std::fs;
use std::path::{Path, PathBuf};

use crate::models::plugins::{PluginAssetSource, PluginEntrypointSource, PluginReadmeSource};

use super::{load_plugin_manifest, resolve_plugin_manifest_path, PLUGIN_README_MAX_BYTES};

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

pub(super) fn plugin_root_for_manifest(manifest_path: &Path) -> Result<&Path, String> {
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

pub(super) fn resolve_plugin_child_file(
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
