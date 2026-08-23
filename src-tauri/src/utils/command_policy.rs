//! Command execution policy checks.
//!
//! This module determines whether a resolved executable is allowed to run
//! according to the user's command settings.
//!
//! Supported policies:
//!
//! - `None`
//!   - Allow all commands.
//!
//! - `Whitelist`
//!   - Only commands listed in `whitelist` are allowed.
//!
//! - `Blacklist`
//!   - Commands listed in `blacklist` are denied.
//!
//! This module only checks command names.
//! Directory restrictions are implemented separately in:
//!
//! - `utils::trusted_directories`
//!
//! Path resolution is implemented in:
//!
//! - `utils::command_lookup`
//!
//! Typical execution flow:
//!
//! ```text
//! metadata command
//!      ↓
//! resolve_command_path()
//!      ↓
//! check_command_policy()
//!      ↓
//! is_trusted_directory()
//!      ↓
//! execute command
//! ```
//!
//! This separation keeps:
//!
//! - path resolution
//! - command policy
//! - trusted directory checks
//! - command execution
//!
//! independent and easier to audit.
//!
//! Security-critical module.
//!
//! Changes to this module affect command execution permissions
//! and should be reviewed carefully.

use std::path::Path;

use crate::models::settings::{CommandPolicyMode, CommandSettings};

/// Checks whether a command is permitted by the current policy.
///
/// Parameters:
///
/// - `original_command`
///   - The command string specified in metadata.
///
/// - `resolved_path`
///   - The executable path resolved by `command_lookup`.
///
/// - `settings`
///   - User command policy settings.
///
/// Returns:
///
/// - `Ok(())` if the command is allowed.
/// - `Err(String)` if the command is blocked.
///
/// The comparison is performed against both:
///
/// - the original command name
/// - the resolved executable filename
///
/// Example:
///
/// ```text
/// metadata:
///     /custom/python3
///
/// resolved:
///     /usr/bin/python3
///
/// whitelist:
///     python3
///
/// → allowed
/// ```
pub fn check_command_policy(
    original_command: &str,
    resolved_path: &Path,
    settings: &CommandSettings,
) -> Result<(), String> {
    match settings.policy_mode {
        CommandPolicyMode::None => Ok(()),

        CommandPolicyMode::Whitelist => {
            if matches_command(original_command, resolved_path, &settings.whitelist) {
                Ok(())
            } else {
                Err(format!("command is not allowed: {original_command}"))
            }
        }

        CommandPolicyMode::Blacklist => {
            if matches_command(original_command, resolved_path, &settings.blacklist) {
                Err(format!("command is blocked: {original_command}"))
            } else {
                Ok(())
            }
        }
    }
}

/// Returns true if the command matches an entry in the provided list.
///
/// Comparison is performed using normalized command names.
///
/// The following are considered equivalent:
///
/// ```text
/// python3
/// /usr/bin/python3
/// C:\Python\python3.exe
/// ```
fn matches_command(original_command: &str, resolved_path: &Path, list: &[String]) -> bool {
    let original = normalize_command_name(original_command);
    let resolved = resolved_path
        .file_name()
        .map(|s| normalize_command_name(&s.to_string_lossy()))
        .unwrap_or_default();

    list.iter().any(|item| {
        let item = normalize_command_name(item);

        item == original || item == resolved
    })
}

/// Normalizes command names before comparison.
///
/// Normalization rules:
///
/// Unix:
///
/// ```text
/// /usr/bin/python3
/// → python3
/// ```
///
/// Windows:
///
/// ```text
/// C:\Python\python.exe
/// → python
///
/// NODE.EXE
/// → node
/// ```
///
/// Comparison is case-insensitive.
fn normalize_command_name(value: &str) -> String {
    let name = Path::new(value)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| value.to_string());

    #[cfg(windows)]
    {
        return name
            .trim()
            .trim_end_matches(".exe")
            .trim_end_matches(".cmd")
            .trim_end_matches(".bat")
            .trim_end_matches(".com")
            .to_lowercase();
    }

    #[cfg(not(windows))]
    {
        name.trim().to_lowercase()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(
        mode: CommandPolicyMode,
        whitelist: Vec<&str>,
        blacklist: Vec<&str>,
    ) -> CommandSettings {
        CommandSettings {
            policy_mode: mode,
            whitelist: whitelist.into_iter().map(String::from).collect(),
            blacklist: blacklist.into_iter().map(String::from).collect(),
            trusted_directories: Vec::new(),
        }
    }

    #[test]
    fn none_mode_allows_any_command() {
        let settings = settings(CommandPolicyMode::None, vec![], vec!["rm"]);

        assert!(check_command_policy("rm", Path::new("/usr/bin/rm"), &settings).is_ok());
    }

    #[test]
    fn blacklist_mode_blocks_matching_command() {
        let settings = settings(CommandPolicyMode::Blacklist, vec![], vec!["rm"]);

        assert!(check_command_policy("rm", Path::new("/usr/bin/rm"), &settings).is_err());
    }

    #[test]
    fn blacklist_mode_allows_non_matching_command() {
        let settings = settings(CommandPolicyMode::Blacklist, vec![], vec!["rm"]);

        assert!(check_command_policy("python3", Path::new("/usr/bin/python3"), &settings).is_ok());
    }

    #[test]
    fn whitelist_mode_allows_matching_command() {
        let settings = settings(CommandPolicyMode::Whitelist, vec!["python3"], vec![]);

        assert!(check_command_policy("python3", Path::new("/usr/bin/python3"), &settings).is_ok());
    }

    #[test]
    fn whitelist_mode_blocks_non_matching_command() {
        let settings = settings(CommandPolicyMode::Whitelist, vec!["python3"], vec![]);

        assert!(check_command_policy("node", Path::new("/usr/bin/node"), &settings).is_err());
    }

    #[test]
    fn matches_by_resolved_file_name() {
        let settings = settings(CommandPolicyMode::Whitelist, vec!["python3"], vec![]);

        assert!(check_command_policy(
            "/custom/path/python3",
            Path::new("/usr/bin/python3"),
            &settings
        )
        .is_ok());
    }
}
