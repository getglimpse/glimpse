//! Command action IPC handling.
//!
//! This module executes item commands requested from the
//! frontend.
//!
//! Command execution is intentionally guarded by multiple validation layers:
//!
//! 1. Load the item's command action from SQLite.
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
use crate::store::command_log::append_command_execution_log;
use crate::store::settings::load_settings;
use crate::utils::command_lookup::resolve_command_path;
use crate::utils::command_open::validate_command_path;
use crate::utils::command_policy::check_command_policy;
use crate::utils::trusted_directories::check_trusted_directory;

/// Runs the command associated with an indexed item.
///
/// The item must have a command configured in the database.
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
    let command = {
        let conn = db.lock().map_err(|e| e.to_string())?;

        conn.query_row(
            r#"
            SELECT
                item_command
            FROM items
            WHERE id = ?
            "#,
            [&item_id],
            |row| {
                let command: Option<String> = row.get(0)?;

                Ok(command)
            },
        )
        .map_err(|e| e.to_string())?
    };

    let Some(command) = command else {
        return Err("item is not a command action".to_string());
    };

    let (program, mut command_args) = parse_metadata_command(&command)?;
    command_args.extend(parse_command_args(args.as_deref()));

    let settings_path = settings_path.0.lock().map_err(|e| e.to_string())?;
    let settings = load_settings(&settings_path);

    let resolved_path = match resolve_command_path(&program) {
        Some(resolved_path) => resolved_path,
        None => {
            let error = format!("command not found: {program}");

            log_command_failure(CommandFailure {
                settings_path: &settings_path,
                item_id: &item_id,
                command: &command,
                resolved_path: None,
                args: &command_args,
                status: CommandExecutionStatus::Failed,
                stage: CommandExecutionStage::Resolve,
                error: &error,
            });

            return Err(error);
        }
    };

    if let Err(error) = validate_command_path(&resolved_path) {
        log_command_failure(CommandFailure {
            settings_path: &settings_path,
            item_id: &item_id,
            command: &command,
            resolved_path: Some(&resolved_path),
            args: &command_args,
            status: CommandExecutionStatus::Failed,
            stage: CommandExecutionStage::Validate,
            error: &error,
        });

        return Err(error);
    }

    if is_explicit_command_path(&program) {
        if let Err(error) =
            check_trusted_directory(&resolved_path, &settings.commands.trusted_directories)
        {
            log_command_failure(CommandFailure {
                settings_path: &settings_path,
                item_id: &item_id,
                command: &command,
                resolved_path: Some(&resolved_path),
                args: &command_args,
                status: CommandExecutionStatus::Blocked,
                stage: CommandExecutionStage::TrustedDirectory,
                error: &error,
            });

            return Err(error);
        }
    }

    if let Err(error) = check_command_policy(&program, &resolved_path, &settings.commands) {
        log_command_failure(CommandFailure {
            settings_path: &settings_path,
            item_id: &item_id,
            command: &command,
            resolved_path: Some(&resolved_path),
            args: &command_args,
            status: CommandExecutionStatus::Blocked,
            stage: CommandExecutionStage::Policy,
            error: &error,
        });

        return Err(error);
    }

    let result = Command::new(&resolved_path).args(&command_args).spawn();

    let log_entry = CommandExecutionLog {
        timestamp: Utc::now(),
        item_id,
        command,
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

fn parse_metadata_command(command: &str) -> Result<(String, Vec<String>), String> {
    let mut parts = command
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .map(|part| part.to_string());

    let program = parts.next().ok_or_else(|| "command is empty".to_string())?;

    Ok((program, parts.collect()))
}

/// Data required to record a failed or blocked command execution.
struct CommandFailure<'a> {
    settings_path: &'a Path,
    item_id: &'a str,
    command: &'a str,
    resolved_path: Option<&'a Path>,
    args: &'a [String],
    status: CommandExecutionStatus,
    stage: CommandExecutionStage,
    error: &'a str,
}

/// Writes a failed or blocked command execution to the command log.
///
/// Logging failures are intentionally ignored so that the original execution
/// error can be returned to the caller unchanged.
fn log_command_failure(failure: CommandFailure<'_>) {
    let log_entry = CommandExecutionLog {
        timestamp: Utc::now(),
        item_id: failure.item_id.to_string(),
        command: failure.command.to_string(),
        resolved_path: failure
            .resolved_path
            .map(|path| path.to_string_lossy().to_string()),
        args: failure.args.to_vec(),
        status: failure.status,
        stage: failure.stage,
        error: Some(failure.error.to_string()),
    };

    let _ = append_command_execution_log(failure.settings_path, &log_entry);
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
