//! Trusted directory validation for command execution.
//!
//! This module provides the final filesystem boundary check before a command
//! is executed.
//!
//! A command is allowed only if:
//!
//! - The executable path is resolved successfully.
//! - The command passes whitelist / blacklist policies.
//! - The executable resides inside one of the configured trusted directories.
//!
//! Execution flow:
//!
//! ```text
//! metadata command
//!        ↓
//! command_open
//!        ↓
//! command_lookup
//!        ↓
//! command_policy
//!        ↓
//! trusted_directories
//!        ↓
//! execute
//! ```
//!
//! This module intentionally fails closed.
//!
//! If:
//!
//! - no trusted directories are configured
//! - all configured directories are invalid
//! - the command is outside the trusted directories
//!
//! then command execution is rejected.
//!
//! Security note:
//!
//! This module compares canonicalized absolute paths to prevent bypasses
//! through:
//!
//! - symbolic links
//! - relative paths (`../`)
//! - duplicated separators
//!
//! Security-sensitive module.
//!
//! Changes to this module directly affect command execution security
//! and should be reviewed carefully.

use std::path::{Path, PathBuf};

/// Checks whether a resolved executable is located inside a trusted directory.
///
/// Parameters:
///
/// - `resolved_path`
///     Canonical executable path.
///
/// - `trusted_directories`
///     User configured list of allowed directories.
///
/// Returns:
///
/// - `Ok(())` if the command is trusted.
/// - `Err(String)` otherwise.
///
/// Example:
///
/// ```text
/// trusted:
///   /usr/local/bin
///
/// command:
///   /usr/local/bin/mytool
///
/// -> allowed
/// ```
///
/// ```text
/// trusted:
///   /usr/local/bin
///
/// command:
///   /tmp/malicious.sh
///
/// -> rejected
/// ```
pub fn check_trusted_directory(
    resolved_path: &Path,
    trusted_directories: &[String],
) -> Result<(), String> {
    if trusted_directories.is_empty() {
        return Err("no trusted directories configured".to_string());
    }

    let resolved_path = resolved_path
        .canonicalize()
        .map_err(|e| format!("failed to canonicalize command path: {e}"))?;

    let trusted_paths = trusted_directories
        .iter()
        .filter_map(|path| canonicalize_trusted_directory(path).ok())
        .collect::<Vec<_>>();

    if trusted_paths.is_empty() {
        return Err("no valid trusted directories configured".to_string());
    }

    if trusted_paths
        .iter()
        .any(|trusted_dir| resolved_path.starts_with(trusted_dir))
    {
        return Ok(());
    }

    Err(format!(
        "command is outside trusted directories: {}",
        resolved_path.display()
    ))
}

/// Canonicalizes and validates a trusted directory.
///
/// Validation rules:
///
/// - path must not be empty
/// - path must exist
/// - path must be a directory
/// - path is canonicalized before use
///
/// Canonicalization prevents issues caused by:
///
/// ```text
/// ../
/// symlinks
/// duplicated separators
/// ```
fn canonicalize_trusted_directory(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path.trim());

    if path.as_os_str().is_empty() {
        return Err("trusted directory is empty".to_string());
    }

    let resolved = path
        .canonicalize()
        .map_err(|e| format!("failed to canonicalize trusted directory: {e}"))?;

    if !resolved.is_dir() {
        return Err(format!(
            "trusted directory is not a directory: {}",
            resolved.display()
        ));
    }

    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("glimpse_trusted_dir_test_{unique}_{name}"))
    }

    #[test]
    fn blocks_when_no_trusted_directories_are_configured() {
        let dir = unique_test_dir("command");
        let command = dir.join("tool.exe");

        fs::create_dir_all(&dir).unwrap();
        fs::write(&command, "").unwrap();

        let result = check_trusted_directory(&command, &[]);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "no trusted directories configured");

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn allows_command_inside_trusted_directory() {
        let dir = unique_test_dir("trusted");
        let command = dir.join("tool.exe");

        fs::create_dir_all(&dir).unwrap();
        fs::write(&command, "").unwrap();

        let result = check_trusted_directory(&command, &[dir.to_string_lossy().to_string()]);

        assert!(result.is_ok());

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn blocks_command_outside_trusted_directory() {
        let trusted = unique_test_dir("trusted");
        let other = unique_test_dir("other");
        let command = other.join("tool.exe");

        fs::create_dir_all(&trusted).unwrap();
        fs::create_dir_all(&other).unwrap();
        fs::write(&command, "").unwrap();

        let result = check_trusted_directory(&command, &[trusted.to_string_lossy().to_string()]);

        assert!(result.is_err());

        fs::remove_dir_all(trusted).ok();
        fs::remove_dir_all(other).ok();
    }
}
