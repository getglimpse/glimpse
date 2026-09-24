//! Resolve and constrain paths to configured target groups.

use super::*;

/// Returns the current Target Group.
///
/// Fails when:
///
/// - no current group is selected
/// - the selected group no longer exists
pub(super) fn current_target_group(settings: &AppSettings) -> Result<&TargetGroup, String> {
    let current_id = settings
        .current_target_group_id
        .as_ref()
        .ok_or_else(|| "current target group is not set".to_string())?;

    settings
        .target_groups
        .iter()
        .find(|group| &group.id == current_id)
        .ok_or_else(|| format!("current target group not found: {current_id}"))
}

/// Returns the primary directory of the current Target Group.
///
/// The first non-empty path is used.
///
/// The directory must exist and is canonicalized before being returned.
pub(super) fn current_target_primary_dir(settings: &AppSettings) -> Result<PathBuf, String> {
    let group = current_target_group(settings)?;

    let path = group
        .paths
        .iter()
        .map(|path| path.trim())
        .find(|path| !path.is_empty())
        .ok_or_else(|| "current target group has no target directory".to_string())?;

    canonicalize_existing_dir(path)
}

/// Ensures that a path belongs to a configured Target Group.
///
/// Every file read/write operation must pass this check.
///
/// The comparison is performed using canonicalized absolute paths,
/// preventing path traversal and symbolic-link based escapes.
///
/// # Errors
///
/// Returns an error if the path is outside all configured target
/// directories.
pub(super) fn ensure_path_is_in_configured_target_group(
    path: &Path,
    settings: &AppSettings,
) -> Result<(), String> {
    for group in &settings.target_groups {
        for root in &group.paths {
            let Ok(root) = canonicalize_existing_dir(root) else {
                continue;
            };

            if path_starts_with(path, &root) {
                return Ok(());
            }
        }
    }

    Err(format!(
        "path is outside configured target group directories: {}",
        path.display()
    ))
}

pub(super) fn ensure_new_file_path_is_in_configured_target_group(
    path: &Path,
    settings: &AppSettings,
) -> Result<(), String> {
    let Some(ancestor) = nearest_existing_ancestor(path) else {
        return Err(format!(
            "path is outside configured target group directories: {}",
            path.display()
        ));
    };

    let relative_path = path
        .strip_prefix(&ancestor)
        .map_err(|error| format!("failed to resolve target file path: {error}"))?;
    let ancestor = canonicalize_existing_dir(ancestor)?;
    // The requested file may not exist yet. Resolve its existing ancestor first
    // so aliases such as /var -> /private/var and Windows short names cannot
    // make an authorized path appear to be outside a canonicalized root.
    let resolved_path = ancestor.join(relative_path);

    for group in &settings.target_groups {
        for root in &group.paths {
            let Ok(root) = canonicalize_existing_dir(root) else {
                continue;
            };

            if path_starts_with(&ancestor, &root) && path_starts_with(&resolved_path, &root) {
                return Ok(());
            }
        }
    }

    Err(format!(
        "path is outside configured target group directories: {}",
        path.display()
    ))
}

pub(super) fn ensure_path_is_in_roots(
    path: &Path,
    roots: &[String],
    label: &str,
) -> Result<(), String> {
    if path_is_in_roots(path, roots) {
        return Ok(());
    }

    Err(format!("path is outside {label}: {}", path.display()))
}

pub(super) fn path_contains_parent_component(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
}
