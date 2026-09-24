//! Read files and preview assets within configured target groups.

use super::*;

/// Reads a UTF-8 text file from a configured Target Group.
///
/// # Security
///
/// The file path must:
///
/// - exist
/// - be a file
/// - belong to a configured Target Group
///
/// Files outside configured target directories are rejected.
///
/// # Returns
///
/// Returns the file contents as UTF-8 text.
pub fn read_text_file(settings_path: &Path, file_path: String) -> Result<String, String> {
    let settings = load_settings(settings_path);
    let path = canonicalize_existing_file(file_path)?;

    ensure_path_is_in_configured_target_group(&path, &settings)?;
    ensure_text_file_size_within_limit(&path)?;

    fs::read_to_string(&path)
        .map_err(|error| format!("failed to read file: {}: {error}", path.display()))
}

pub fn read_text_file_from_path(file_path: String) -> Result<String, String> {
    let path = canonicalize_existing_file(file_path)?;

    ensure_text_file_size_within_limit(&path)?;

    fs::read_to_string(&path)
        .map_err(|error| format!("failed to read file: {}: {error}", path.display()))
}

/// Reads a UTF-8 text file from one configured Target Group.
///
/// # Security
///
/// The Target Group is resolved from settings in the backend. The file path and
/// configured roots are canonicalized before comparison, preventing caller
/// supplied root injection, `..` traversal, and symbolic-link based escapes.
pub fn read_text_file_in_target_group(
    settings_path: &Path,
    file_path: String,
    target_group_id: String,
) -> Result<String, String> {
    let settings = load_settings(settings_path);
    let path = canonicalize_existing_file(file_path)?;
    let group = settings
        .target_groups
        .iter()
        .find(|group| group.id == target_group_id)
        .ok_or_else(|| format!("target group not found: {target_group_id}"))?;

    ensure_path_is_in_roots(&path, &group.paths, "target group directories")?;
    ensure_text_file_size_within_limit(&path)?;

    fs::read_to_string(&path)
        .map_err(|error| format!("failed to read file: {}: {error}", path.display()))
}

/// Reads file metadata from a configured Target Group.
pub fn get_file_metadata(settings_path: &Path, file_path: String) -> Result<FileMetadata, String> {
    let settings = load_settings(settings_path);
    let path = canonicalize_existing_file(file_path)?;

    ensure_path_is_in_configured_target_group(&path, &settings)?;

    file_metadata(&path)
}

/// Reads file metadata from one configured Target Group.
pub fn get_file_metadata_in_target_group(
    settings_path: &Path,
    file_path: String,
    target_group_id: String,
) -> Result<FileMetadata, String> {
    let settings = load_settings(settings_path);
    let path = canonicalize_existing_file(file_path)?;
    let group = settings
        .target_groups
        .iter()
        .find(|group| group.id == target_group_id)
        .ok_or_else(|| format!("target group not found: {target_group_id}"))?;

    ensure_path_is_in_roots(&path, &group.paths, "target group directories")?;

    file_metadata(&path)
}

/// Reads a binary file from a configured Target Group as base64.
///
/// The same target-directory restrictions as [`read_text_file`] apply.
pub fn read_binary_file(settings_path: &Path, file_path: String) -> Result<String, String> {
    let settings = load_settings(settings_path);
    let path = canonicalize_existing_file(file_path)?;

    ensure_path_is_in_configured_target_group(&path, &settings)?;
    ensure_binary_file_size_within_limit(&path)?;

    fs::read(&path)
        .map(|bytes| BASE64_STANDARD.encode(bytes))
        .map_err(|error| format!("failed to read file: {}: {error}", path.display()))
}

/// Reads a binary file from one configured Target Group as base64.
pub fn read_binary_file_in_target_group(
    settings_path: &Path,
    file_path: String,
    target_group_id: String,
) -> Result<String, String> {
    let settings = load_settings(settings_path);
    let path = canonicalize_existing_file(file_path)?;
    let group = settings
        .target_groups
        .iter()
        .find(|group| group.id == target_group_id)
        .ok_or_else(|| format!("target group not found: {target_group_id}"))?;

    ensure_path_is_in_roots(&path, &group.paths, "target group directories")?;
    ensure_binary_file_size_within_limit(&path)?;

    fs::read(&path)
        .map(|bytes| BASE64_STANDARD.encode(bytes))
        .map_err(|error| format!("failed to read file: {}: {error}", path.display()))
}

/// Reads a local preview asset as a data URL.
///
/// # Security
///
/// Markdown and GJSON preview content is treated as untrusted. The referenced
/// asset must be in the same configured Target Group as the source file that is
/// being previewed; callers cannot use Markdown `file://` URLs to reach files
/// from another configured group or outside Glimpse's configured roots.
pub fn read_preview_asset_data_url(
    settings_path: &Path,
    source_path: String,
    asset_path: String,
) -> Result<String, String> {
    let settings = load_settings(settings_path);
    let source_path = canonicalize_existing_file(source_path)?;
    let asset_path = canonicalize_existing_file(asset_path)?;
    let source_groups = settings
        .target_groups
        .iter()
        .filter(|group| path_is_in_roots(&source_path, &group.paths))
        .collect::<Vec<_>>();

    if source_groups.is_empty() {
        return Err(format!(
            "preview source is outside configured target group directories: {}",
            source_path.display()
        ));
    }

    if !source_groups
        .iter()
        .any(|group| path_is_in_roots(&asset_path, &group.paths))
    {
        return Err(format!(
            "preview asset is outside the source target group: {}",
            asset_path.display()
        ));
    }

    let mime_type = preview_asset_mime_type(&asset_path)?;

    ensure_binary_file_size_within_limit(&asset_path)?;

    let encoded = fs::read(&asset_path)
        .map(|bytes| BASE64_STANDARD.encode(bytes))
        .map_err(|error| format!("failed to read file: {}: {error}", asset_path.display()))?;

    Ok(format!("data:{mime_type};base64,{encoded}"))
}

fn preview_asset_mime_type(path: &Path) -> Result<&'static str, String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match extension.as_str() {
        "aac" => Ok("audio/aac"),
        "aif" | "aiff" => Ok("audio/aiff"),
        "avi" => Ok("video/x-msvideo"),
        "bmp" => Ok("image/bmp"),
        "flac" => Ok("audio/flac"),
        "flv" => Ok("video/x-flv"),
        "gif" => Ok("image/gif"),
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "m4a" => Ok("audio/mp4"),
        "m4v" => Ok("video/mp4"),
        "mkv" => Ok("video/x-matroska"),
        "mov" => Ok("video/quicktime"),
        "mp3" => Ok("audio/mpeg"),
        "mp4" => Ok("video/mp4"),
        "mpeg" | "mpg" => Ok("video/mpeg"),
        "ogg" | "opus" => Ok("audio/ogg"),
        "ogv" => Ok("video/ogg"),
        "pdf" => Ok("application/pdf"),
        "png" => Ok("image/png"),
        "wav" => Ok("audio/wav"),
        "weba" => Ok("audio/webm"),
        "webm" => Ok("video/webm"),
        "webp" => Ok("image/webp"),
        "wmv" => Ok("video/x-ms-wmv"),
        _ => Err(format!("unsupported preview asset type: {extension}")),
    }
}

fn ensure_binary_file_size_within_limit(path: &Path) -> Result<(), String> {
    let size = file_metadata(path)?.size_bytes;

    if size > MAX_BINARY_READ_BYTES {
        return Err(format!(
            "binary file is too large to preview: {} bytes exceeds {} bytes",
            size, MAX_BINARY_READ_BYTES
        ));
    }

    Ok(())
}

fn ensure_text_file_size_within_limit(path: &Path) -> Result<(), String> {
    let size = file_metadata(path)?.size_bytes;

    if size > MAX_TEXT_READ_BYTES {
        return Err(format!(
            "text file is too large to preview: {} bytes exceeds {} bytes",
            size, MAX_TEXT_READ_BYTES
        ));
    }

    Ok(())
}

fn file_metadata(path: &Path) -> Result<FileMetadata, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("failed to read file metadata: {}: {error}", path.display()))?;

    Ok(FileMetadata {
        size_bytes: metadata.len(),
    })
}
