import { invoke } from "@tauri-apps/api/core";

import { CommandExecutionLog } from "@/types";

/**
 * Backend API for command execution logs.
 *
 * This module provides access to the command execution history
 * recorded by the backend.
 *
 * Logs are primarily used for:
 *
 * - debugging command failures
 * - inspecting executed commands
 * - troubleshooting user environments
 * - security auditing
 *
 * Frontend components should use this wrapper instead of
 * calling Tauri `invoke()` directly.
 */
export const commandLogsApi = {
  /**
   * Retrieves recent command execution logs.
   *
   * Backend command:
   *
   * - `get_command_execution_logs`
   *
   * Logs are returned in descending order,
   * with the most recent entries appearing first.
   *
   * @param limit Maximum number of log entries to return.
   * Defaults to `100`.
   *
   * @returns A list of command execution logs.
   */
  list(limit = 100) {
    return invoke<CommandExecutionLog[]>("get_command_execution_logs", {
      limit,
    });
  },

  /**
   * Opens the command log file in the operating system.
   *
   * Backend command:
   *
   * - `open_command_logs_file`
   *
   * The actual application used to open the file
   * depends on the user's operating system.
   *
   * @returns Resolves when the open request is dispatched.
   */
  openFile() {
    return invoke<void>("open_command_logs_file");
  },
};