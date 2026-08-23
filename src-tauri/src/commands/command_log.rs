//! Command execution log IPC commands.
//!
//! This module exposes read-only access to command execution logs.
//!
//! Supported operations:
//!
//! - read recent command execution history
//! - open the log directory in the system file explorer
//!
//! The actual log persistence is implemented in:
//!
//! - `store::command_log`
//!
//! Command execution itself is handled by:
//!
//! - `commands::action`

use crate::app_state::SharedSettingsPath;
use crate::models::command_log::CommandExecutionLog;
use crate::store::command_log::read_command_execution_logs;

/// Returns recent command execution logs.
///
/// The returned logs may include:
///
/// - successful executions
/// - failed executions
/// - blocked executions
///
/// Results are ordered by the storage implementation, which typically returns
/// the newest entries first.
///
/// # Arguments
///
/// - `limit`
///
///   Maximum number of log entries to return.
///
///   Defaults to `100` when omitted.
///
/// # Returns
///
/// A list of [`CommandExecutionLog`] values.
#[tauri::command]
pub fn get_command_execution_logs(
    settings_path: tauri::State<SharedSettingsPath>,
    limit: Option<usize>,
) -> Result<Vec<CommandExecutionLog>, String> {
    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?;

    read_command_execution_logs(&settings_path, limit.unwrap_or(100))
}

/// Opens the command log directory in the system file explorer.
///
/// The log directory is located under:
///
/// ```text
/// <app_data_dir>/logs
/// ```
///
/// The directory is automatically created if it does not already exist.
///
/// This command is intended for:
///
/// - viewing log files directly
/// - debugging command failures
/// - attaching logs to bug reports
#[tauri::command]
pub fn open_command_logs_file(
    settings_path: tauri::State<SharedSettingsPath>,
) -> Result<(), String> {
    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?;

    let app_data_dir = settings_path
        .parent()
        .ok_or_else(|| "settings path has no parent directory".to_string())?;

    let log_dir = app_data_dir.join("logs");

    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    opener::open(log_dir).map_err(|e| e.to_string())
}
