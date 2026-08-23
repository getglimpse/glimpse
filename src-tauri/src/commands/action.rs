//! Command action IPC handling.
//!
//! This module executes `OpenAction::Command` items requested from the
//! frontend.
//!
//! Command execution is intentionally guarded by multiple validation layers:
//!
//! 1. Load the item's open action from SQLite.
//! 2. Resolve the command path.
//! 3. Validate that the resolved path is executable.
//! 4. Check trusted directory rules for explicit paths.
//! 5. Check command allow/block policy.
//! 6. Spawn the command process.
//! 7. Write a command execution log.
//!
//! Failed or blocked executions are also logged so users can inspect why a
//! command did not run.
//!
//! This module should not contain command policy definitions themselves.
//! Policy and path validation live in `utils/`.

use chrono::Utc;
use rusqlite::Connection;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

use crate::app_state::SharedSettingsPath;
use crate::models::command_log::{
    CommandExecutionLog, CommandExecutionStage, CommandExecutionStatus,
};
use crate::models::OpenAction;
use crate::store::command_log::append_command_execution_log;
use crate::store::item_mapper::map_open_action;
use crate::store::settings::load_settings;
use crate::utils::command_lookup::resolve_command_path;
use crate::utils::command_open::validate_command_path;
use crate::utils::command_policy::check_command_policy;
use crate::utils::trusted_directories::check_trusted_directory;

/// Runs the command associated with an indexed item.
///
/// The item must have an `OpenAction::Command` configured in the database.
/// Non-command items return an error and are not executed.
///
/// Security flow:
///
/// 1. Resolve the command from either an explicit path or `PATH`.
/// 2. Validate the resolved path.
/// 3. For explicit paths, ensure the command is inside a trusted directory.
/// 4. Apply command allow/block policy from settings.
/// 5. Spawn the process if all checks pass.
///
/// `args` is an optional whitespace-separated argument string passed from the
/// frontend command launcher.
///
/// Every failed, blocked, or spawned execution is written to the command
/// execution log.
#[tauri::command]
pub fn run_item_command(
    db: tauri::State<Arc<Mutex<Connection>>>,
    item_id: String,
    settings_path: tauri::State<SharedSettingsPath>,
    args: Option<String>,
) -> Result<(), String> {
    let open_action = {
        let conn = db.lock().map_err(|e| e.to_string())?;

        conn.query_row(
            r#"
            SELECT
                open_type,
                open_url,
                open_command_path
            FROM items
            WHERE id = ?
            "#,
            [&item_id],
            |row| {
                let open_type: Option<String> = row.get(0)?;
                let open_url: Option<String> = row.get(1)?;
                let open_command_path: Option<String> = row.get(2)?;

                Ok(map_open_action(open_type, open_url, open_command_path))
            },
        )
        .map_err(|e| e.to_string())?
    };

    let Some(OpenAction::Command { path }) = open_action else {
        return Err("item is not a command action".to_string());
    };

    let command_args = parse_command_args(args.as_deref());

    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?;
    let settings = load_settings(&settings_path);

    let resolved_path = match resolve_command_path(&path) {
        Some(resolved_path) => resolved_path,
        None => {
            let error = format!("command not found: {path}");

            log_command_failure(
                &settings_path,
                &item_id,
                &path,
                None,
                &command_args,
                CommandExecutionStatus::Failed,
                CommandExecutionStage::Resolve,
                &error,
            );

            return Err(error);
        }
    };

    if let Err(error) = validate_command_path(&resolved_path) {
        log_command_failure(
            &settings_path,
            &item_id,
            &path,
            Some(&resolved_path),
            &command_args,
            CommandExecutionStatus::Failed,
            CommandExecutionStage::Validate,
            &error,
        );

        return Err(error);
    }

    if is_explicit_command_path(&path) {
        if let Err(error) =
            check_trusted_directory(&resolved_path, &settings.commands.trusted_directories)
        {
            log_command_failure(
                &settings_path,
                &item_id,
                &path,
                Some(&resolved_path),
                &command_args,
                CommandExecutionStatus::Blocked,
                CommandExecutionStage::TrustedDirectory,
                &error,
            );

            return Err(error);
        }
    }

    if let Err(error) = check_command_policy(&path, &resolved_path, &settings.commands) {
        log_command_failure(
            &settings_path,
            &item_id,
            &path,
            Some(&resolved_path),
            &command_args,
            CommandExecutionStatus::Blocked,
            CommandExecutionStage::Policy,
            &error,
        );

        return Err(error);
    }

    let result = Command::new(&resolved_path).args(&command_args).spawn();

    let log_entry = CommandExecutionLog {
        timestamp: Utc::now(),
        item_id,
        command: path,
        resolved_path: Some(resolved_path.to_string_lossy().to_string()),
        args: command_args,
        status: if result.is_ok() {
            CommandExecutionStatus::Success
        } else {
            CommandExecutionStatus::Failed
        },
        stage: CommandExecutionStage::Spawn,
        error: result.as_ref().err().map(|e| e.to_string()),
    };

    let _ = append_command_execution_log(&settings_path, &log_entry);

    result.map(|_| ()).map_err(|e| e.to_string())
}

/// Parses optional command arguments from the frontend.
///
/// Arguments are currently split by ASCII/Unicode whitespace.
///
/// This is intentionally simple and does not implement shell-like parsing.
/// Quoting and escaping are not interpreted.
fn parse_command_args(args: Option<&str>) -> Vec<String> {
    args.unwrap_or_default()
        .split_whitespace()
        .filter(|arg| !arg.is_empty())
        .map(|arg| arg.to_string())
        .collect()
}

/// Writes a failed or blocked command execution to the command log.
///
/// Logging failures are intentionally ignored so that the original execution
/// error can be returned to the caller unchanged.
fn log_command_failure(
    settings_path: &Path,
    item_id: &str,
    command: &str,
    resolved_path: Option<&Path>,
    args: &[String],
    status: CommandExecutionStatus,
    stage: CommandExecutionStage,
    error: &str,
) {
    let log_entry = CommandExecutionLog {
        timestamp: Utc::now(),
        item_id: item_id.to_string(),
        command: command.to_string(),
        resolved_path: resolved_path.map(|path| path.to_string_lossy().to_string()),
        args: args.to_vec(),
        status,
        stage,
        error: Some(error.to_string()),
    };

    let _ = append_command_execution_log(settings_path, &log_entry);
}

/// Returns whether a command string appears to be an explicit filesystem path.
///
/// Explicit paths include:
///
/// - absolute paths
/// - relative paths containing `/`
/// - relative paths containing `\`
///
/// Bare command names such as `code` or `rg` are treated as commands to resolve
/// from `PATH`.
fn is_explicit_command_path(command: &str) -> bool {
    let command = command.trim();

    if command.is_empty() {
        return false;
    }

    let path = Path::new(command);

    path.is_absolute() || command.contains('/') || command.contains('\\')
}
