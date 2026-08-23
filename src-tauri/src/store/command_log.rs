//! Command execution log storage.
//!
//! This module persists command execution history using the JSON Lines
//! (`.jsonl`) format.
//!
//! The log is primarily used for:
//!
//! - Debugging command execution.
//! - Displaying execution history in the Debug page.
//! - Troubleshooting failures.
//! - Future audit and telemetry features.
//!
//! # Storage layout
//!
//! ```text
//! <app_data_dir>
//! └── logs
//!     └── command-executions.jsonl
//! ```
//!
//! Each line is a serialized [`CommandExecutionLog`] object.
//!
//! Example:
//!
//! ```json
//! {"timestamp":"2026-06-20T12:00:00Z","command":"cargo build","success":true}
//! ```
//!
//! # Design
//!
//! JSON Lines was chosen because it provides:
//!
//! - append-only writes
//! - human-readable logs
//! - low memory usage
//! - simple recovery from malformed entries
//!
//! Corrupted lines are ignored when reading.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use crate::models::command_log::CommandExecutionLog;

const COMMAND_LOG_DIR: &str = "logs";
const COMMAND_LOG_FILE: &str = "command-executions.jsonl";

/// Appends a command execution record to the log file.
///
/// The log file is created automatically if it does not exist.
///
/// # Storage location
///
/// ```text
/// <app_data_dir>/logs/command-executions.jsonl
/// ```
///
/// The app data directory is resolved from the parent directory of
/// `settings_path`.
///
/// # Format
///
/// Each entry is stored as one JSON object per line:
///
/// ```text
/// {"command":"cargo build", ...}
/// {"command":"pnpm test", ...}
/// ```
///
/// This function performs append-only writes and does not rewrite
/// previous entries.
///
/// # Errors
///
/// Returns an error when:
///
/// - the settings path has no parent directory
/// - the log directory cannot be created
/// - the log file cannot be opened
/// - serialization fails
/// - writing fails
pub fn append_command_execution_log(
    settings_path: &Path,
    entry: &CommandExecutionLog,
) -> Result<(), String> {
    let app_data_dir = settings_path
        .parent()
        .ok_or_else(|| "settings path has no parent directory".to_string())?;

    let log_dir = app_data_dir.join(COMMAND_LOG_DIR);

    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    let log_file = log_dir.join(COMMAND_LOG_FILE);

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)
        .map_err(|e| e.to_string())?;

    let line = serde_json::to_string(entry).map_err(|e| e.to_string())?;

    writeln!(file, "{line}").map_err(|e| e.to_string())
}

/// Reads recent command execution logs.
///
/// Logs are returned in reverse chronological order
/// (most recent entries first).
///
/// # Parameters
///
/// - `settings_path`
///   Used to locate the application log directory.
///
/// - `limit`
///   Maximum number of entries to return.
///
/// # Behavior
///
/// - Missing log files return an empty vector.
/// - Invalid JSON lines are skipped.
/// - Corrupted entries do not abort reading.
///
/// # Example
///
/// Given:
///
/// ```text
/// line1 -> oldest
/// line2
/// line3 -> newest
/// ```
///
/// Returned order:
///
/// ```text
/// line3
/// line2
/// line1
/// ```
pub fn read_command_execution_logs(
    settings_path: &Path,
    limit: usize,
) -> Result<Vec<CommandExecutionLog>, String> {
    let app_data_dir = settings_path
        .parent()
        .ok_or_else(|| "settings path has no parent directory".to_string())?;

    let log_file = app_data_dir.join(COMMAND_LOG_DIR).join(COMMAND_LOG_FILE);

    if !log_file.exists() {
        return Ok(Vec::new());
    }

    let file = fs::File::open(log_file).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    let mut logs = reader
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<CommandExecutionLog>(&line).ok())
        .collect::<Vec<_>>();

    logs.reverse();
    logs.truncate(limit);

    Ok(logs)
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::Utc;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::models::command_log::{
        CommandExecutionLog, CommandExecutionStage, CommandExecutionStatus,
    };

    fn unique_test_settings_path() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir()
            .join(format!("glimpse_command_log_test_{unique}"))
            .join("settings.json")
    }

    fn log_entry() -> CommandExecutionLog {
        CommandExecutionLog {
            timestamp: Utc::now(),
            item_id: "item-1".to_string(),
            command: "cargo".to_string(),
            resolved_path: Some("/usr/bin/cargo".to_string()),
            args: vec!["test".to_string()],
            status: CommandExecutionStatus::Success,
            stage: CommandExecutionStage::Spawn,
            error: None,
        }
    }

    #[test]
    fn appends_command_execution_log_as_jsonl() {
        let settings_path = unique_test_settings_path();

        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        append_command_execution_log(&settings_path, &log_entry()).unwrap();

        let log_path = settings_path
            .parent()
            .unwrap()
            .join(COMMAND_LOG_DIR)
            .join(COMMAND_LOG_FILE);

        let content = fs::read_to_string(&log_path).unwrap();

        assert!(content.contains("\"itemId\":\"item-1\""));
        assert!(content.contains("\"command\":\"cargo\""));
        assert!(content.contains("\"status\":\"success\""));
        assert!(content.contains("\"stage\":\"spawn\""));

        fs::remove_dir_all(settings_path.parent().unwrap()).ok();
    }

    #[test]
    fn appends_multiple_logs() {
        let settings_path = unique_test_settings_path();

        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        append_command_execution_log(&settings_path, &log_entry()).unwrap();
        append_command_execution_log(&settings_path, &log_entry()).unwrap();

        let log_path = settings_path
            .parent()
            .unwrap()
            .join(COMMAND_LOG_DIR)
            .join(COMMAND_LOG_FILE);

        let content = fs::read_to_string(&log_path).unwrap();

        assert_eq!(content.lines().count(), 2);

        fs::remove_dir_all(settings_path.parent().unwrap()).ok();
    }

    #[test]
    fn writes_log_under_settings_parent_directory() {
        let settings_path = unique_test_settings_path();

        fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

        append_command_execution_log(&settings_path, &log_entry()).unwrap();

        let log_path = settings_path
            .parent()
            .unwrap()
            .join(COMMAND_LOG_DIR)
            .join(COMMAND_LOG_FILE);

        assert!(log_path.is_file());

        fs::remove_dir_all(settings_path.parent().unwrap()).ok();
    }
}
