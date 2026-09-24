//! Move index data when a target group's primary path changes.

use super::*;

/// Returns the primary target directory for each target group.
///
/// For each target group, only the first non-empty path is used.
/// If no target groups exist, the fallback directory is returned.
pub(super) fn global_primary_target_dirs(
    settings: &AppSettings,
    fallback: PathBuf,
) -> Vec<PathBuf> {
    if settings.target_groups.is_empty() {
        return vec![fallback];
    }

    settings
        .target_groups
        .iter()
        .filter_map(|group| {
            group
                .paths
                .iter()
                .map(|path| path.trim())
                .find(|path| !path.is_empty())
                .map(PathBuf::from)
        })
        .collect()
}

pub(super) fn migrate_primary_glimpse_dirs(
    previous_settings: &AppSettings,
    settings: &AppSettings,
) -> Result<(), String> {
    let previous_dirs = primary_target_dirs_by_group(previous_settings);
    let next_dirs = primary_target_dirs_by_group(settings);
    let retained_dirs = next_dirs.values().cloned().collect::<HashSet<_>>();

    for (group_id, old_target_dir) in previous_dirs {
        let Some(new_target_dir) = next_dirs.get(&group_id) else {
            continue;
        };

        if old_target_dir == *new_target_dir {
            continue;
        }

        if retained_dirs.contains(&old_target_dir) {
            debug!(
                group_id = %group_id,
                old_target_dir = %old_target_dir.display(),
                "old primary target dir is still used; keeping glimpse directory"
            );
            continue;
        }

        move_or_remove_glimpse_dir(&old_target_dir, new_target_dir)?;
    }

    Ok(())
}

fn primary_target_dirs_by_group(settings: &AppSettings) -> HashMap<String, PathBuf> {
    settings
        .target_groups
        .iter()
        .filter_map(|group| {
            group
                .paths
                .iter()
                .map(|path| path.trim())
                .find(|path| !path.is_empty())
                .map(|path| (group.id.clone(), canonical_or_original(PathBuf::from(path))))
        })
        .collect()
}

fn move_or_remove_glimpse_dir(old_target_dir: &Path, new_target_dir: &Path) -> Result<(), String> {
    let old_glimpse_dir = old_target_dir.join(GLIMPSE_DIR);

    if !old_glimpse_dir.exists() {
        return Ok(());
    }

    if !old_glimpse_dir.is_dir() {
        return Err(format!(
            "glimpse path is not a directory: {}",
            old_glimpse_dir.display()
        ));
    }

    let new_glimpse_dir = new_target_dir.join(GLIMPSE_DIR);

    if new_glimpse_dir.exists() {
        fs::remove_dir_all(&old_glimpse_dir).map_err(|error| {
            format!(
                "failed to remove stale glimpse directory: {}: {error}",
                old_glimpse_dir.display()
            )
        })?;

        info!(
            old_glimpse_dir = %old_glimpse_dir.display(),
            new_glimpse_dir = %new_glimpse_dir.display(),
            "removed stale glimpse directory because destination already exists"
        );

        return Ok(());
    }

    if let Some(parent) = new_glimpse_dir.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create new target directory: {}: {error}",
                parent.display()
            )
        })?;
    }

    match fs::rename(&old_glimpse_dir, &new_glimpse_dir) {
        Ok(()) => {
            info!(
                old_glimpse_dir = %old_glimpse_dir.display(),
                new_glimpse_dir = %new_glimpse_dir.display(),
                "moved glimpse directory"
            );
        }
        Err(rename_error) => {
            warn!(
                old_glimpse_dir = %old_glimpse_dir.display(),
                new_glimpse_dir = %new_glimpse_dir.display(),
                error = %rename_error,
                "failed to rename glimpse directory; falling back to copy"
            );

            copy_dir_all(&old_glimpse_dir, &new_glimpse_dir).map_err(|error| {
                format!(
                    "failed to copy glimpse directory: {} -> {}: {error}",
                    old_glimpse_dir.display(),
                    new_glimpse_dir.display()
                )
            })?;

            fs::remove_dir_all(&old_glimpse_dir).map_err(|error| {
                format!(
                    "failed to remove copied glimpse directory: {}: {error}",
                    old_glimpse_dir.display()
                )
            })?;

            info!(
                old_glimpse_dir = %old_glimpse_dir.display(),
                new_glimpse_dir = %new_glimpse_dir.display(),
                "copied glimpse directory and removed old directory"
            );
        }
    }

    Ok(())
}

fn copy_dir_all(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::create_dir_all(destination)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        if source_path.is_dir() {
            copy_dir_all(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)?;
        }
    }

    Ok(())
}
