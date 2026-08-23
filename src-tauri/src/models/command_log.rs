//! Command execution log models.
//!
//! This module defines audit records for command execution.
//!
//! Logs are generated whenever an `OpenAction::Command` is processed,
//! including:
//!
//! - successful executions
//! - failed executions
//! - blocked executions
//!
//! Logged information includes:
//!
//! - execution timestamp
//! - source item ID
//! - original command
//! - resolved executable path
//! - arguments
//! - execution stage
//! - error information
//!
//! These models are used by:
//!
//! - `commands::action`
//! - `store::command_log`
//! - frontend debug pages

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A single command execution record.
///
/// This structure is serialized and persisted as part of the command log.
///
/// It records both successful executions and failures so users can inspect
/// command behavior and diagnose issues.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionLog {
    /// Timestamp when the execution attempt occurred.
    pub timestamp: DateTime<Utc>,

    /// ID of the originating indexed item.
    pub item_id: String,

    /// Original command string configured by the item.
    ///
    /// Examples:
    ///
    /// ```text
    /// cargo
    /// code
    /// /usr/local/bin/tool
    /// ```
    pub command: String,

    /// Resolved executable path.
    ///
    /// This is filled after command lookup succeeds.
    ///
    /// Examples:
    ///
    /// ```text
    /// /usr/bin/cargo
    /// C:\Program Files\Git\bin\bash.exe
    /// ```
    pub resolved_path: Option<String>,

    /// Command-line arguments passed to the process.
    pub args: Vec<String>,

    /// Final execution status.
    pub status: CommandExecutionStatus,

    /// The stage where execution succeeded, failed, or was blocked.
    pub stage: CommandExecutionStage,

    /// Error message if execution was unsuccessful.
    pub error: Option<String>,
}

/// Final result of a command execution attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandExecutionStatus {
    /// Command executed successfully.
    Success,

    /// Command execution failed unexpectedly.
    Failed,

    /// Command execution was intentionally blocked by security checks.
    Blocked,
}

/// Processing stage of command execution.
///
/// Commands pass through multiple validation stages before they are executed.
///
/// Typical flow:
///
/// ```text
/// Resolve
///    ↓
/// Validate
///    ↓
/// TrustedDirectory
///    ↓
/// Policy
///    ↓
/// Spawn
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandExecutionStage {
    /// Resolve command path from explicit path or `PATH`.
    Resolve,

    /// Validate the resolved executable path.
    Validate,

    /// Check whether the executable resides in a trusted directory.
    TrustedDirectory,

    /// Apply allowlist/blocklist policies.
    Policy,

    /// Spawn the child process.
    Spawn,
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::Utc;

    #[test]
    fn serializes_status_and_stage_as_camel_case() {
        let log = CommandExecutionLog {
            timestamp: Utc::now(),
            item_id: "item-1".to_string(),
            command: "cargo".to_string(),
            resolved_path: Some("/usr/bin/cargo".to_string()),
            args: vec!["test".to_string()],
            status: CommandExecutionStatus::Blocked,
            stage: CommandExecutionStage::Policy,
            error: Some("command is blocked".to_string()),
        };

        let json = serde_json::to_string(&log).unwrap();

        assert!(json.contains("\"status\":\"blocked\""));
        assert!(json.contains("\"stage\":\"policy\""));
        assert!(json.contains("\"itemId\":\"item-1\""));
        assert!(json.contains("\"resolvedPath\":\"/usr/bin/cargo\""));
    }

    #[test]
    fn serializes_trusted_directory_stage_as_camel_case() {
        let log = CommandExecutionLog {
            timestamp: Utc::now(),
            item_id: "item-1".to_string(),
            command: "/tmp/tool".to_string(),
            resolved_path: Some("/tmp/tool".to_string()),
            args: Vec::new(),
            status: CommandExecutionStatus::Blocked,
            stage: CommandExecutionStage::TrustedDirectory,
            error: Some("no trusted directories configured".to_string()),
        };

        let json = serde_json::to_string(&log).unwrap();

        assert!(json.contains("\"status\":\"blocked\""));
        assert!(json.contains("\"stage\":\"trusted_directory\""));
    }
}
