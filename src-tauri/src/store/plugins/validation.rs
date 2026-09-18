use std::path::Path;

use super::SUPPORTED_PLUGIN_API_VERSION;

pub(super) fn is_valid_locale_code(locale: &str) -> bool {
    !locale.is_empty()
        && locale
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

pub(super) fn validate_non_empty(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} is required"));
    }

    Ok(())
}

pub(super) fn validate_optional_manifest_url(
    label: &str,
    value: Option<&str>,
) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };

    let value = value.trim();

    if value.is_empty() {
        return Err(format!("{label} must not be empty"));
    }

    if !(value.starts_with("https://") || value.starts_with("http://")) {
        return Err(format!("{label} must be an http or https URL"));
    }

    Ok(())
}

pub(super) fn is_valid_file_extension(extension: &str) -> bool {
    let normalized = extension.trim_start_matches('.');

    !normalized.is_empty()
        && normalized
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

pub(super) fn validate_version(label: &str, value: &str) -> Result<(), String> {
    parse_version_triplet(value)
        .map(|_| ())
        .map_err(|error| format!("{label} {error}"))
}

pub(super) fn validate_supported_api_version(api_version: &str) -> Result<(), String> {
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

pub(super) fn validate_relative_child_path(label: &str, value: &str) -> Result<(), String> {
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

pub(super) fn is_valid_plugin_id(plugin_id: &str) -> bool {
    let mut characters = plugin_id.chars();

    matches!(characters.next(), Some(character) if character.is_ascii_lowercase() || character.is_ascii_digit())
        && characters.all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '-' | '_' | '.')
        })
}

pub(super) fn is_valid_contribution_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':')
        })
}
