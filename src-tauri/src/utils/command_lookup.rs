//! Command executable lookup utilities.
//!
//! This module resolves executable paths used by `type: command` metadata.
//!
//! Supported forms:
//!
//! ```text
//! cargo
//! git
//! /usr/bin/git
//! ./scripts/build.sh
//! C:\Tools\mytool.exe
//! ```
//!
//! Resolution order:
//!
//! 1. Explicit paths (`/foo/bar`, `./tool`, `C:\tool.exe`)
//! 2. Search through the system `PATH`
//!
//! Only executable files are accepted.
//! Directories and non-executable files are ignored.
//!
//! This module performs path resolution only.
//! Command permission checks are delegated to:
//!
//! - `utils::command_policy`
//! - `utils::trusted_directories`
//!
//! This module does not execute commands.
//!
//! Actual command execution is implemented in:
//!
//! - `utils::command`
//! - `commands::action`

use std::env;
use std::path::{Path, PathBuf};

/// Resolves an executable path from a command string.
///
/// Examples:
///
/// ```text
/// git
/// cargo
/// ./script.sh
/// /usr/bin/python3
/// ```
///
/// Resolution strategy:
///
/// - Empty strings return `None`.
/// - Explicit paths are checked directly.
/// - Otherwise the command is searched in `PATH`.
///
/// Returns:
///
/// - `Some(PathBuf)` if an executable exists.
/// - `None` if resolution fails.
pub fn resolve_command_path(command: &str) -> Option<PathBuf> {
    let command = command.trim();

    if command.is_empty() {
        return None;
    }

    let path = Path::new(command);

    if is_explicit_path(command, path) {
        return resolve_explicit_path(path);
    }

    lookup_in_path(command)
}

/// Returns true if the command string should be treated
/// as an explicit filesystem path.
///
/// This includes:
///
/// - absolute paths
/// - relative paths with separators
/// - Windows paths
///
/// Examples:
///
/// ```text
/// /usr/bin/git
/// ./tool
/// ../tool
/// C:\Tools\app.exe
/// ```
fn is_explicit_path(command: &str, path: &Path) -> bool {
    path.is_absolute()
        || command.contains(std::path::MAIN_SEPARATOR)
        || command.contains('/')
        || command.contains('\\')
}

/// Resolves an explicitly specified path.
///
/// Returns the path only if:
///
/// - the file exists
/// - the file is executable
fn resolve_explicit_path(path: &Path) -> Option<PathBuf> {
    is_executable_file(path).then(|| path.to_path_buf())
}

/// Searches the system PATH for an executable.
///
/// Iterates over each directory in `PATH`,
/// generates platform-specific candidate names,
/// and returns the first executable found.
fn lookup_in_path(command: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;

    env::split_paths(&path_var)
        .flat_map(|dir| candidates_for_command(&dir, command))
        .find(|candidate| is_executable_file(candidate))
}

#[cfg(unix)]
/// Returns true if the path is an executable file.
///
/// Unix executability is determined by checking:
///
/// - file exists
/// - is a regular file
/// - any execute bit is set (`0o111`)
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    let Ok(metadata) = path.metadata() else {
        return false;
    };

    metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
}

#[cfg(windows)]
/// Returns true if the path points to a file.
///
/// Windows executability is determined during candidate
/// generation using `PATHEXT`.
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(windows)]
/// Generates executable filename candidates on Windows.
///
/// If the command already contains an extension:
///
/// ```text
/// git.exe -> git.exe
/// ```
///
/// Otherwise extensions are taken from:
///
/// - PATHEXT
/// - built-in fallbacks:
///   - .EXE
///   - .BAT
///   - .CMD
///   - .COM
fn candidates_for_command(dir: &Path, command: &str) -> Vec<PathBuf> {
    let path = Path::new(command);

    if path.extension().is_some() {
        return vec![dir.join(command)];
    }

    let mut extensions = env::var_os("PATHEXT")
        .map(|v| {
            v.to_string_lossy()
                .split(';')
                .filter_map(|s| {
                    let ext = s.trim();

                    if ext.is_empty() {
                        None
                    } else if ext.starts_with('.') {
                        Some(ext.to_string())
                    } else {
                        Some(format!(".{ext}"))
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    for fallback in [
        ".EXE", ".BAT", ".CMD", ".COM", ".exe", ".bat", ".cmd", ".com",
    ] {
        if !extensions.iter().any(|ext| ext == fallback) {
            extensions.push(fallback.to_string());
        }
    }

    extensions
        .into_iter()
        .map(|ext| dir.join(format!("{command}{ext}")))
        .collect()
}

/// Generates a single candidate on Unix-like systems.
///
/// Example:
///
/// ```text
/// /usr/bin + git
/// -> /usr/bin/git
/// ```
#[cfg(not(windows))]
fn candidates_for_command(dir: &Path, command: &str) -> Vec<PathBuf> {
    vec![dir.join(command)]
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("glimpse_command_lookup_test_{unique}"))
    }

    #[test]
    fn empty_command_returns_none() {
        assert!(resolve_command_path("").is_none());
        assert!(resolve_command_path("   ").is_none());
    }

    #[test]
    fn missing_command_returns_none() {
        assert!(resolve_command_path("__glimpse_missing_command__").is_none());
    }

    #[test]
    fn resolves_existing_absolute_path() {
        let exe = std::env::current_exe().unwrap();

        assert_eq!(resolve_command_path(&exe.to_string_lossy()), Some(exe));
    }

    #[test]
    fn missing_absolute_path_returns_none() {
        assert!(resolve_command_path("/definitely/missing/glimpse-command").is_none());
    }

    #[test]
    fn resolves_existing_relative_path_with_separator() {
        let dir = unique_test_dir();

        fs::create_dir_all(&dir).unwrap();

        let file = dir.join("tool");

        fs::write(&file, "#!/bin/sh\necho hello\n").unwrap();

        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&file).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&file, permissions).unwrap();
        }

        let current = std::env::current_dir().unwrap();

        std::env::set_current_dir(&dir).unwrap();

        let resolved = resolve_command_path("./tool");

        std::env::set_current_dir(current).unwrap();

        assert_eq!(resolved, Some(PathBuf::from("./tool")));

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn missing_relative_path_returns_none() {
        assert!(resolve_command_path("./missing-tool").is_none());
    }

    #[test]
    fn resolves_command_from_path() {
        let dir = unique_test_dir();

        fs::create_dir_all(&dir).unwrap();

        #[cfg(windows)]
        let file = dir.join("glimpse-test-tool.EXE");

        #[cfg(not(windows))]
        let file = dir.join("glimpse-test-tool");

        fs::write(&file, "#!/bin/sh\necho hello\n").unwrap();

        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&file).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&file, permissions).unwrap();
        }

        let old_path = std::env::var_os("PATH");

        std::env::set_var("PATH", dir.to_string_lossy().to_string());

        let resolved = resolve_command_path("glimpse-test-tool");

        if let Some(old_path) = old_path {
            std::env::set_var("PATH", old_path);
        } else {
            std::env::remove_var("PATH");
        }

        assert_eq!(resolved, Some(file));

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn path_lookup_ignores_non_files() {
        let dir = unique_test_dir();

        fs::create_dir_all(dir.join("glimpse-test-dir")).unwrap();

        let old_path = std::env::var_os("PATH");

        std::env::set_var("PATH", dir.to_string_lossy().to_string());

        let resolved = resolve_command_path("glimpse-test-dir");

        if let Some(old_path) = old_path {
            std::env::set_var("PATH", old_path);
        } else {
            std::env::remove_var("PATH");
        }

        assert!(resolved.is_none());

        fs::remove_dir_all(dir).ok();
    }
}
