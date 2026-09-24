//! Shared filesystem path resolution for target group access checks.
//!
//! Callers choose the authorized roots and whether to permit a new path.

use std::path::{Path, PathBuf};

/// Strip Windows verbatim prefixes before comparing or returning paths.
pub(crate) fn normalize_input_path(path: impl AsRef<Path>) -> PathBuf {
    let value = path.as_ref().to_string_lossy();

    #[cfg(windows)]
    {
        let normalized = value
            .strip_prefix(r"\\?\")
            .or_else(|| value.strip_prefix("//?/"))
            .unwrap_or(&value);

        PathBuf::from(normalized)
    }

    #[cfg(not(windows))]
    {
        PathBuf::from(value.to_string())
    }
}

pub(crate) fn canonicalize_existing_file(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = normalize_input_path(path);

    if !path.exists() {
        return Err(format!("file does not exist: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!("path is not a file: {}", path.display()));
    }

    path.canonicalize()
        .map(normalize_input_path)
        .map_err(|error| format!("failed to canonicalize file: {}: {error}", path.display()))
}

pub(crate) fn canonicalize_existing_dir(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = normalize_input_path(path);

    if !path.exists() {
        return Err(format!("directory does not exist: {}", path.display()));
    }

    if !path.is_dir() {
        return Err(format!("path is not a directory: {}", path.display()));
    }

    path.canonicalize()
        .map(normalize_input_path)
        .map_err(|error| {
            format!(
                "failed to canonicalize directory: {}: {error}",
                path.display()
            )
        })
}

/// `path` must already be canonicalized; configured roots are canonicalized here.
pub(crate) fn path_is_in_roots(path: &Path, roots: &[String]) -> bool {
    for root in roots {
        let Ok(root) = canonicalize_existing_dir(root) else {
            continue;
        };

        if path_starts_with(path, &root) {
            return true;
        }
    }

    false
}

/// Compare normalized path components; callers resolve symlinks when needed.
pub(crate) fn path_starts_with(path: &Path, root: &Path) -> bool {
    normalize_comparison_path(path).starts_with(normalize_comparison_path(root))
}

pub(crate) fn nearest_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = path.parent()?.to_path_buf();

    loop {
        if current.exists() {
            return Some(current);
        }

        if !current.pop() {
            return None;
        }
    }
}

fn normalize_comparison_path(path: &Path) -> PathBuf {
    let path = normalize_input_path(path);

    #[cfg(windows)]
    {
        PathBuf::from(path.to_string_lossy().to_lowercase())
    }

    #[cfg(not(windows))]
    {
        path
    }
}
