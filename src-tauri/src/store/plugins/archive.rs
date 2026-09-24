//! Plugin archive extraction and package validation.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

use walkdir::WalkDir;
use zip::ZipArchive;

use crate::models::plugins::PluginManifest;

use super::validation::is_valid_plugin_id;
use super::{
    load_plugin_manifest, PLUGIN_ARCHIVE_MAX_COMPRESSION_RATIO, PLUGIN_ARCHIVE_MAX_DEPTH,
    PLUGIN_ARCHIVE_MAX_ENTRIES, PLUGIN_ARCHIVE_MAX_FILE_BYTES, PLUGIN_ARCHIVE_MAX_PATH_CHARS,
    PLUGIN_ARCHIVE_MAX_UNCOMPRESSED_BYTES, SUPPORTED_PLUGIN_API_VERSION,
};

pub(super) fn extract_plugin_archive(
    archive_path: &Path,
    unpacked_root: &Path,
) -> Result<PathBuf, String> {
    fs::create_dir_all(unpacked_root).map_err(|error| {
        format!(
            "failed to create plugin archive unpack directory: {}: {error}",
            unpacked_root.display()
        )
    })?;

    let archive_file = File::open(archive_path).map_err(|error| {
        format!(
            "failed to open plugin archive: {}: {error}",
            archive_path.display()
        )
    })?;
    let mut archive = ZipArchive::new(archive_file)
        .map_err(|error| format!("failed to read plugin archive: {error}"))?;
    let prefix = validate_plugin_archive_entries(&mut archive)?;
    let mut written_paths = HashSet::new();
    let canonical_unpacked_root = unpacked_root.canonicalize().map_err(|error| {
        format!(
            "failed to resolve plugin archive unpack directory: {}: {error}",
            unpacked_root.display()
        )
    })?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("failed to read plugin archive entry {index}: {error}"))?;

        if entry.is_dir() {
            continue;
        }

        let entry_path = sanitized_zip_entry_path(&entry)?;
        let relative_path = strip_archive_prefix(&entry_path, prefix.as_deref())?;

        if relative_path.as_os_str().is_empty() {
            continue;
        }

        let output_path = unpacked_root.join(&relative_path);

        if !written_paths.insert(relative_path.clone()) {
            return Err(format!(
                "plugin archive contains duplicate file path: {}",
                path_to_archive_string(&relative_path)
            ));
        }

        let output_parent = output_path.parent().ok_or_else(|| {
            format!(
                "plugin archive entry has no parent directory: {}",
                output_path.display()
            )
        })?;

        fs::create_dir_all(output_parent).map_err(|error| {
            format!(
                "failed to create plugin archive output directory: {}: {error}",
                output_parent.display()
            )
        })?;

        let canonical_output_parent = output_parent.canonicalize().map_err(|error| {
            format!(
                "failed to resolve plugin archive output directory: {}: {error}",
                output_parent.display()
            )
        })?;

        if !canonical_output_parent.starts_with(&canonical_unpacked_root) {
            return Err(format!(
                "plugin archive output path escapes temp directory: {}",
                output_path.display()
            ));
        }

        let mut output_file = File::create(&output_path).map_err(|error| {
            format!(
                "failed to create extracted plugin file: {}: {error}",
                output_path.display()
            )
        })?;

        io::copy(&mut entry, &mut output_file).map_err(|error| {
            format!(
                "failed to extract plugin archive entry: {}: {error}",
                entry.name()
            )
        })?;

        let canonical_output_path = output_path.canonicalize().map_err(|error| {
            format!(
                "failed to resolve extracted plugin file: {}: {error}",
                output_path.display()
            )
        })?;

        if !canonical_output_path.starts_with(&canonical_unpacked_root) {
            return Err(format!(
                "extracted plugin file escapes temp directory: {}",
                output_path.display()
            ));
        }
    }

    Ok(unpacked_root.to_path_buf())
}

fn validate_plugin_archive_entries<R: Read + io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<Option<PathBuf>, String> {
    if archive.is_empty() {
        return Err("plugin archive is empty".to_string());
    }

    if archive.len() > PLUGIN_ARCHIVE_MAX_ENTRIES {
        return Err(format!(
            "plugin archive has too many entries: {}; limit is {PLUGIN_ARCHIVE_MAX_ENTRIES}",
            archive.len()
        ));
    }

    let mut total_uncompressed_size = 0_u64;
    let mut paths = Vec::new();
    let mut file_paths = Vec::new();
    let mut case_insensitive_paths = HashSet::new();

    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("failed to read plugin archive entry {index}: {error}"))?;
        let path = sanitized_zip_entry_path(&entry)?;

        validate_zip_entry_metadata(&entry, &path)?;
        paths.push(path.clone());

        if entry.is_dir() {
            continue;
        }

        let normalized_path = path_to_archive_string(&path).to_ascii_lowercase();

        if !case_insensitive_paths.insert(normalized_path) {
            return Err(format!(
                "plugin archive contains duplicate file path: {}",
                path_to_archive_string(&path)
            ));
        }

        total_uncompressed_size = total_uncompressed_size
            .checked_add(entry.size())
            .ok_or_else(|| "plugin archive uncompressed size overflowed".to_string())?;

        if total_uncompressed_size > PLUGIN_ARCHIVE_MAX_UNCOMPRESSED_BYTES {
            return Err(format!(
                "plugin archive uncompressed size is too large: {total_uncompressed_size} bytes; limit is {PLUGIN_ARCHIVE_MAX_UNCOMPRESSED_BYTES} bytes"
            ));
        }

        file_paths.push(path);
    }

    resolve_archive_root_prefix(&paths, &file_paths)
}

fn validate_zip_entry_metadata(entry: &zip::read::ZipFile<'_>, path: &Path) -> Result<(), String> {
    let path_label = path_to_archive_string(path);

    if entry.name().contains('\\') {
        return Err(format!(
            "plugin archive entry must use forward slashes: {}",
            entry.name()
        ));
    }

    if entry.name().contains('\0') {
        return Err("plugin archive entry contains a null byte".to_string());
    }

    if is_zip_entry_symlink(entry) {
        return Err(format!(
            "plugin archive symlinks are not allowed: {path_label}"
        ));
    }

    if path_label.chars().count() > PLUGIN_ARCHIVE_MAX_PATH_CHARS {
        return Err(format!(
            "plugin archive path is too long: {path_label}; limit is {PLUGIN_ARCHIVE_MAX_PATH_CHARS} characters"
        ));
    }

    let depth = path
        .components()
        .filter(|component| matches!(component, Component::Normal(_)))
        .count();

    if depth > PLUGIN_ARCHIVE_MAX_DEPTH {
        return Err(format!(
            "plugin archive path is too deep: {path_label}; limit is {PLUGIN_ARCHIVE_MAX_DEPTH}"
        ));
    }

    if !entry.is_dir() && entry.size() > PLUGIN_ARCHIVE_MAX_FILE_BYTES {
        return Err(format!(
            "plugin archive file is too large: {path_label}; {} bytes; limit is {PLUGIN_ARCHIVE_MAX_FILE_BYTES} bytes",
            entry.size()
        ));
    }

    let compressed_size = entry.compressed_size();

    if !entry.is_dir() && entry.size() > 0 && compressed_size == 0 {
        return Err(format!(
            "plugin archive entry has an invalid compression ratio: {path_label}"
        ));
    }

    if compressed_size > 0 && entry.size() / compressed_size > PLUGIN_ARCHIVE_MAX_COMPRESSION_RATIO
    {
        return Err(format!(
            "plugin archive entry compression ratio is too high: {path_label}; limit is {PLUGIN_ARCHIVE_MAX_COMPRESSION_RATIO}:1"
        ));
    }

    Ok(())
}

fn sanitized_zip_entry_path(entry: &zip::read::ZipFile<'_>) -> Result<PathBuf, String> {
    let Some(path) = entry.enclosed_name() else {
        return Err(format!(
            "plugin archive entry escapes archive root: {}",
            entry.name()
        ));
    };

    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!(
            "plugin archive entry contains unsupported path components: {}",
            entry.name()
        ));
    }

    Ok(path)
}

fn resolve_archive_root_prefix(
    paths: &[PathBuf],
    file_paths: &[PathBuf],
) -> Result<Option<PathBuf>, String> {
    let manifest_paths: Vec<&PathBuf> = file_paths
        .iter()
        .filter(|path| path.file_name().and_then(|name| name.to_str()) == Some("manifest.json"))
        .collect();

    if manifest_paths.is_empty() {
        return Err("plugin archive does not contain manifest.json".to_string());
    }

    if manifest_paths.len() > 1 {
        return Err("plugin archive contains multiple manifest.json files".to_string());
    }

    let manifest_path = manifest_paths[0];
    let components: Vec<_> = manifest_path.components().collect();
    let prefix = match components.as_slice() {
        [Component::Normal(file)] if file.to_string_lossy() == "manifest.json" => None,
        [Component::Normal(parent), Component::Normal(file)]
            if file.to_string_lossy() == "manifest.json" =>
        {
            Some(PathBuf::from(parent))
        }
        _ => {
            return Err(
                "plugin archive manifest.json must be at the archive root or one top-level directory"
                    .to_string(),
            );
        }
    };

    if let Some(prefix) = prefix.as_ref() {
        for path in paths {
            if !path.starts_with(prefix) {
                return Err(format!(
                    "plugin archive with a top-level plugin directory must not contain sibling entries: {}",
                    path_to_archive_string(path)
                ));
            }
        }
    }

    Ok(prefix)
}

fn strip_archive_prefix(path: &Path, prefix: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(prefix) = prefix {
        return path
            .strip_prefix(prefix)
            .map(Path::to_path_buf)
            .map_err(|_| {
                format!(
                    "plugin archive entry is outside top-level directory: {}",
                    path_to_archive_string(path)
                )
            });
    }

    Ok(path.to_path_buf())
}

pub(super) fn read_archive_manifest_plugin_id(plugin_root: &Path) -> Result<String, String> {
    let manifest_path = plugin_root.join("manifest.json");
    let content = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "failed to read plugin archive manifest: {}: {error}",
            manifest_path.display()
        )
    })?;
    let value = serde_json::from_str::<serde_json::Value>(&content).map_err(|error| {
        format!(
            "failed to parse plugin archive manifest: {}: {error}",
            manifest_path.display()
        )
    })?;
    let plugin_id = value
        .get("id")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "plugin archive manifest id is required".to_string())?;

    if !is_valid_plugin_id(plugin_id) {
        return Err(format!("invalid plugin id: {plugin_id}"));
    }

    Ok(plugin_id.to_string())
}

pub(super) fn validate_archive_plugin_package(plugin_root: &Path) -> Result<(), String> {
    let manifest_path = plugin_root.join("manifest.json");
    let manifest = load_plugin_manifest(&manifest_path)?;

    validate_archive_manifest_contract(&manifest)?;

    for entry in WalkDir::new(plugin_root).follow_links(false) {
        let entry = entry.map_err(|error| {
            format!(
                "failed to inspect extracted plugin archive: {}: {error}",
                plugin_root.display()
            )
        })?;

        if entry.path() == plugin_root {
            continue;
        }

        if entry.file_type().is_symlink() {
            return Err(format!(
                "plugin archive symlinks are not allowed: {}",
                entry.path().display()
            ));
        }

        if entry.file_type().is_dir() {
            continue;
        }

        if !entry.file_type().is_file() {
            return Err(format!(
                "plugin archive entry is not a regular file: {}",
                entry.path().display()
            ));
        }

        validate_archive_plugin_file(plugin_root, entry.path(), &manifest)?;
    }

    Ok(())
}

fn validate_archive_manifest_contract(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.api_version.as_deref() != Some(SUPPORTED_PLUGIN_API_VERSION) {
        return Err(format!(
            "plugin archive apiVersion must be {SUPPORTED_PLUGIN_API_VERSION}"
        ));
    }

    if manifest.page.as_deref() != Some("./page.json") {
        return Err("plugin archive manifest.page must be ./page.json".to_string());
    }

    if manifest
        .entrypoints
        .as_ref()
        .and_then(|entrypoints| entrypoints.main.as_deref())
        != Some("./main.js")
    {
        return Err("plugin archive entrypoints.main must be ./main.js".to_string());
    }

    Ok(())
}

fn validate_archive_plugin_file(
    plugin_root: &Path,
    file_path: &Path,
    manifest: &PluginManifest,
) -> Result<(), String> {
    let relative_path = file_path.strip_prefix(plugin_root).map_err(|_| {
        format!(
            "plugin archive file escapes plugin root: {}",
            file_path.display()
        )
    })?;
    let archive_path = path_to_archive_string(relative_path);
    let extension = file_path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if !is_allowed_archive_plugin_file(&archive_path, manifest) {
        return Err(format!(
            "plugin archive contains unsupported file: {archive_path}"
        ));
    }

    if is_javascript_like_extension(&extension) && archive_path != "main.js" {
        return Err(format!(
            "plugin archive contains undeclared JavaScript or TypeScript file: {archive_path}"
        ));
    }

    if is_executable_extension(&extension) {
        return Err(format!(
            "plugin archive contains executable file: {archive_path}"
        ));
    }

    let bytes = fs::read(file_path).map_err(|error| {
        format!(
            "failed to read extracted plugin archive file: {}: {error}",
            file_path.display()
        )
    })?;

    if let Some(signature) = executable_signature(&bytes) {
        return Err(format!(
            "plugin archive contains executable content: {archive_path} ({signature})"
        ));
    }

    validate_archive_asset_signature(&archive_path, &extension, &bytes)?;
    validate_archive_text_file(&archive_path, &extension, &bytes)?;

    Ok(())
}

fn is_allowed_archive_plugin_file(archive_path: &str, manifest: &PluginManifest) -> bool {
    if matches!(
        archive_path,
        "manifest.json" | "main.js" | "page.json" | "i18n.json" | "styles.css"
    ) {
        return true;
    }

    if matches!(archive_path, "README.md" | "CHANGELOG.md" | "LICENSE") {
        return true;
    }

    if archive_path.starts_with("assets/") {
        return true;
    }

    if let Some(i18n_path) = manifest.i18n_path.as_deref() {
        return normalize_archive_manifest_path(i18n_path) == archive_path;
    }

    false
}

fn validate_archive_asset_signature(
    archive_path: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<(), String> {
    if !archive_path.starts_with("assets/") {
        return Ok(());
    }

    if !matches!(
        extension,
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "txt" | "json"
    ) {
        return Err(format!(
            "plugin archive asset extension is not allowed: {archive_path}"
        ));
    }

    match extension {
        "png" if !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) => Err(
            format!("plugin archive PNG asset has an invalid signature: {archive_path}"),
        ),
        "jpg" | "jpeg"
            if !(bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff) =>
        {
            Err(format!(
                "plugin archive JPEG asset has an invalid signature: {archive_path}"
            ))
        }
        "webp" if !(bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP") => {
            Err(format!(
                "plugin archive WebP asset has an invalid signature: {archive_path}"
            ))
        }
        "gif" if !(bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) => Err(format!(
            "plugin archive GIF asset has an invalid signature: {archive_path}"
        )),
        _ => Ok(()),
    }
}

fn validate_archive_text_file(
    archive_path: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let is_text = matches!(extension, "js" | "json" | "css" | "md" | "txt")
        || matches!(archive_path, "LICENSE");

    if !is_text {
        return Ok(());
    }

    let text = std::str::from_utf8(bytes)
        .map_err(|_| format!("plugin archive text file must be valid UTF-8: {archive_path}"))?;

    if extension == "json" {
        serde_json::from_str::<serde_json::Value>(text).map_err(|error| {
            format!("plugin archive JSON file is invalid: {archive_path}: {error}")
        })?;
    }

    Ok(())
}

fn normalize_archive_manifest_path(path: &str) -> String {
    path.replace('\\', "/").trim_start_matches("./").to_string()
}

pub(super) fn path_to_archive_string(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn is_javascript_like_extension(extension: &str) -> bool {
    matches!(extension, "js" | "mjs" | "cjs" | "ts" | "tsx")
}

fn is_executable_extension(extension: &str) -> bool {
    matches!(
        extension,
        "dll" | "exe" | "bat" | "cmd" | "ps1" | "sh" | "so" | "dylib"
    )
}

fn executable_signature(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 4 {
        if bytes.starts_with(&[0x7f, b'E', b'L', b'F']) {
            return Some("ELF executable signature");
        }

        if matches!(
            &bytes[0..4],
            [0xfe, 0xed, 0xfa, 0xce]
                | [0xfe, 0xed, 0xfa, 0xcf]
                | [0xce, 0xfa, 0xed, 0xfe]
                | [0xcf, 0xfa, 0xed, 0xfe]
                | [0xca, 0xfe, 0xba, 0xbe]
        ) {
            return Some("Mach-O executable signature");
        }
    }

    if bytes.starts_with(b"MZ") {
        return Some("PE executable signature");
    }

    if bytes.starts_with(b"#!") {
        return Some("script shebang");
    }

    None
}

fn is_zip_entry_symlink(entry: &zip::read::ZipFile<'_>) -> bool {
    entry
        .unix_mode()
        .is_some_and(|mode| mode & 0o170000 == 0o120000)
}
