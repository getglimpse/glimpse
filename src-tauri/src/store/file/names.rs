//! Generate safe and unique file names.

use super::*;

/// Converts a title into a safe filename.
///
/// Examples:
///
/// ```text
/// Rust Notes
/// -> Rust Notes.md
///
/// hello/world
/// -> hello_world.md
/// ```
///
/// Empty titles generate a timestamp-based filename.
///
/// Invalid filesystem characters are replaced with `_`.
pub(super) fn file_name_from_title(title: &str, extension: Option<&str>) -> Result<String, String> {
    let title = title.trim();

    let title = if title.is_empty() {
        Local::now().format("%Y-%m-%d %H.#M.%S").to_string()
    } else {
        title.to_string()
    };

    let sanitized = sanitize_file_stem(&title);

    if sanitized.is_empty() {
        return Err("title does not contain usable filename characters".to_string());
    }

    match extension {
        Some(extension) => {
            let extension = sanitize_file_extension(extension)?;
            Ok(format!("{sanitized}.{extension}"))
        }
        None => Ok(sanitized),
    }
}

pub(super) fn supported_create_file_extension(extension: &str) -> Result<String, String> {
    let extension = sanitize_file_extension(extension)?;

    if !matches!(extension.as_str(), "md" | "gjson") {
        return Err(format!("unsupported file extension: {extension}"));
    }

    Ok(extension)
}

pub(super) fn sanitize_file_extension(extension: &str) -> Result<String, String> {
    let extension = extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();

    if extension.is_empty()
        || !extension
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(format!("unsupported file extension: {extension}"));
    }

    Ok(extension)
}

pub(super) fn safe_file_name_from_input(file_name: &str) -> Result<String, String> {
    let name = file_name.trim();

    if name.is_empty() {
        return file_name_from_title("", Some("txt"));
    }

    let normalized = name.replace(['/', '\\'], "_");
    let extension = Path::new(&normalized)
        .extension()
        .and_then(|extension| extension.to_str());
    let stem = Path::new(&normalized)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(&normalized);
    let stem = sanitize_file_stem(stem);

    if stem.is_empty() {
        return Err("file name does not contain usable characters".to_string());
    }

    match extension {
        Some(extension) => Ok(format!("{stem}.{}", sanitize_file_extension(extension)?)),
        None => Ok(stem),
    }
}

/// Sanitizes a filename stem for filesystem safety.
///
/// Replaces:
///
/// - < > : " / \ | ? *
/// - control characters
///
/// with `_`.
///
/// Leading and trailing dots are removed.
pub(super) fn sanitize_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string()
}

/// Generates a unique Markdown file path.
///
/// If the requested filename already exists,
/// incrementing suffixes are added:
///
/// ```text
/// Note.md
/// Note 2.md
/// Note 3.md
/// ```
pub(super) fn unique_file_path(dir: &Path, file_name: &str) -> PathBuf {
    let file_name_path = Path::new(file_name);
    let stem = file_name_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(file_name);
    let extension = file_name_path
        .extension()
        .and_then(|extension| extension.to_str());

    let mut path = dir.join(file_name);

    if !path.exists() && fs::symlink_metadata(&path).is_err() {
        return path;
    }

    for index in 2.. {
        let next_name = match extension {
            Some(extension) => format!("{stem} {index}.{extension}"),
            None => format!("{stem} {index}"),
        };

        path = dir.join(next_name);

        if !path.exists() && fs::symlink_metadata(&path).is_err() {
            return path;
        }
    }

    unreachable!()
}

/// Returns the canonical path when possible.
///
/// Falls back to the original path if canonicalization fails.
///
/// Used for path equality checks during file renaming.
pub(super) fn normalize_path(path: &Path) -> PathBuf {
    path.canonicalize()
        .map(normalize_input_path)
        .unwrap_or_else(|_| normalize_input_path(path))
}
