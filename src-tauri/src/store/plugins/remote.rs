use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::time::Duration;

use reqwest::{redirect::Policy, Client};
use sha2::{Digest, Sha256};
use url::Url;

use super::{OFFICIAL_PLUGIN_REGISTRY_URL, PLUGIN_ARCHIVE_EXTENSION, PLUGIN_ARCHIVE_MAX_BYTES};

const PLUGIN_ARCHIVE_DOWNLOAD_TIMEOUT_SECS: u64 = 30;
const PLUGIN_ARCHIVE_DOWNLOAD_REDIRECT_LIMIT: usize = 5;

pub(super) async fn download_plugin_archive(
    download_url: &Url,
    expected_sha256: &str,
    archive_path: &Path,
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(PLUGIN_ARCHIVE_DOWNLOAD_TIMEOUT_SECS))
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= PLUGIN_ARCHIVE_DOWNLOAD_REDIRECT_LIMIT {
                return attempt.error("plugin archive download redirected too many times");
            }

            if attempt.url().scheme() != "https" {
                return attempt.error("plugin archive redirect target must use https");
            }

            attempt.follow()
        }))
        .build()
        .map_err(|error| format!("failed to create plugin download client: {error}"))?;
    let mut response = client
        .get(download_url.clone())
        .send()
        .await
        .map_err(|error| format!("failed to download plugin archive: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "plugin archive download failed with HTTP status {}",
            response.status()
        ));
    }

    if response.url().scheme() != "https" {
        return Err(format!(
            "plugin archive redirect target must use https: {}",
            response.url()
        ));
    }

    if let Some(content_length) = response.content_length() {
        if content_length > PLUGIN_ARCHIVE_MAX_BYTES {
            return Err(format!(
                "plugin archive download is too large: {content_length} bytes; limit is {PLUGIN_ARCHIVE_MAX_BYTES} bytes"
            ));
        }
    }

    let mut file = File::create(archive_path).map_err(|error| {
        format!(
            "failed to create plugin archive download file: {}: {error}",
            archive_path.display()
        )
    })?;
    let mut hasher = Sha256::new();
    let mut downloaded_bytes = 0_u64;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("failed while reading plugin archive download: {error}"))?
    {
        downloaded_bytes = downloaded_bytes
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| "plugin archive download size overflowed".to_string())?;

        if downloaded_bytes > PLUGIN_ARCHIVE_MAX_BYTES {
            return Err(format!(
                "plugin archive download is too large: {downloaded_bytes} bytes; limit is {PLUGIN_ARCHIVE_MAX_BYTES} bytes"
            ));
        }

        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|error| {
            format!(
                "failed to write plugin archive download: {}: {error}",
                archive_path.display()
            )
        })?;
    }

    file.flush().map_err(|error| {
        format!(
            "failed to flush plugin archive download: {}: {error}",
            archive_path.display()
        )
    })?;

    let actual_sha256 = format!("{:x}", hasher.finalize());

    verify_sha256_digest(&actual_sha256, expected_sha256)?;

    Ok(actual_sha256)
}

pub(super) fn validate_plugin_archive_download_url(download_url: &str) -> Result<Url, String> {
    let download_url = download_url.trim();

    if download_url.is_empty() {
        return Err("plugin archive download URL is required".to_string());
    }

    let parsed = Url::parse(download_url)
        .map_err(|error| format!("plugin archive download URL is invalid: {error}"))?;

    if parsed.scheme() != "https" {
        return Err("plugin archive download URL must use https".to_string());
    }

    if !parsed.path().ends_with(PLUGIN_ARCHIVE_EXTENSION) {
        return Err(format!(
            "plugin archive download URL must end with {PLUGIN_ARCHIVE_EXTENSION}"
        ));
    }

    Ok(parsed)
}

pub(super) fn validate_plugin_registry_url(value: &str) -> Result<String, String> {
    let value = value.trim();

    if value.is_empty() {
        return Err("plugin registry URL is empty".to_string());
    }

    let url =
        Url::parse(value).map_err(|error| format!("plugin registry URL is invalid: {error}"))?;

    if url.scheme() != "https" {
        return Err("plugin registry URL must use https".to_string());
    }

    let normalized = url.to_string();

    if normalized != OFFICIAL_PLUGIN_REGISTRY_URL {
        return Err("plugin registry URL must be the official Glimpse plugin registry".to_string());
    }

    Ok(normalized)
}

pub(super) fn validate_sha256_digest(value: &str) -> Result<String, String> {
    let value = value.trim();

    if value.len() != 64 || !value.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("plugin archive sha256 must be a 64 character hex digest".to_string());
    }

    Ok(value.to_ascii_lowercase())
}

pub(super) fn verify_sha256_digest(
    actual_sha256: &str,
    expected_sha256: &str,
) -> Result<(), String> {
    if actual_sha256 != expected_sha256 {
        return Err(format!(
            "plugin archive checksum mismatch: expected {expected_sha256}, got {actual_sha256}"
        ));
    }

    Ok(())
}
