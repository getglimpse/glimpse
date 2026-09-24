//! Plugin manifest loading, normalization, and validation.

use std::fs;
use std::path::Path;

use crate::models::plugins::{
    PluginContributions, PluginInternalPageManifest, PluginManifest, PluginPageActionManifest,
    RawPluginManifest,
};

use super::validation::{
    is_valid_contribution_id, is_valid_file_extension, is_valid_locale_code, is_valid_plugin_id,
    validate_non_empty, validate_optional_manifest_url, validate_relative_child_path,
    validate_supported_api_version, validate_version,
};
use super::{resolve_plugin_child_file, DEFAULT_PLUGIN_API_VERSION};

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

    validate_optional_manifest_url("repositoryUrl", raw.repository_url.as_deref())?;
    validate_optional_manifest_url("homepageUrl", raw.homepage_url.as_deref())?;
    validate_optional_manifest_url("supportUrl", raw.support_url.as_deref())?;

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
        author: raw.author,
        release_date: raw.release_date,
        repository_url: raw.repository_url,
        homepage_url: raw.homepage_url,
        support_url: raw.support_url,
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

pub(super) fn validate_page_definition(
    page: &serde_json::Value,
    plugin_id: &str,
) -> Result<(), String> {
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

        if tab_type == "converter" {
            if let Some(execution) = tab_object.get("execution") {
                let execution = execution.as_str().ok_or_else(|| {
                    format!("page converter tab {tab_id} execution must be a string")
                })?;

                if execution != "manual" {
                    return Err(format!(
                        "page converter tab {tab_id} has unsupported execution: {execution}"
                    ));
                }
            }

            if let Some(output_modes) = tab_object.get("outputModes") {
                let output_modes = output_modes.as_array().ok_or_else(|| {
                    format!("page converter tab {tab_id} outputModes must be an array")
                })?;
                let mut seen_output_modes = std::collections::HashSet::new();

                for output_mode in output_modes {
                    let output_mode = output_mode.as_str().ok_or_else(|| {
                        format!("page converter tab {tab_id} outputModes entries must be strings")
                    })?;

                    if !matches!(output_mode, "create" | "overwrite") {
                        return Err(format!(
                            "page converter tab {tab_id} has unsupported output mode: {output_mode}"
                        ));
                    }

                    if !seen_output_modes.insert(output_mode) {
                        return Err(format!(
                            "page converter tab {tab_id} has duplicate output mode: {output_mode}"
                        ));
                    }
                }

                if !seen_output_modes.contains("create") {
                    return Err(format!(
                        "page converter tab {tab_id} outputModes must include create"
                    ));
                }
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
