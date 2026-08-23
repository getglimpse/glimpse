//! Command path sanitization and validation utilities.
//!
//! This module provides the first security layer for metadata commands.
//!
//! Responsibilities:
//!
//! - Sanitize `OpenAction::Command` values.
//! - Reject obviously unsafe command strings.
//! - Resolve command paths to canonical paths.
//! - Validate that the resolved path is an existing file.
//!
//! This module does **NOT**:
//!
//! - search commands in `PATH`
//! - apply whitelist / blacklist policies
//! - execute commands
//!
//! Related modules:
//!
//! - `command_lookup` → executable lookup from PATH
//! - `command_policy` → whitelist / blacklist checks
//! - `trusted_directories` → allowed directory checks
//! - `commands::action` → command execution
//!
//! Typical execution flow:
//!
//! ```text
//! metadata open: command
//!         ↓
//! sanitize_open_action()
//!         ↓
//! resolve_command_path()
//!         ↓
//! validate_command_path()
//!         ↓
//! command_lookup
//!         ↓
//! command_policy
//!         ↓
//! trusted_directories
//!         ↓
//! execute
//! ```
//!
//! Security note:
//!
//! This module rejects a small set of dangerous shell operators:
//!
//! - `;`
//! - `|`
//! - `&`
//!
//! The goal is to prevent accidental shell chaining from metadata.
//!
//! Security-sensitive module.
//!
//! Metadata originating from user files is sanitized here before any
//! further command processing is performed.

use std::path::{Path, PathBuf};

use tracing::{debug, warn};

use crate::models::OpenAction;

/// Characters that are not allowed in command metadata.
///
/// These characters are commonly used by shells for:
///
/// - command chaining
/// - piping
/// - background execution
///
/// Examples:
///
/// ```text
/// notepad.exe & calc.exe
/// rm -rf / ; echo hello
/// cat file | grep foo
/// ```
const DISALLOWED_COMMAND_PATH_CHARS: &[char] = &[';', '|', '&'];

/// Sanitizes metadata open actions.
///
/// Only `OpenAction::Command` is inspected.
///
/// Unsafe commands are removed entirely:
///
/// ```text
/// open:
///   type: command
///   path: "notepad.exe & calc.exe"
///
/// -> None
/// ```
///
/// Safe commands are preserved unchanged.
///
/// Other open action variants are returned as-is.
pub fn sanitize_open_action(open: Option<OpenAction>) -> Option<OpenAction> {
    match open {
        Some(OpenAction::Command { path }) => {
            debug!(path = %path, "sanitizing command open action");

            match validate_command_path_string(&path) {
                Ok(()) => {
                    debug!(path = %path, "command path string accepted");
                    Some(OpenAction::Command { path })
                }
                Err(reason) => {
                    warn!(
                        path = %path,
                        reason = %reason,
                        "rejected unsafe command path"
                    );
                    None
                }
            }
        }

        other => other,
    }
}

/// Validates a command path string.
///
/// Checks:
///
/// - non-empty
/// - does not contain dangerous shell operators
///
/// This function only performs string validation.
/// Filesystem checks are performed separately.
///
/// Returns:
///
/// - `Ok(())` if safe.
/// - `Err(String)` otherwise.
pub fn validate_command_path_string(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("command path is empty".to_string());
    }

    if let Some(ch) = path
        .chars()
        .find(|ch| DISALLOWED_COMMAND_PATH_CHARS.contains(ch))
    {
        return Err(format!("command path contains disallowed character: {ch}"));
    }

    Ok(())
}

/// Resolves a command path into a canonical absolute path.
///
/// Resolution:
///
/// - Absolute paths are used directly.
/// - Relative paths are resolved against the current working directory.
/// - The resulting path is canonicalized.
///
/// Examples:
///
/// ```text
/// ./scripts/run.sh
/// → /home/user/project/scripts/run.sh
///
/// ../tool.exe
/// → /home/user/tool.exe
/// ```
pub fn resolve_command_path(path: &str, base_dir: &Path) -> Result<PathBuf, String> {
    debug!(
        path = %path,
        base_dir = %base_dir.display(),
        "resolving command path"
    );

    validate_command_path_string(path)?;

    let raw = Path::new(path);

    let resolved = if raw.is_absolute() {
        debug!(path = %path, "command path is absolute");
        raw.to_path_buf()
    } else {
        debug!(
            base_dir = %base_dir.display(),
            path = %path,
            "command path is relative; resolving against base directory"
        );

        base_dir.join(raw)
    };

    let canonicalized = resolved
        .canonicalize()
        .map_err(|e| format!("failed to canonicalize path: {e}"))?;

    debug!(
        input = %path,
        resolved = %canonicalized.display(),
        "command path canonicalized"
    );

    Ok(canonicalized)
}

/// Validates the resolved command path.
///
/// Checks:
///
/// - path exists
/// - path is a file
///
/// This function intentionally does not:
///
/// - check execute permissions
/// - check whitelist / blacklist
/// - check trusted directories
///
/// Those checks are delegated to other modules.
pub fn validate_command_path(path: &Path) -> Result<(), String> {
    debug!(path = %path.display(), "validating resolved command path");

    if !path.exists() {
        let message = format!("command path does not exist: {}", path.display());

        warn!(path = %path.display(), "command path validation failed: missing path");

        return Err(message);
    }

    if !path.is_file() {
        let message = format!("command path is not a file: {}", path.display());

        warn!(path = %path.display(), "command path validation failed: not a file");

        return Err(message);
    }

    debug!(path = %path.display(), "command path validation succeeded");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_path(filename: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("glimpse_command_test_{unique}_{filename}"))
    }

    #[test]
    fn resolve_command_path_resolves_absolute_file_path() {
        let path = unique_test_path("absolute.txt");

        fs::write(&path, "").unwrap();

        let base_dir = std::env::temp_dir();
        let resolved = resolve_command_path(path.to_str().unwrap(), &base_dir).unwrap();

        assert_eq!(resolved, path.canonicalize().unwrap());

        fs::remove_file(path).ok();
    }

    #[test]
    fn resolve_command_path_resolves_relative_file_path() {
        let dir = unique_test_path("relative_dir");
        fs::create_dir_all(&dir).unwrap();

        let filename = "relative.txt";
        let path = dir.join(filename);

        fs::write(&path, "").unwrap();

        let resolved = resolve_command_path(filename, &dir).unwrap();

        assert_eq!(resolved, path.canonicalize().unwrap());

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn resolve_command_path_rejects_empty_path() {
        let base_dir = std::env::temp_dir();

        let result = resolve_command_path("", &base_dir);

        assert!(result.is_err());
    }

    #[test]
    fn resolve_command_path_rejects_missing_path() {
        let path = unique_test_path("missing.exe");

        let base_dir = std::env::temp_dir();
        let result = resolve_command_path(path.to_str().unwrap(), &base_dir);

        assert!(result.is_err());
    }

    #[test]
    fn validate_command_path_accepts_existing_file() {
        let path = unique_test_path("valid.exe");

        fs::write(&path, "").unwrap();

        let resolved = path.canonicalize().unwrap();

        let result = validate_command_path(&resolved);

        assert!(result.is_ok());

        fs::remove_file(path).ok();
    }

    #[test]
    fn validate_command_path_rejects_directory() {
        let path = unique_test_path("directory");

        fs::create_dir_all(&path).unwrap();

        let resolved = path.canonicalize().unwrap();

        let result = validate_command_path(&resolved);

        assert!(result.is_err());

        fs::remove_dir_all(path).ok();
    }

    #[test]
    fn sanitize_open_action_removes_unsafe_command_path() {
        let open = Some(OpenAction::Command {
            path: r"C:\Windows\System32\notepad.exe & calc.exe".to_string(),
        });

        assert!(sanitize_open_action(open).is_none());
    }

    #[test]
    fn sanitize_open_action_keeps_safe_command_path() {
        let open = Some(OpenAction::Command {
            path: r"C:\Windows\System32\notepad.exe".to_string(),
        });

        assert_eq!(
            sanitize_open_action(open),
            Some(OpenAction::Command {
                path: r"C:\Windows\System32\notepad.exe".to_string(),
            })
        );
    }

    #[test]
    fn sanitize_open_action_keeps_external_action() {
        let open = Some(OpenAction::External {
            url: "https://example.com".to_string(),
        });

        assert_eq!(
            sanitize_open_action(open),
            Some(OpenAction::External {
                url: "https://example.com".to_string(),
            })
        );
    }
}
