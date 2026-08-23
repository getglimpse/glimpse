import { invoke } from "@tauri-apps/api/core";

/**
 * Backend API for executing item commands.
 *
 * This module provides a thin wrapper around Tauri IPC commands
 * related to executable actions attached to indexed items.
 *
 * Command execution is validated on the backend before launch,
 * including:
 *
 * - command path sanitization
 * - executable lookup
 * - whitelist / blacklist checks
 * - trusted directory validation
 *
 * Frontend components should use this API instead of calling
 * Tauri `invoke()` directly.
 */
export const commandApi = {
  /**
   * Executes the command associated with an indexed item.
   *
   * The command definition is stored in the item's metadata and
   * resolved by the backend before execution.
   *
   * Backend command:
   *
   * - `run_item_command`
   *
   * @param itemId Indexed item identifier.
   * @param args Optional command arguments supplied by the user.
   *
   * @returns Resolves when the command execution request is accepted.
   */
  runItemCommand: (itemId: string, args?: string | null) =>
    invoke<void>("run_item_command", {
      itemId,
      args,
    }),
};