//! Plugin manifest storage.
//!
//! Production plugins are discovered from the application config directory:
//!
//! ```text
//! <app_data_dir>/plugins/<plugin-id>/manifest.json
//! ```

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use sha2::{Digest, Sha256};

use crate::models::plugins::{
    PluginAssetSource, PluginContributions, PluginDiscoveryError, PluginDiscoveryReport,
    PluginEntrypointSource, PluginInstallResult, PluginInternalPageManifest, PluginManifest,
    PluginPageActionManifest, PluginTrustStatus, PluginUninstallResult, RawPluginManifest,
};
use crate::models::settings::PluginTrustRecord;
use crate::store::settings::{load_settings, save_settings};

const SUPPORTED_PLUGIN_API_VERSION: &str = "0.2.0";
const DEFAULT_PLUGIN_API_VERSION: &str = SUPPORTED_PLUGIN_API_VERSION;

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

        if path.is_dir() {
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

    if replaced {
        let canonical_destination = destination_root.canonicalize().map_err(|error| {
            format!(
                "failed to resolve existing plugin directory: {}: {error}",
                destination_root.display()
            )
        })?;

        if canonical_source == canonical_destination {
            return Err("plugin source is already installed".to_string());
        }

        if canonical_source.starts_with(&canonical_destination) {
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

        fs::remove_dir_all(&canonical_destination).map_err(|error| {
            format!(
                "failed to remove existing plugin directory: {}: {error}",
                canonical_destination.display()
            )
        })?;
    }

    copy_dir_all(&canonical_source, &destination_root).map_err(|error| {
        format!(
            "failed to install plugin: {} -> {}: {error}",
            canonical_source.display(),
            destination_root.display()
        )
    })?;

    let installed_manifest_path = destination_root.join("manifest.json");
    let manifest = load_plugin_manifest(&installed_manifest_path)?;

    revoke_plugin_trust_record(settings_path, &manifest.id)?;

    Ok(PluginInstallResult {
        plugin_id: manifest.id.clone(),
        installed_path: destination_root.display().to_string(),
        replaced,
        manifest,
    })
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

fn revoke_plugin_trust_record(settings_path: &Path, plugin_id: &str) -> Result<(), String> {
    let mut settings = load_settings(settings_path);
    remove_plugin_trust(&mut settings.plugins, plugin_id);
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
    let plugin_root = manifest_path.parent().ok_or_else(|| {
        format!(
            "plugin manifest has no parent directory: {}",
            manifest_path.display()
        )
    })?;
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
    let entry_path = plugin_root.join(relative_entry);
    let canonical_entry = resolve_plugin_child_file(plugin_root, &entry_path, "plugin entrypoint")?;

    let source = fs::read_to_string(&canonical_entry).map_err(|error| {
        format!(
            "failed to read plugin entrypoint: {}: {error}",
            canonical_entry.display()
        )
    })?;

    Ok(PluginEntrypointSource {
        plugin_id: manifest.id,
        entrypoint: entrypoint.to_string(),
        path: canonical_entry.display().to_string(),
        source,
    })
}

pub fn read_plugin_asset_source(
    app_data_dir: &Path,
    plugin_id: &str,
    asset: &str,
) -> Result<PluginAssetSource, String> {
    let manifest_path = resolve_plugin_manifest_path(app_data_dir, plugin_id)?;
    let plugin_root = manifest_path.parent().ok_or_else(|| {
        format!(
            "plugin manifest has no parent directory: {}",
            manifest_path.display()
        )
    })?;
    let relative_path = match asset {
        "styles" => "styles.css",
        _ => return Err(format!("unsupported plugin asset: {asset}")),
    };
    let asset_path = plugin_root.join(relative_path);
    let canonical_asset = resolve_plugin_child_file(plugin_root, &asset_path, "plugin asset")?;
    let source = fs::read_to_string(&canonical_asset).map_err(|error| {
        format!(
            "failed to read plugin asset: {}: {error}",
            canonical_asset.display()
        )
    })?;
    let manifest = load_plugin_manifest(&manifest_path)?;

    Ok(PluginAssetSource {
        plugin_id: manifest.id,
        asset: asset.to_string(),
        path: canonical_asset.display().to_string(),
        source,
    })
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
    }
}

fn plugin_manifest_fingerprint(
    manifest_path: &Path,
    manifest: &PluginManifest,
) -> Result<String, String> {
    let plugin_root = manifest_path.parent().ok_or_else(|| {
        format!(
            "plugin manifest has no parent directory: {}",
            manifest_path.display()
        )
    })?;
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

    Ok(format!("{:x}", hasher.finalize()))
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

pub fn load_plugin_manifest(path: &Path) -> Result<PluginManifest, String> {
    let content = fs::read_to_string(path).map_err(|error| {
        format!(
            "failed to read plugin manifest: {}: {error}",
            path.display()
        )
    })?;

    let raw = serde_json::from_str::<RawPluginManifest>(&content).map_err(|error| {
        format!(
            "failed to parse plugin manifest: {}: {error}",
            path.display()
        )
    })?;

    normalize_plugin_manifest(path, raw)
}

fn normalize_plugin_manifest(
    path: &Path,
    raw: RawPluginManifest,
) -> Result<PluginManifest, String> {
    let mut warnings = Vec::new();

    validate_non_empty("id", &raw.id)?;
    validate_non_empty("name", &raw.name)?;
    validate_non_empty("version", &raw.version)?;

    if !is_valid_plugin_id(&raw.id) {
        return Err(format!("invalid plugin id: {}", raw.id));
    }

    validate_version("version", &raw.version)?;

    let directory_id = path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            format!(
                "plugin manifest has no plugin directory: {}",
                path.display()
            )
        })?;

    if directory_id != raw.id {
        return Err(format!(
            "plugin id mismatch: directory is {directory_id}, manifest contains {}",
            raw.id
        ));
    }

    let api_version = raw
        .api_version
        .clone()
        .unwrap_or_else(|| DEFAULT_PLUGIN_API_VERSION.to_string());

    validate_supported_api_version(&api_version)?;

    if raw.api_version.is_none() {
        warnings.push(format!(
            "apiVersion is missing; assuming {DEFAULT_PLUGIN_API_VERSION}"
        ));
    }

    validate_entrypoints(raw.entrypoints.as_ref())?;

    if let Some(page) = raw.page.as_ref() {
        validate_relative_child_path("page", page)?;
    }

    if raw.backend.is_some() {
        return Err("plugin backend is not supported; plugins are frontend-only".to_string());
    }

    if let Some(default_locale) = raw.default_locale.as_ref() {
        validate_non_empty("defaultLocale", default_locale)?;
    }

    let (i18n, i18n_path) = load_plugin_i18n(path, raw.i18n, raw.default_locale.as_deref())?;
    let page_definition = load_plugin_page_definition(path, &raw.id, raw.page.as_deref())?;

    let contributes_internal_page = raw
        .contributes
        .as_ref()
        .and_then(|contributes| contributes.internal_page.clone());
    let contributes_internal_pages_plural = raw
        .contributes
        .as_ref()
        .and_then(|contributes| contributes.internal_pages.clone());
    let contributes_internal_pages = match (
        contributes_internal_page,
        contributes_internal_pages_plural,
    ) {
        (Some(page), Some(_)) => {
            warnings.push(
                    "both contributes.internalPage and contributes.internalPages are defined; using contributes.internalPage".to_string(),
                );
            Some(vec![page])
        }
        (Some(page), None) => Some(vec![page]),
        (None, Some(pages)) => Some(pages),
        (None, None) => None,
    };
    let mut internal_pages = match (contributes_internal_pages, raw.internal_pages.clone()) {
        (Some(pages), Some(_)) => {
            warnings.push(
                "both contributes internal pages and top-level internalPages are defined; using contributes internal pages".to_string(),
            );
            Some(pages)
        }
        (Some(pages), None) => Some(pages),
        (None, Some(pages)) => {
            warnings.push(
                "top-level internalPages is deprecated; use contributes.internalPages".to_string(),
            );
            Some(pages)
        }
        (None, None) => None,
    };

    if let Some(pages) = internal_pages.as_mut() {
        for page in pages {
            normalize_internal_page_manifest(&raw.id, page, page_definition.as_ref());
        }
    }

    let mut contributes = raw.contributes;

    if let Some(contributes) = contributes.as_mut() {
        normalize_contributions(contributes);
        contributes.internal_pages = internal_pages.clone();
        contributes.internal_page = internal_pages
            .as_ref()
            .and_then(|pages| (pages.len() == 1).then(|| pages[0].clone()));
    }

    validate_contributions(&raw.id, internal_pages.as_ref(), contributes.as_ref())?;

    let contributes = match (contributes, internal_pages.clone()) {
        (Some(mut contributes), pages) => {
            contributes.internal_pages = pages;
            contributes.internal_page = internal_pages
                .as_ref()
                .and_then(|pages| (pages.len() == 1).then(|| pages[0].clone()));
            Some(contributes)
        }
        (None, Some(pages)) => Some(PluginContributions {
            internal_page: (pages.len() == 1).then(|| pages[0].clone()),
            internal_pages: Some(pages),
            actions: None,
            viewers: None,
        }),
        (None, None) => None,
    };

    Ok(PluginManifest {
        id: raw.id,
        name: raw.name,
        version: raw.version,
        api_version: Some(api_version),
        description: raw.description,
        default_locale: raw.default_locale,
        i18n,
        i18n_path,
        page: raw.page,
        page_definition,
        enabled_by_default: raw.enabled_by_default,
        entrypoints: raw.entrypoints,
        contributes,
        dependencies: raw.dependencies,
        capabilities: raw.capabilities,
        settings: raw.settings,
        internal_pages,
        warnings,
    })
}

fn normalize_contributions(contributes: &mut PluginContributions) {
    if let Some(actions) = contributes.actions.as_mut() {
        for action in actions {
            action.title = normalized_localized_string(
                &action.title,
                action.title_key.as_deref(),
                action.title_fallback.as_deref(),
                &action.id,
            );

            if action.description.is_none() {
                action.description = action
                    .description_fallback
                    .as_deref()
                    .map(str::trim)
                    .filter(|description| !description.is_empty())
                    .map(str::to_string);
            }
        }
    }

    if let Some(viewers) = contributes.viewers.as_mut() {
        for viewer in viewers {
            viewer.title = normalized_localized_string(
                &viewer.title,
                viewer.title_key.as_deref(),
                viewer.title_fallback.as_deref(),
                &viewer.id,
            );

            if viewer.description.is_none() {
                viewer.description = viewer
                    .description_fallback
                    .as_deref()
                    .map(str::trim)
                    .filter(|description| !description.is_empty())
                    .map(str::to_string);
            }
        }
    }
}

fn normalize_internal_page_manifest(
    plugin_id: &str,
    page: &mut PluginInternalPageManifest,
    page_definition: Option<&serde_json::Value>,
) {
    page.title = normalized_localized_string(
        &page.title,
        page.title_key.as_deref(),
        page.title_fallback.as_deref(),
        plugin_id,
    );

    if let Some(page_definition) = page_definition {
        let page_definition_id = page_definition
            .get("id")
            .and_then(serde_json::Value::as_str);

        if page_definition_id == Some(page.id.as_str()) {
            page.page_definition = Some(page_definition.clone());

            if page.page_action.is_none() {
                page.page_action = read_page_action_from_page_definition(page_definition);
            }
        }
    }
}

fn normalized_localized_string(
    value: &str,
    key: Option<&str>,
    fallback: Option<&str>,
    default: &str,
) -> String {
    if !value.trim().is_empty() {
        return value.to_string();
    }

    fallback
        .or(key)
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .unwrap_or(default)
        .to_string()
}

fn read_page_action_from_page_definition(
    page_definition: &serde_json::Value,
) -> Option<PluginPageActionManifest> {
    let tabs = page_definition.get("tabs")?.as_array()?;
    let playground = tabs
        .iter()
        .find(|tab| tab.get("type").and_then(serde_json::Value::as_str) == Some("playground"))?;
    let action_id = playground
        .get("action")
        .or_else(|| playground.get("actionId"))
        .and_then(serde_json::Value::as_str)?
        .to_string();
    let input_placeholder = playground
        .get("inputPlaceholder")
        .or_else(|| playground.get("inputPlaceholderFallback"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let examples = playground
        .get("examples")
        .and_then(serde_json::Value::as_array)
        .map(|examples| {
            examples
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .filter(|examples| !examples.is_empty());

    Some(PluginPageActionManifest {
        action_id,
        input_placeholder,
        examples,
    })
}

fn validate_contributions(
    plugin_id: &str,
    internal_pages: Option<&Vec<crate::models::plugins::PluginInternalPageManifest>>,
    contributes: Option<&PluginContributions>,
) -> Result<(), String> {
    if let Some(pages) = internal_pages {
        let mut seen_page_ids = std::collections::HashSet::new();

        for page in pages {
            validate_non_empty("internalPages[].id", &page.id)?;
            validate_non_empty("internalPages[].title", &page.title)?;

            if !page.id.starts_with("plugin:") {
                return Err(format!(
                    "internal page id must start with plugin:: {}",
                    page.id
                ));
            }

            let expected_prefix = format!("plugin:{plugin_id}");
            if !page.id.starts_with(&expected_prefix) {
                return Err(format!(
                    "internal page id must start with {expected_prefix}: {}",
                    page.id
                ));
            }

            if !seen_page_ids.insert(page.id.clone()) {
                return Err(format!("duplicate internal page id: {}", page.id));
            }

            if let Some(page_action) = page.page_action.as_ref() {
                validate_non_empty(
                    "internalPages[].pageAction.actionId",
                    &page_action.action_id,
                )?;

                if !is_valid_contribution_id(&page_action.action_id) {
                    return Err(format!("invalid page action id: {}", page_action.action_id));
                }
            }

            if let Some(commands) = page.help.as_ref().and_then(|help| help.commands.as_ref()) {
                for command in commands {
                    validate_non_empty(
                        "internalPages[].help.commands[].command",
                        &command.command,
                    )?;
                    validate_non_empty(
                        "internalPages[].help.commands[].description",
                        &command.description,
                    )?;
                }
            }
        }
    }

    if let Some(actions) = contributes.and_then(|contributes| contributes.actions.as_ref()) {
        let mut seen_action_ids = std::collections::HashSet::new();

        for action in actions {
            validate_non_empty("contributes.actions[].id", &action.id)?;
            validate_non_empty("contributes.actions[].title", &action.title)?;

            if !is_valid_contribution_id(&action.id) {
                return Err(format!("invalid action id: {}", action.id));
            }

            if !seen_action_ids.insert(action.id.clone()) {
                return Err(format!("duplicate action id: {}", action.id));
            }
        }
    }

    if let Some(viewers) = contributes.and_then(|contributes| contributes.viewers.as_ref()) {
        let mut seen_viewer_ids = std::collections::HashSet::new();

        for viewer in viewers {
            validate_non_empty("contributes.viewers[].id", &viewer.id)?;
            validate_non_empty("contributes.viewers[].title", &viewer.title)?;

            if !is_valid_contribution_id(&viewer.id) {
                return Err(format!("invalid viewer id: {}", viewer.id));
            }

            if !seen_viewer_ids.insert(viewer.id.clone()) {
                return Err(format!("duplicate viewer id: {}", viewer.id));
            }

            if let Some(extensions) = viewer.extensions.as_ref() {
                if extensions.is_empty() {
                    return Err("contributes.viewers[].extensions must not be empty".to_string());
                }

                for extension in extensions {
                    validate_non_empty("contributes.viewers[].extensions[]", extension)?;

                    if !is_valid_file_extension(extension) {
                        return Err(format!("invalid viewer extension: {extension}"));
                    }
                }
            }
        }
    }

    Ok(())
}

fn validate_entrypoints(
    entrypoints: Option<&crate::models::plugins::PluginEntrypoints>,
) -> Result<(), String> {
    if let Some(entrypoints) = entrypoints {
        if let Some(main) = entrypoints.main.as_ref() {
            validate_relative_child_path("entrypoints.main", main)?;
        }

        if let Some(page) = entrypoints.page.as_ref() {
            validate_relative_child_path("entrypoints.page", page)?;
        }
    }

    Ok(())
}

fn load_plugin_page_definition(
    manifest_path: &Path,
    plugin_id: &str,
    relative_path: Option<&str>,
) -> Result<Option<serde_json::Value>, String> {
    let Some(relative_path) = relative_path else {
        return Ok(None);
    };

    validate_relative_child_path("page", relative_path)?;

    let plugin_root = manifest_path.parent().ok_or_else(|| {
        format!(
            "plugin manifest has no parent directory: {}",
            manifest_path.display()
        )
    })?;
    let page_path = plugin_root.join(relative_path);
    let canonical_page = resolve_plugin_child_file(plugin_root, &page_path, "plugin page")?;
    let content = fs::read_to_string(&canonical_page).map_err(|error| {
        format!(
            "failed to read plugin page file: {}: {error}",
            canonical_page.display()
        )
    })?;
    let page = serde_json::from_str::<serde_json::Value>(&content).map_err(|error| {
        format!(
            "failed to parse plugin page file: {}: {error}",
            canonical_page.display()
        )
    })?;

    validate_page_definition(&page, plugin_id)?;

    Ok(Some(page))
}

fn validate_page_definition(page: &serde_json::Value, plugin_id: &str) -> Result<(), String> {
    let object = page
        .as_object()
        .ok_or_else(|| "page must be an object".to_string())?;
    let id = object
        .get("id")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "page.id is required".to_string())?;

    validate_non_empty("page.id", id)?;

    if !id.starts_with("plugin:") {
        return Err(format!("page.id must start with plugin:: {id}"));
    }

    let expected_prefix = format!("plugin:{plugin_id}");
    if !id.starts_with(&expected_prefix) {
        return Err(format!("page.id must start with {expected_prefix}: {id}"));
    }

    let tabs = object
        .get("tabs")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "page.tabs must be an array".to_string())?;
    let mut seen_tab_ids = std::collections::HashSet::new();

    for tab in tabs {
        let tab_object = tab
            .as_object()
            .ok_or_else(|| "page.tabs[] must be an object".to_string())?;
        let tab_id = tab_object
            .get("id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "page.tabs[].id is required".to_string())?;
        let tab_type = tab_object
            .get("type")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "page.tabs[].type is required".to_string())?;

        validate_non_empty("page.tabs[].id", tab_id)?;
        validate_non_empty("page.tabs[].type", tab_type)?;

        if !seen_tab_ids.insert(tab_id.to_string()) {
            return Err(format!("duplicate page tab id: {tab_id}"));
        }

        match tab_type {
            "playground" | "converter" | "form" => {}
            _ => return Err(format!("unsupported page tab type: {tab_type}")),
        }

        if matches!(tab_type, "playground" | "converter" | "form") {
            let action = tab_object
                .get("action")
                .or_else(|| tab_object.get("actionId"))
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| format!("page tab {tab_id} action is required"))?;

            validate_non_empty("page.tabs[].action", action)?;

            if !is_valid_contribution_id(action) {
                return Err(format!("invalid page tab action id: {action}"));
            }
        }
    }

    Ok(())
}

fn load_plugin_i18n(
    manifest_path: &Path,
    raw_i18n: Option<serde_json::Value>,
    default_locale: Option<&str>,
) -> Result<(Option<serde_json::Value>, Option<String>), String> {
    let Some(raw_i18n) = raw_i18n else {
        return Ok((None, None));
    };

    match raw_i18n {
        serde_json::Value::String(relative_path) => {
            validate_relative_child_path("i18n", &relative_path)?;

            let plugin_root = manifest_path.parent().ok_or_else(|| {
                format!(
                    "plugin manifest has no parent directory: {}",
                    manifest_path.display()
                )
            })?;
            let i18n_path = plugin_root.join(&relative_path);
            let canonical_i18n = resolve_plugin_child_file(plugin_root, &i18n_path, "plugin i18n")?;
            let content = fs::read_to_string(&canonical_i18n).map_err(|error| {
                format!(
                    "failed to read plugin i18n file: {}: {error}",
                    canonical_i18n.display()
                )
            })?;
            let value = serde_json::from_str::<serde_json::Value>(&content).map_err(|error| {
                format!(
                    "failed to parse plugin i18n file: {}: {error}",
                    canonical_i18n.display()
                )
            })?;

            validate_i18n_value("i18n", &value, default_locale)?;

            Ok((
                Some(normalize_i18n_value(value, default_locale)),
                Some(relative_path),
            ))
        }
        value => {
            validate_i18n_value("i18n", &value, default_locale)?;

            Ok((Some(normalize_i18n_value(value, default_locale)), None))
        }
    }
}

fn normalize_i18n_value(
    value: serde_json::Value,
    default_locale: Option<&str>,
) -> serde_json::Value {
    let Some(default_locale) = default_locale else {
        return value;
    };

    if value
        .as_object()
        .and_then(|object| object.get("translations"))
        .is_some()
    {
        let mut object = value.as_object().cloned().unwrap_or_default();
        object
            .entry("defaultLocale".to_string())
            .or_insert_with(|| serde_json::Value::String(default_locale.to_string()));

        return serde_json::Value::Object(object);
    }

    serde_json::json!({
        "defaultLocale": default_locale,
        "translations": value,
    })
}

fn validate_i18n_value(
    label: &str,
    value: &serde_json::Value,
    default_locale: Option<&str>,
) -> Result<(), String> {
    let Some(source) = i18n_locale_map(value) else {
        return Err(format!("{label} must be a locale dictionary object"));
    };

    if let Some(default_locale) = default_locale {
        match source.get(default_locale) {
            Some(serde_json::Value::Object(_)) => {}
            Some(_) => {
                return Err(format!(
                    "{label}.{default_locale} must be a dictionary object"
                ));
            }
            None => {}
        }
    }

    for (locale, dictionary) in source {
        validate_non_empty("i18n locale", locale)?;

        if !is_valid_locale_code(locale) {
            return Err(format!("invalid i18n locale: {locale}"));
        }

        if !dictionary.is_object() {
            return Err(format!("{label}.{locale} must be a dictionary object"));
        }
    }

    Ok(())
}

fn i18n_locale_map(
    value: &serde_json::Value,
) -> Option<&serde_json::Map<String, serde_json::Value>> {
    let object = value.as_object()?;

    object
        .get("translations")
        .and_then(serde_json::Value::as_object)
        .or(Some(object))
}

fn is_valid_locale_code(locale: &str) -> bool {
    !locale.is_empty()
        && locale
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

fn validate_non_empty(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} is required"));
    }

    Ok(())
}

fn is_valid_file_extension(extension: &str) -> bool {
    let normalized = extension.trim_start_matches('.');

    !normalized.is_empty()
        && normalized
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

fn validate_version(label: &str, value: &str) -> Result<(), String> {
    parse_version_triplet(value)
        .map(|_| ())
        .map_err(|error| format!("{label} {error}"))
}

fn validate_supported_api_version(api_version: &str) -> Result<(), String> {
    let requested = parse_version_triplet(api_version)?;
    let supported = parse_version_triplet(SUPPORTED_PLUGIN_API_VERSION)?;

    if requested.0 != supported.0 {
        return Err(format!(
            "unsupported plugin apiVersion {api_version}; supported version is {SUPPORTED_PLUGIN_API_VERSION}"
        ));
    }

    if requested > supported {
        return Err(format!(
            "plugin apiVersion {api_version} is newer than supported {SUPPORTED_PLUGIN_API_VERSION}"
        ));
    }

    Ok(())
}

fn parse_version_triplet(value: &str) -> Result<(u64, u64, u64), String> {
    let mut parts = value.split('.');
    let major = parse_version_part(value, parts.next())?;
    let minor = parse_version_part(value, parts.next())?;
    let patch = parse_version_part(value, parts.next())?;

    if parts.next().is_some() {
        return Err(format!("must be a semantic version triplet: {value}"));
    }

    Ok((major, minor, patch))
}

fn parse_version_part(full_value: &str, part: Option<&str>) -> Result<u64, String> {
    let Some(part) = part else {
        return Err(format!("must be a semantic version triplet: {full_value}"));
    };

    if part.is_empty() || !part.chars().all(|character| character.is_ascii_digit()) {
        return Err(format!("must be a semantic version triplet: {full_value}"));
    }

    part.parse::<u64>()
        .map_err(|_| format!("must be a semantic version triplet: {full_value}"))
}

fn validate_relative_child_path(label: &str, value: &str) -> Result<(), String> {
    validate_non_empty(label, value)?;

    let path = Path::new(value);

    if path.is_absolute() {
        return Err(format!("{label} must be relative to the plugin root"));
    }

    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(format!(
            "{label} must not contain parent directory segments"
        ));
    }

    Ok(())
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

fn is_valid_contribution_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::models::settings::{AppSettings, PluginSettings, PluginTrustRecord};

    fn unique_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("glimpse_plugin_store_test_{unique}_{name}"))
    }

    fn write_plugin_source(root: &Path, plugin_id: &str) {
        let plugin_root = root.join(plugin_id);
        fs::create_dir_all(&plugin_root).unwrap();
        fs::write(
            plugin_root.join("manifest.json"),
            format!(
                r#"{{
  "id": "{plugin_id}",
  "name": "Sample Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "entrypoints": {{ "main": "./main.js" }}
}}"#
            ),
        )
        .unwrap();
        fs::write(
            plugin_root.join("main.js"),
            "export default function activate() {}",
        )
        .unwrap();
    }

    fn write_plugin_manifest(root: &Path, plugin_id: &str, manifest: &str) -> PathBuf {
        let plugin_root = root.join(plugin_id);
        fs::create_dir_all(&plugin_root).unwrap();
        fs::write(plugin_root.join("manifest.json"), manifest).unwrap();
        plugin_root
    }

    fn write_full_plugin(root: &Path, plugin_id: &str) -> PathBuf {
        let plugin_root = write_plugin_manifest(
            root,
            plugin_id,
            &format!(
                r#"{{
  "id": "{plugin_id}",
  "name": "Full Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "description": "A complete plugin fixture.",
  "enabledByDefault": true,
  "entrypoints": {{ "main": "./main.js", "page": "./page.js" }},
  "capabilities": {{
    "files": {{
      "read": "active-tab"
    }}
  }},
  "contributes": {{
    "internalPages": [
      {{
        "id": "plugin:{plugin_id}",
        "title": "Full Plugin Page",
        "tags": ["internal", "plugin"],
        "aliases": ["fixture"],
        "boost": 1.5
      }}
    ],
    "actions": [
      {{
        "id": "calculate",
        "title": "Calculate",
        "description": "Run a calculation.",
        "aliases": ["calc"]
      }}
    ],
    "viewers": [
      {{
        "id": "pdf",
        "title": "PDF Viewer",
        "description": "Preview PDF files.",
        "extensions": ["pdf"]
      }}
    ]
  }}
}}"#
            ),
        );

        fs::write(
            plugin_root.join("main.js"),
            "export default function activate() { return 'ok'; }",
        )
        .unwrap();
        fs::write(plugin_root.join("page.js"), "export const page = true;").unwrap();
        fs::write(plugin_root.join("styles.css"), ".fixture { color: red; }").unwrap();

        plugin_root
    }

    fn assert_error_contains<T: std::fmt::Debug>(result: Result<T, String>, expected: &str) {
        let error = result.expect_err("expected error");

        assert!(
            error.contains(expected),
            "expected error to contain {expected:?}, got {error:?}"
        );
    }

    fn app_plugins_dir(app_data_dir: &Path) -> PathBuf {
        app_data_dir.join("plugins")
    }

    fn fixture_plugins_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("tests")
            .join("fixtures")
            .join("plugins")
    }

    fn copy_fixture_plugin(app_data_dir: &Path, plugin_id: &str) {
        let source = fixture_plugins_dir().join(plugin_id);
        let destination = app_plugins_dir(app_data_dir).join(plugin_id);

        copy_dir_all(&source, &destination).unwrap();
    }

    #[test]
    fn manifest_loads_v02_standard_page_manifest() {
        let app_data_dir = unique_test_dir("app");
        let plugins_dir = app_plugins_dir(&app_data_dir);
        let plugin_id = "v02-plugin";
        let plugin_root = write_plugin_manifest(
            &plugins_dir,
            plugin_id,
            &format!(
                r#"{{
  "id": "{plugin_id}",
  "name": "v0.2 Plugin",
  "version": "0.2.0",
  "apiVersion": "0.2.0",
  "defaultLocale": "en",
  "i18n": "./i18n.json",
  "page": "./page.json",
  "entrypoints": {{ "main": "./main.js" }},
  "capabilities": {{
    "files": {{
      "read": "none",
      "write": "declared-output-directory"
    }}
  }},
  "settings": {{
    "outputDirectory": {{
      "type": "directory",
      "labelKey": "settings.outputDirectory.label",
      "labelFallback": "Output directory"
    }}
  }},
  "contributes": {{
    "internalPage": {{
      "id": "plugin:{plugin_id}",
      "titleKey": "plugin.name",
      "titleFallback": "v0.2 Plugin"
    }},
    "actions": [
      {{
        "id": "calculate",
        "titleKey": "actions.calculate.title",
        "titleFallback": "Calculate",
        "descriptionKey": "actions.calculate.description",
        "descriptionFallback": "Run a calculation.",
        "input": {{ "type": "text" }},
        "output": {{ "type": "text" }}
      }}
    ],
    "viewers": [
      {{
        "id": "csv",
        "titleKey": "viewers.csv.title",
        "titleFallback": "CSV Viewer",
        "extensions": ["csv"]
      }}
    ]
  }}
}}"#
            ),
        );
        fs::write(
            plugin_root.join("page.json"),
            r#"{
  "id": "plugin:v02-plugin",
  "tabs": [
    {
      "id": "playground",
      "type": "playground",
      "titleKey": "tabs.playground.title",
      "titleFallback": "Playground",
      "action": "calculate",
      "inputPlaceholderFallback": "Expression",
      "examples": ["1 + 1"]
    }
  ]
}"#,
        )
        .unwrap();
        fs::write(plugin_root.join("i18n.json"), r#"{ "en": {} }"#).unwrap();
        fs::write(
            plugin_root.join("main.js"),
            "export default function activate() {}",
        )
        .unwrap();

        let manifest = load_plugin_manifest(&plugin_root.join("manifest.json")).unwrap();
        let contributes = manifest.contributes.as_ref().unwrap();
        let page = manifest.internal_pages.as_ref().unwrap().first().unwrap();

        assert_eq!(manifest.api_version.as_deref(), Some("0.2.0"));
        assert_eq!(manifest.page.as_deref(), Some("./page.json"));
        assert!(manifest.page_definition.is_some());
        assert!(manifest.settings.is_some());
        assert_eq!(page.title, "v0.2 Plugin");
        assert_eq!(page.page_action.as_ref().unwrap().action_id, "calculate");
        assert!(page.page_definition.is_some());
        assert_eq!(contributes.actions.as_ref().unwrap()[0].title, "Calculate");
        assert_eq!(
            contributes.actions.as_ref().unwrap()[0]
                .description
                .as_deref(),
            Some("Run a calculation.")
        );
        assert_eq!(contributes.viewers.as_ref().unwrap()[0].title, "CSV Viewer");

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn v02_page_definition_participates_in_plugin_fingerprint() {
        let app_data_dir = unique_test_dir("app");
        let settings_path = app_data_dir.join("settings.json");
        let plugins_dir = app_plugins_dir(&app_data_dir);
        let plugin_id = "v02-trust-plugin";
        let plugin_root = write_plugin_manifest(
            &plugins_dir,
            plugin_id,
            &format!(
                r#"{{
  "id": "{plugin_id}",
  "name": "v0.2 Trust Plugin",
  "version": "0.2.0",
  "apiVersion": "0.2.0",
  "page": "./page.json",
  "entrypoints": {{ "main": "./main.js" }},
  "contributes": {{
    "internalPage": {{
      "id": "plugin:{plugin_id}",
      "titleFallback": "v0.2 Trust Plugin"
    }}
  }}
}}"#
            ),
        );
        fs::write(
            plugin_root.join("page.json"),
            r#"{ "id": "plugin:v02-trust-plugin", "tabs": [] }"#,
        )
        .unwrap();
        fs::write(
            plugin_root.join("main.js"),
            "export default function activate() {}",
        )
        .unwrap();

        let trusted = set_plugin_trust(&app_data_dir, &settings_path, plugin_id, true).unwrap();
        fs::write(
            plugin_root.join("page.json"),
            r#"{ "id": "plugin:v02-trust-plugin", "tabs": [{ "id": "playground", "type": "playground", "action": "calculate" }] }"#,
        )
        .unwrap();

        let changed = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();

        assert!(!changed.trusted);
        assert_eq!(
            changed.reason.as_deref(),
            Some("plugin files changed since it was trusted")
        );
        assert_ne!(changed.manifest_fingerprint, trusted.manifest_fingerprint);

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn installs_plugin_from_local_directory() {
        let app_data_dir = unique_test_dir("app");
        let source_parent = unique_test_dir("source");
        let settings_path = app_data_dir.join("settings.json");
        let plugin_id = "sample-install-plugin";

        write_plugin_source(&source_parent, plugin_id);

        let result = install_plugin_from_path(
            &app_data_dir,
            &settings_path,
            &source_parent.join(plugin_id).display().to_string(),
            false,
        )
        .unwrap();

        assert_eq!(result.plugin_id, plugin_id);
        assert!(!result.replaced);
        assert!(app_data_dir
            .join("plugins")
            .join(plugin_id)
            .join("main.js")
            .is_file());

        let manifests = load_plugin_manifests(&app_data_dir).unwrap();
        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].id, plugin_id);

        fs::remove_dir_all(app_data_dir).ok();
        fs::remove_dir_all(source_parent).ok();
    }

    #[test]
    fn discovery_reports_valid_manifests_and_invalid_plugin_errors() {
        let app_data_dir = unique_test_dir("app");
        let plugins_dir = app_plugins_dir(&app_data_dir);

        write_plugin_source(&plugins_dir, "valid-discovery-plugin");
        write_plugin_manifest(
            &plugins_dir,
            "invalid-discovery-plugin",
            r#"{
  "id": "invalid-discovery-plugin",
  "name": "Invalid Plugin",
  "version": "0.1",
  "apiVersion": "0.1.0"
}"#,
        );

        let report = load_plugin_discovery_report(&app_data_dir).unwrap();

        assert_eq!(report.manifests.len(), 1);
        assert_eq!(report.manifests[0].id, "valid-discovery-plugin");
        assert_eq!(report.errors.len(), 1);
        assert!(report.errors[0].path.ends_with("manifest.json"));
        assert!(report.errors[0]
            .error
            .contains("version must be a semantic version triplet"));

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn manifest_normalizes_contributions_and_capabilities() {
        let app_data_dir = unique_test_dir("app");
        let plugins_dir = app_plugins_dir(&app_data_dir);
        let plugin_id = "full-manifest-plugin";
        let plugin_root = write_full_plugin(&plugins_dir, plugin_id);

        let manifest = load_plugin_manifest(&plugin_root.join("manifest.json")).unwrap();

        assert_eq!(manifest.id, plugin_id);
        assert_eq!(manifest.api_version.as_deref(), Some("0.1.0"));
        assert!(manifest.capabilities.is_some());
        assert!(manifest
            .capabilities
            .as_ref()
            .and_then(|capabilities| capabilities.files.as_ref())
            .and_then(|files| files.read.as_ref())
            .is_some());
        assert!(manifest.internal_pages.is_some());
        assert_eq!(
            manifest
                .contributes
                .as_ref()
                .unwrap()
                .internal_pages
                .as_ref()
                .unwrap()[0]
                .id,
            format!("plugin:{plugin_id}")
        );
        assert_eq!(
            manifest
                .contributes
                .as_ref()
                .unwrap()
                .actions
                .as_ref()
                .unwrap()[0]
                .id,
            "calculate"
        );
        assert_eq!(
            manifest
                .contributes
                .as_ref()
                .unwrap()
                .viewers
                .as_ref()
                .unwrap()[0]
                .id,
            "pdf"
        );

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn manifest_loads_linked_i18n_file_when_declared() {
        let app_data_dir = unique_test_dir("app");
        let plugins_dir = app_plugins_dir(&app_data_dir);
        let plugin_id = "linked-i18n-plugin";
        let plugin_root = write_plugin_manifest(
            &plugins_dir,
            plugin_id,
            &format!(
                r#"{{
  "id": "{plugin_id}",
  "name": "Linked i18n Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "defaultLocale": "en",
  "i18n": "./i18n.json",
  "entrypoints": {{ "main": "./main.js" }}
}}"#
            ),
        );
        fs::write(
            plugin_root.join("i18n.json"),
            r#"{
  "en": {
    "plugin.name": "Linked i18n Plugin",
    "actions.hello.title": "Say hello"
  },
  "ja": {
    "plugin.name": "リンク i18n プラグイン"
  }
}"#,
        )
        .unwrap();
        fs::write(
            plugin_root.join("main.js"),
            "export default function activate() {}",
        )
        .unwrap();

        let manifest = load_plugin_manifest(&plugin_root.join("manifest.json")).unwrap();
        let i18n = manifest.i18n.as_ref().unwrap();

        assert_eq!(manifest.default_locale.as_deref(), Some("en"));
        assert_eq!(manifest.i18n_path.as_deref(), Some("./i18n.json"));
        assert_eq!(i18n["defaultLocale"], serde_json::json!("en"));
        assert_eq!(
            i18n["translations"]["ja"]["plugin.name"],
            serde_json::json!("リンク i18n プラグイン")
        );

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn linked_i18n_file_participates_in_plugin_fingerprint() {
        let app_data_dir = unique_test_dir("app");
        let settings_path = app_data_dir.join("settings.json");
        let plugins_dir = app_plugins_dir(&app_data_dir);
        let plugin_id = "i18n-trust-plugin";
        let plugin_root = write_plugin_manifest(
            &plugins_dir,
            plugin_id,
            &format!(
                r#"{{
  "id": "{plugin_id}",
  "name": "i18n Trust Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "defaultLocale": "en",
  "i18n": "./i18n.json",
  "entrypoints": {{ "main": "./main.js" }}
}}"#
            ),
        );
        fs::write(
            plugin_root.join("i18n.json"),
            r#"{ "en": { "name": "Before" } }"#,
        )
        .unwrap();
        fs::write(
            plugin_root.join("main.js"),
            "export default function activate() {}",
        )
        .unwrap();

        let trusted = set_plugin_trust(&app_data_dir, &settings_path, plugin_id, true).unwrap();
        fs::write(
            plugin_root.join("i18n.json"),
            r#"{ "en": { "name": "After" } }"#,
        )
        .unwrap();

        let changed = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();

        assert!(!changed.trusted);
        assert_eq!(
            changed.reason.as_deref(),
            Some("plugin files changed since it was trusted")
        );
        assert_ne!(changed.manifest_fingerprint, trusted.manifest_fingerprint);

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn linked_i18n_allows_missing_default_locale_dictionary() {
        let app_data_dir = unique_test_dir("app");
        let plugins_dir = app_plugins_dir(&app_data_dir);
        let plugin_id = "partial-i18n-plugin";
        let plugin_root = write_plugin_manifest(
            &plugins_dir,
            plugin_id,
            &format!(
                r#"{{
  "id": "{plugin_id}",
  "name": "Partial i18n Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "defaultLocale": "en",
  "i18n": "./i18n.json",
  "entrypoints": {{ "main": "./main.js" }}
}}"#
            ),
        );
        fs::write(
            plugin_root.join("i18n.json"),
            r#"{ "ja": { "plugin.name": "部分 i18n プラグイン" } }"#,
        )
        .unwrap();
        fs::write(
            plugin_root.join("main.js"),
            "export default function activate() {}",
        )
        .unwrap();

        let manifest = load_plugin_manifest(&plugin_root.join("manifest.json")).unwrap();

        assert_eq!(manifest.default_locale.as_deref(), Some("en"));
        assert_eq!(
            manifest.i18n.as_ref().unwrap()["translations"]["ja"]["plugin.name"],
            serde_json::json!("部分 i18n プラグイン")
        );

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn manifest_rejects_unsafe_entrypoints_and_contribution_ids() {
        let app_data_dir = unique_test_dir("app");
        let plugins_dir = app_plugins_dir(&app_data_dir);

        let unsafe_entry = write_plugin_manifest(
            &plugins_dir,
            "unsafe-entry-plugin",
            r#"{
  "id": "unsafe-entry-plugin",
  "name": "Unsafe Entry Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "entrypoints": { "main": "../main.js" }
}"#,
        );
        let bad_page = write_plugin_manifest(
            &plugins_dir,
            "bad-page-plugin",
            r#"{
  "id": "bad-page-plugin",
  "name": "Bad Page Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "contributes": {
    "internalPages": [
      { "id": "plugin:other-plugin", "title": "Wrong Page" }
    ]
  }
}"#,
        );
        let bad_action = write_plugin_manifest(
            &plugins_dir,
            "bad-action-plugin",
            r#"{
  "id": "bad-action-plugin",
  "name": "Bad Action Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "contributes": {
    "actions": [
      { "id": "../escape", "title": "Escape" }
    ]
  }
}"#,
        );
        let bad_viewer = write_plugin_manifest(
            &plugins_dir,
            "bad-viewer-plugin",
            r#"{
  "id": "bad-viewer-plugin",
  "name": "Bad Viewer Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "contributes": {
    "viewers": [
      { "id": "../escape", "title": "Escape", "extensions": ["pdf"] }
    ]
  }
}"#,
        );

        assert_error_contains(
            load_plugin_manifest(&unsafe_entry.join("manifest.json")),
            "entrypoints.main must not contain parent directory segments",
        );
        assert_error_contains(
            load_plugin_manifest(&bad_page.join("manifest.json")),
            "internal page id must start with plugin:bad-page-plugin",
        );
        assert_error_contains(
            load_plugin_manifest(&bad_action.join("manifest.json")),
            "invalid action id",
        );
        assert_error_contains(
            load_plugin_manifest(&bad_viewer.join("manifest.json")),
            "invalid viewer id",
        );

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn manifest_rejects_backend_declarations() {
        let app_data_dir = unique_test_dir("app");
        let plugins_dir = app_plugins_dir(&app_data_dir);
        let plugin_root = write_plugin_manifest(
            &plugins_dir,
            "backend-plugin",
            r#"{
  "id": "backend-plugin",
  "name": "Backend Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "backend": {
    "runtime": "native-library-hosted",
    "entry": "./backend/plugin.dll"
  }
}"#,
        );

        assert_error_contains(
            load_plugin_manifest(&plugin_root.join("manifest.json")),
            "plugin backend is not supported",
        );

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn reads_entrypoints_and_assets_inside_plugin_root_only() {
        let app_data_dir = unique_test_dir("app");
        let plugins_dir = app_plugins_dir(&app_data_dir);
        let plugin_id = "asset-entry-plugin";

        write_full_plugin(&plugins_dir, plugin_id);

        let main = read_plugin_entrypoint_source(&app_data_dir, plugin_id, "main").unwrap();
        let page = read_plugin_entrypoint_source(&app_data_dir, plugin_id, "page").unwrap();
        let styles = read_plugin_asset_source(&app_data_dir, plugin_id, "styles").unwrap();

        assert_eq!(main.plugin_id, plugin_id);
        assert_eq!(main.entrypoint, "main");
        assert!(main.source.contains("activate"));
        assert_eq!(page.entrypoint, "page");
        assert!(page.source.contains("page = true"));
        assert_eq!(styles.asset, "styles");
        assert!(styles.source.contains(".fixture"));

        assert_error_contains(
            read_plugin_entrypoint_source(&app_data_dir, plugin_id, "unknown"),
            "unsupported plugin entrypoint",
        );
        assert_error_contains(
            read_plugin_asset_source(&app_data_dir, plugin_id, "script"),
            "unsupported plugin asset",
        );
        assert_error_contains(
            read_plugin_entrypoint_source(&app_data_dir, "../escape", "main"),
            "invalid plugin id",
        );

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn fixture_plugins_satisfy_discovery_entrypoint_and_trust_contracts() {
        let app_data_dir = unique_test_dir("app");
        let settings_path = app_data_dir.join("settings.json");

        copy_fixture_plugin(&app_data_dir, "valid-basic-plugin");
        copy_fixture_plugin(&app_data_dir, "numeric-calculator-plugin");

        let report = load_plugin_discovery_report(&app_data_dir).unwrap();
        let ids = report
            .manifests
            .iter()
            .map(|manifest| manifest.id.as_str())
            .collect::<std::collections::HashSet<_>>();

        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains("valid-basic-plugin"));
        assert!(ids.contains("numeric-calculator-plugin"));

        let basic = report
            .manifests
            .iter()
            .find(|manifest| manifest.id == "valid-basic-plugin")
            .unwrap();
        let numeric = report
            .manifests
            .iter()
            .find(|manifest| manifest.id == "numeric-calculator-plugin")
            .unwrap();

        assert_eq!(
            basic
                .contributes
                .as_ref()
                .unwrap()
                .actions
                .as_ref()
                .unwrap()[0]
                .id,
            "hello"
        );
        assert_eq!(
            numeric
                .contributes
                .as_ref()
                .unwrap()
                .internal_pages
                .as_ref()
                .unwrap()[0]
                .id,
            "plugin:numeric-calculator-plugin"
        );

        let main =
            read_plugin_entrypoint_source(&app_data_dir, "valid-basic-plugin", "main").unwrap();
        let styles =
            read_plugin_asset_source(&app_data_dir, "valid-basic-plugin", "styles").unwrap();

        assert!(main.source.contains("ctx.registerAction"));
        assert!(styles.source.contains("data-glimpse-plugin-page"));

        let initial =
            get_plugin_trust_status(&app_data_dir, &settings_path, "valid-basic-plugin").unwrap();
        assert!(!initial.trusted);

        let trusted =
            set_plugin_trust(&app_data_dir, &settings_path, "valid-basic-plugin", true).unwrap();
        assert!(trusted.trusted);
        ensure_plugin_trusted(&app_data_dir, &settings_path, "valid-basic-plugin").unwrap();

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn fixture_plugin_can_be_installed_from_contract_bundle() {
        let app_data_dir = unique_test_dir("app");
        let settings_path = app_data_dir.join("settings.json");
        let source = fixture_plugins_dir().join("numeric-calculator-plugin");

        let result = install_plugin_from_path(
            &app_data_dir,
            &settings_path,
            &source.display().to_string(),
            false,
        )
        .unwrap();
        let manifest = result.manifest;

        assert_eq!(result.plugin_id, "numeric-calculator-plugin");
        assert!(!result.replaced);
        assert_eq!(
            manifest
                .contributes
                .as_ref()
                .unwrap()
                .actions
                .as_ref()
                .unwrap()[0]
                .id,
            "calculate"
        );
        assert!(app_data_dir
            .join("plugins")
            .join("numeric-calculator-plugin")
            .join("main.js")
            .is_file());

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn invalid_fixture_plugin_is_reported_as_discovery_error() {
        let app_data_dir = unique_test_dir("app");

        copy_fixture_plugin(&app_data_dir, "invalid-manifest-plugin");

        let report = load_plugin_discovery_report(&app_data_dir).unwrap();

        assert!(report.manifests.is_empty());
        assert_eq!(report.errors.len(), 1);
        assert!(report.errors[0]
            .error
            .contains("entrypoints.main must not contain parent directory segments"));

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn trust_status_tracks_fingerprint_and_version() {
        let app_data_dir = unique_test_dir("app");
        let settings_path = app_data_dir.join("settings.json");
        let plugins_dir = app_plugins_dir(&app_data_dir);
        let plugin_id = "trust-plugin";
        let plugin_root = write_full_plugin(&plugins_dir, plugin_id);

        let initial = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();
        assert!(!initial.trusted);
        assert_eq!(
            initial.reason.as_deref(),
            Some("plugin has not been trusted yet")
        );
        assert_error_contains(
            ensure_plugin_trusted(&app_data_dir, &settings_path, plugin_id),
            "plugin is not trusted",
        );

        let trusted = set_plugin_trust(&app_data_dir, &settings_path, plugin_id, true).unwrap();
        assert!(trusted.trusted);
        assert!(trusted.trusted_at.is_some());
        ensure_plugin_trusted(&app_data_dir, &settings_path, plugin_id).unwrap();

        fs::write(
            plugin_root.join("main.js"),
            "export default function activate() { return 'changed'; }",
        )
        .unwrap();

        let changed = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();
        assert!(!changed.trusted);
        assert_eq!(
            changed.reason.as_deref(),
            Some("plugin files changed since it was trusted")
        );
        assert_ne!(changed.manifest_fingerprint, trusted.manifest_fingerprint);

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn trust_status_detects_version_changes() {
        let app_data_dir = unique_test_dir("app");
        let settings_path = app_data_dir.join("settings.json");
        let plugins_dir = app_plugins_dir(&app_data_dir);
        let plugin_id = "version-trust-plugin";
        let plugin_root = write_plugin_manifest(
            &plugins_dir,
            plugin_id,
            &format!(
                r#"{{
  "id": "{plugin_id}",
  "name": "Version Trust Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "entrypoints": {{ "main": "./main.js" }}
}}"#
            ),
        );
        fs::write(
            plugin_root.join("main.js"),
            "export default function activate() {}",
        )
        .unwrap();

        set_plugin_trust(&app_data_dir, &settings_path, plugin_id, true).unwrap();
        fs::write(
            plugin_root.join("manifest.json"),
            format!(
                r#"{{
  "id": "{plugin_id}",
  "name": "Version Trust Plugin",
  "version": "0.2.0",
  "apiVersion": "0.1.0",
  "entrypoints": {{ "main": "./main.js" }}
}}"#
            ),
        )
        .unwrap();

        let changed = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();

        assert!(!changed.trusted);
        assert_eq!(
            changed.reason.as_deref(),
            Some("plugin version changed since it was trusted")
        );
        assert_eq!(changed.trusted_version.as_deref(), Some("0.1.0"));
        assert_eq!(changed.version, "0.2.0");

        fs::remove_dir_all(app_data_dir).ok();
    }

    #[test]
    fn install_replace_overwrites_files_and_revokes_trust() {
        let app_data_dir = unique_test_dir("app");
        let source_parent = unique_test_dir("source");
        let settings_path = app_data_dir.join("settings.json");
        let plugin_id = "replace-plugin";

        write_plugin_source(&source_parent, plugin_id);
        install_plugin_from_path(
            &app_data_dir,
            &settings_path,
            &source_parent.join(plugin_id).display().to_string(),
            false,
        )
        .unwrap();
        set_plugin_trust(&app_data_dir, &settings_path, plugin_id, true).unwrap();

        assert_error_contains(
            install_plugin_from_path(
                &app_data_dir,
                &settings_path,
                &source_parent.join(plugin_id).display().to_string(),
                false,
            ),
            "pass replace=true",
        );

        fs::write(
            source_parent.join(plugin_id).join("main.js"),
            "export default function activate() { return 'replaced'; }",
        )
        .unwrap();

        let result = install_plugin_from_path(
            &app_data_dir,
            &settings_path,
            &source_parent.join(plugin_id).display().to_string(),
            true,
        )
        .unwrap();
        let installed_main =
            fs::read_to_string(app_data_dir.join("plugins").join(plugin_id).join("main.js"))
                .unwrap();
        let trust = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();

        assert!(result.replaced);
        assert!(installed_main.contains("replaced"));
        assert!(!trust.trusted);
        assert_eq!(
            trust.reason.as_deref(),
            Some("plugin has not been trusted yet")
        );

        fs::remove_dir_all(app_data_dir).ok();
        fs::remove_dir_all(source_parent).ok();
    }

    #[test]
    fn uninstall_removes_plugin_and_trust_record() {
        let app_data_dir = unique_test_dir("app");
        let source_parent = unique_test_dir("source");
        let settings_path = app_data_dir.join("settings.json");
        let plugin_id = "sample-uninstall-plugin";

        write_plugin_source(&source_parent, plugin_id);
        install_plugin_from_path(
            &app_data_dir,
            &settings_path,
            &source_parent.join(plugin_id).display().to_string(),
            false,
        )
        .unwrap();

        let mut settings = AppSettings::default();
        settings.plugins.insert(
            plugin_id.to_string(),
            PluginSettings {
                trust: Some(PluginTrustRecord {
                    trusted_at: Some("2026-07-26T00:00:00Z".to_string()),
                    manifest_fingerprint: Some("test".to_string()),
                    version: Some("0.1.0".to_string()),
                }),
                copy_successful_search_results: std::collections::HashMap::from([(
                    "calculate".to_string(),
                    true,
                )]),
                ..Default::default()
            },
        );
        save_settings(&settings_path, &settings).unwrap();

        let result = uninstall_plugin(&app_data_dir, &settings_path, plugin_id).unwrap();

        assert!(result.removed);
        assert!(!app_data_dir.join("plugins").join(plugin_id).exists());
        assert!(!load_settings(&settings_path)
            .plugins
            .contains_key(plugin_id));

        fs::remove_dir_all(app_data_dir).ok();
        fs::remove_dir_all(source_parent).ok();
    }

    #[test]
    fn uninstall_rejects_invalid_plugin_id() {
        let app_data_dir = unique_test_dir("app");
        let settings_path = app_data_dir.join("settings.json");
        let plugins_dir = app_plugins_dir(&app_data_dir);

        write_plugin_source(&plugins_dir, "safe-plugin");

        assert_error_contains(
            uninstall_plugin(&app_data_dir, &settings_path, "../safe-plugin"),
            "invalid plugin id",
        );
        assert!(plugins_dir.join("safe-plugin").is_dir());

        fs::remove_dir_all(app_data_dir).ok();
    }
}
