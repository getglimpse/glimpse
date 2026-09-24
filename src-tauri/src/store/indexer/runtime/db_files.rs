//! Database and Tantivy index paths, replacement, and cleanup.

use super::*;

/// Returns the SQLite database path for a target directory.
///
/// Creates the internal `.glimpse` directory if needed.
pub(super) fn db_path_for_target_dir(target_dir: &Path) -> Result<PathBuf, String> {
    let glimpse_dir = target_dir.join(GLIMPSE_DIR);

    debug!(
        target_dir = %target_dir.display(),
        glimpse_dir = %glimpse_dir.display(),
        "ensuring glimpse database directory"
    );

    std::fs::create_dir_all(&glimpse_dir).map_err(|error| {
        error!(
            glimpse_dir = %glimpse_dir.display(),
            error = %error,
            "failed to create glimpse database directory"
        );
        error.to_string()
    })?;

    Ok(glimpse_dir.join(DB_FILE))
}

pub(super) fn tantivy_index_path_for_db_path(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .map(|path| path.join("tantivy"))
        .unwrap_or_else(|| PathBuf::from("tantivy"))
}

pub(super) fn remove_tantivy_index_dir_for_db_path(db_path: &Path) -> Result<(), String> {
    let index_dir = tantivy_index_path_for_db_path(db_path);

    match fs::remove_dir_all(&index_dir) {
        Ok(()) => {
            debug!(index_dir = %index_dir.display(), "removed Tantivy index directory");
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "failed to remove Tantivy index directory: {}: {error}",
            index_dir.display()
        )),
    }
}

pub(super) fn replace_tantivy_index_dir_for_db_path(
    temp_index_dir: &Path,
    db_path: &Path,
) -> Result<(), String> {
    let index_dir = tantivy_index_path_for_db_path(db_path);

    remove_tantivy_index_dir_for_db_path(db_path)?;

    fs::rename(temp_index_dir, &index_dir).map_err(|error| {
        format!(
            "failed to replace Tantivy index directory: {} -> {}: {error}",
            temp_index_dir.display(),
            index_dir.display()
        )
    })?;

    debug!(
        temp_index_dir = %temp_index_dir.display(),
        index_dir = %index_dir.display(),
        "replaced Tantivy index directory"
    );

    Ok(())
}

pub(super) fn remove_sqlite_database_files(db_path: &Path) -> Result<(), String> {
    for path in sqlite_database_files(db_path) {
        match fs::remove_file(&path) {
            Ok(()) => {
                debug!(path = %path.display(), "removed SQLite index file");
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "failed to remove SQLite index file: {}: {error}",
                    path.display()
                ));
            }
        }
    }

    Ok(())
}

pub(super) fn replace_sqlite_database_files(
    temp_db_path: &Path,
    db_path: &Path,
) -> Result<(), String> {
    remove_sqlite_database_files(db_path)?;

    fs::rename(temp_db_path, db_path).map_err(|error| {
        format!(
            "failed to replace SQLite index file: {} -> {}: {error}",
            temp_db_path.display(),
            db_path.display()
        )
    })?;

    for path in sqlite_database_files(temp_db_path)
        .into_iter()
        .filter(|path| path != temp_db_path)
    {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "failed to remove temporary SQLite sidecar file: {}: {error}",
                    path.display()
                ));
            }
        }
    }

    debug!(
        temp_db_path = %temp_db_path.display(),
        db_path = %db_path.display(),
        "replaced SQLite index file"
    );

    Ok(())
}

pub(super) fn sqlite_database_files(db_path: &Path) -> Vec<PathBuf> {
    let Some(file_name) = db_path.file_name().and_then(|name| name.to_str()) else {
        return vec![db_path.to_path_buf()];
    };

    vec![
        db_path.to_path_buf(),
        db_path.with_file_name(format!("{file_name}-wal")),
        db_path.with_file_name(format!("{file_name}-shm")),
    ]
}

pub(super) fn current_db_path_for_settings(
    settings: &AppSettings,
    fallback_target_dir: PathBuf,
) -> Result<Option<PathBuf>, String> {
    resolve_target_dirs(settings, fallback_target_dir)
        .first()
        .map(|target_dir| db_path_for_target_dir(target_dir))
        .transpose()
}

pub(super) struct TempDirCleanup {
    path: PathBuf,
}

impl TempDirCleanup {
    pub(super) fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl Drop for TempDirCleanup {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                warn!(
                    path = %self.path.display(),
                    error = %error,
                    "failed to remove temporary manual full scan directory"
                );
            }
        }
    }
}
