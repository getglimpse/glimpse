//! Create, update, and atomically replace text files.

use super::*;

/// Creates a new Markdown file in the current Target Group.
///
/// The file is created in the primary directory of the current
/// Target Group.
///
/// # File naming
///
/// The filename is generated from `title`.
///
/// Example:
///
/// ```text
/// Rust Notes
/// ↓
/// Rust Notes.md
/// ```
///
/// If the file already exists:
///
/// ```text
/// Rust Notes.md
/// Rust Notes 2.md
/// Rust Notes 3.md
/// ```
///
/// is used automatically.
///
/// Empty titles generate a timestamp-based filename.
///
/// # Returns
///
/// Returns the created file path.
pub fn create_text_file_in_current_target(
    settings_path: &Path,
    title: String,
    body: String,
    extension: String,
) -> Result<String, String> {
    let settings = load_settings(settings_path);
    let target_dir = current_target_primary_dir(&settings)?;

    let extension = supported_create_file_extension(&extension)?;
    let file_name = file_name_from_title(&title, Some(&extension))?;
    let file_path = unique_file_path(&target_dir, &file_name);

    fs::write(&file_path, body)
        .map_err(|error| format!("failed to write file: {}: {error}", file_path.display()))?;

    Ok(file_path.to_string_lossy().to_string())
}

pub fn create_text_file_at_path(
    settings_path: &Path,
    file_path: String,
    body: String,
) -> Result<String, String> {
    let settings = load_settings(settings_path);
    let file_path = normalize_input_path(file_path);

    if path_contains_parent_component(&file_path) {
        return Err(format!(
            "target file path must not contain parent traversal: {}",
            file_path.display()
        ));
    }

    if file_path.exists() {
        return Err(format!("file already exists: {}", file_path.display()));
    }

    let extension = file_path
        .extension()
        .and_then(|extension| extension.to_str())
        .ok_or_else(|| "target file path must include an extension".to_string())?;

    supported_create_file_extension(extension)?;
    ensure_new_file_path_is_in_configured_target_group(&file_path, &settings)?;

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create parent directory: {}: {error}",
                parent.display()
            )
        })?;
    }

    fs::write(&file_path, body)
        .map_err(|error| format!("failed to write file: {}: {error}", file_path.display()))?;

    Ok(file_path.to_string_lossy().to_string())
}

pub fn create_markdown_file_in_current_target(
    settings_path: &Path,
    title: String,
    body: String,
) -> Result<String, String> {
    create_text_file_in_current_target(settings_path, title, body, "md".to_string())
}

pub fn default_download_directory() -> Result<String, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "home directory is not available".to_string())?;
    let downloads = PathBuf::from(home).join("Downloads");

    if downloads.is_dir() {
        return Ok(downloads.to_string_lossy().to_string());
    }

    Err(format!(
        "default download directory does not exist: {}",
        downloads.display()
    ))
}

pub fn write_text_file_in_granted_directory(
    directory: &Dir,
    directory_path: &Path,
    file_name: String,
    body: String,
) -> Result<String, String> {
    if body.len() > MAX_PLUGIN_TEXT_OUTPUT_BYTES {
        return Err(format!(
            "plugin output is too large: {} bytes exceeds {} bytes",
            body.len(),
            MAX_PLUGIN_TEXT_OUTPUT_BYTES
        ));
    }

    let file_name = safe_file_name_from_input(&file_name)?;
    let file_name_path = Path::new(&file_name);
    let stem = file_name_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(&file_name);
    let extension = file_name_path
        .extension()
        .and_then(|extension| extension.to_str());
    let mut options = CapabilityOpenOptions::new();
    options.write(true).create_new(true);
    // The directory handle is the authority; a swapped path cannot redirect
    // this create into an unselected directory.
    for index in 1..=1000 {
        let candidate = if index == 1 {
            file_name.clone()
        } else {
            match extension {
                Some(extension) => format!("{stem} {index}.{extension}"),
                None => format!("{stem} {index}"),
            }
        };
        match directory.open_with(&candidate, &options) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(body.as_bytes()) {
                    drop(file);
                    let _ = directory.remove_file(&candidate);
                    return Err(format!("failed to write file: {candidate}: {error}"));
                }
                let file_path = directory_path.join(candidate);
                return Ok(file_path.to_string_lossy().to_string());
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("failed to create file: {candidate}: {error}")),
        }
    }
    Err("could not allocate a unique plugin output filename".into())
}

pub fn overwrite_text_file_from_path(file_path: String, body: String) -> Result<String, String> {
    if body.len() > MAX_PLUGIN_TEXT_OUTPUT_BYTES {
        return Err(format!(
            "plugin output is too large: {} bytes exceeds {} bytes",
            body.len(),
            MAX_PLUGIN_TEXT_OUTPUT_BYTES
        ));
    }

    let path = canonicalize_existing_file(file_path)?;

    fs::write(&path, body)
        .map_err(|error| format!("failed to overwrite file: {}: {error}", path.display()))?;

    Ok(path.to_string_lossy().to_string())
}

/// Updates only the title / filename of an existing Markdown file.
///
/// This function does not update file contents.
pub fn update_text_file_title(
    settings_path: &Path,
    file_path: String,
    title: String,
) -> Result<String, String> {
    let settings = load_settings(settings_path);

    let current_path = canonicalize_existing_file(file_path)?;
    ensure_path_is_in_configured_target_group(&current_path, &settings)?;

    let parent = current_path
        .parent()
        .ok_or_else(|| "file has no parent directory".to_string())?;
    let extension = current_path.extension().and_then(|ext| ext.to_str());

    let file_name = file_name_from_title(&title, extension)?;
    let desired_path = parent.join(file_name);

    if normalize_path(&desired_path) == normalize_path(&current_path) {
        return Ok(current_path.to_string_lossy().to_string());
    }

    if desired_path.exists() {
        return Err(format!("file already exists: {}", desired_path.display()));
    }

    fs::rename(&current_path, &desired_path).map_err(|error| {
        format!(
            "failed to rename file: {} -> {}: {error}",
            current_path.display(),
            desired_path.display()
        )
    })?;

    Ok(desired_path.to_string_lossy().to_string())
}

pub fn update_markdown_file_title(
    settings_path: &Path,
    file_path: String,
    title: String,
) -> Result<String, String> {
    update_text_file_title(settings_path, file_path, title)
}

/// Updates only the body of an existing Markdown file.
///
/// This function never renames the file.
pub fn update_text_file_body(
    settings_path: &Path,
    file_path: String,
    body: String,
) -> Result<(), String> {
    let settings = load_settings(settings_path);

    let path = canonicalize_existing_file(file_path)?;
    ensure_path_is_in_configured_target_group(&path, &settings)?;

    fs::write(&path, body)
        .map_err(|error| format!("failed to write file: {}: {error}", path.display()))?;

    Ok(())
}

/// Saves a text document's title and body together. The replacement is fully
/// written before the original path is changed. If a replacement step fails,
/// the original file is restored where possible.
pub fn save_text_file(
    settings_path: &Path,
    file_path: String,
    title: String,
    body: String,
) -> Result<String, String> {
    save_text_file_with_hook(settings_path, file_path, title, body, |_| Ok(()))
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum SaveStage {
    AfterTemporaryWrite,
    BeforeOriginalRemove,
    BeforeReplacement,
}

pub(super) fn save_text_file_with_hook<F>(
    settings_path: &Path,
    file_path: String,
    title: String,
    body: String,
    hook: F,
) -> Result<String, String>
where
    F: Fn(SaveStage) -> Result<(), String>,
{
    if body.len() as u64 > MAX_TEXT_READ_BYTES {
        return Err("text file is too large to save".into());
    }
    let settings = load_settings(settings_path);
    let current_path = canonicalize_existing_file(file_path)?;
    ensure_path_is_in_configured_target_group(&current_path, &settings)?;
    let permissions = fs::metadata(&current_path)
        .map_err(|error| format!("failed to read file permissions: {error}"))?
        .permissions();
    if permissions.readonly() {
        return Err(format!("file is read-only: {}", current_path.display()));
    }
    let parent = current_path
        .parent()
        .ok_or_else(|| "file has no parent directory".to_string())?;
    let extension = current_path.extension().and_then(|ext| ext.to_str());
    let desired_path = parent.join(file_name_from_title(&title, extension)?);
    let renaming = normalize_path(&desired_path) != normalize_path(&current_path);
    if renaming && desired_path.exists() {
        return Err(format!("file already exists: {}", desired_path.display()));
    }

    let temporary_path = parent.join(format!(".glimpse-save-{}", uuid::Uuid::new_v4()));
    let write_result = (|| -> Result<(), String> {
        let mut temporary = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|error| format!("failed to create save file: {error}"))?;
        temporary
            .write_all(body.as_bytes())
            .and_then(|_| temporary.sync_all())
            .map_err(|error| format!("failed to write save file: {error}"))?;
        fs::set_permissions(&temporary_path, permissions)
            .map_err(|error| format!("failed to preserve file permissions: {error}"))
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }
    if let Err(error) = hook(SaveStage::AfterTemporaryWrite) {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    if renaming {
        if let Err(error) = fs::hard_link(&temporary_path, &desired_path) {
            let _ = fs::remove_file(&temporary_path);
            return Err(format!("failed to create renamed file: {error}"));
        }
        let remove_result = hook(SaveStage::BeforeOriginalRemove).and_then(|_| {
            fs::remove_file(&current_path)
                .map_err(|error| format!("failed to remove original file: {error}"))
        });
        if let Err(error) = remove_result {
            let _ = fs::remove_file(&desired_path);
            let _ = fs::remove_file(&temporary_path);
            return Err(error);
        }
        let _ = fs::remove_file(&temporary_path);
    } else {
        let backup_path = parent.join(format!(".glimpse-backup-{}", uuid::Uuid::new_v4()));
        if let Err(error) = hook(SaveStage::BeforeReplacement) {
            let _ = fs::remove_file(&temporary_path);
            return Err(error);
        }
        if let Err(error) = replace_file_with_backup(&current_path, &temporary_path, &backup_path) {
            let rollback = if !current_path.exists() && backup_path.exists() {
                fs::rename(&backup_path, &current_path)
            } else {
                Ok(())
            };
            let _ = fs::remove_file(&temporary_path);
            return Err(format!(
                "failed to replace file: {error}; rollback: {rollback:?}; backup: {}",
                backup_path.display()
            ));
        }
        let _ = fs::remove_file(&backup_path);
    }

    Ok(if renaming { desired_path } else { current_path }
        .to_string_lossy()
        .to_string())
}

#[cfg(windows)]
fn replace_file_with_backup(
    current_path: &Path,
    temporary_path: &Path,
    backup_path: &Path,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{ReplaceFileW, REPLACE_FILE_FLAGS};

    let wide = |path: &Path| {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>()
    };
    let current = wide(current_path);
    let temporary = wide(temporary_path);
    let backup = wide(backup_path);
    unsafe {
        ReplaceFileW(
            PCWSTR(current.as_ptr()),
            PCWSTR(temporary.as_ptr()),
            PCWSTR(backup.as_ptr()),
            REPLACE_FILE_FLAGS(0),
            None,
            None,
        )
    }
    .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
fn replace_file_with_backup(
    current_path: &Path,
    temporary_path: &Path,
    backup_path: &Path,
) -> Result<(), String> {
    fs::hard_link(current_path, backup_path)
        .map_err(|error| format!("failed to back up original file: {error}"))?;
    fs::rename(temporary_path, current_path).map_err(|error| error.to_string())
}

pub fn update_markdown_file_body(
    settings_path: &Path,
    file_path: String,
    body: String,
) -> Result<(), String> {
    update_text_file_body(settings_path, file_path, body)
}
