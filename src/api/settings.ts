import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import { AppSettings, PartialSettings } from "@/types";

export const SETTINGS_CHANGED_EVENT = "settings-changed";
/**
 * Backend API for application settings.
 *
 * This module provides access to the persistent settings
 * stored by the backend.
 *
 * Supported operations:
 *
 * - retrieve settings
 * - update settings partially
 * - open the settings file
 * - switch current target groups
 *
 * Frontend components should use this wrapper instead of
 * calling Tauri `invoke()` directly.
 */
export const settingsApi = {
  /**
   * Retrieves the current application settings.
   *
   * Backend command:
   *
   * - `get_settings`
   *
   * @returns The complete application settings object.
   */
  get: () => invoke<AppSettings>("get_settings"),

  /**
   * Updates part of the application settings.
   *
   * Backend command:
   *
   * - `set_settings`
   *
   * Only the provided fields are updated.
   * Other settings remain unchanged.
   *
   * @param partial Partial settings to update.
   *
   * @returns The updated application settings.
   */
  set: (partial: PartialSettings) =>
    invoke<AppSettings>("set_settings", {
      partial,
    }),

  /**
   * Opens the settings file using the operating system.
   *
   * Backend command:
   *
   * - `open_settings_file`
   *
   * This is useful for:
   *
   * - manual editing
   * - backup and restore
   * - troubleshooting
   *
   * @returns Resolves when the open request is dispatched.
   */
  openFile: () => invoke<void>("open_settings_file"),

  /**
   * Opens a native directory picker for target group paths.
   *
   * @returns The selected directory path, or `null` when cancelled.
   */
  selectTargetDirectory: () =>
    open({
      directory: true,
      multiple: false,
    }),

  /**
   * Switches the current target group.
   *
   * Backend command:
   *
   * - `switch_target_group`
   *
   * The current target group determines which
   * directories and dictionaries are searched.
   *
   * @param groupId Target group identifier.
   *
   * @returns Updated application settings.
   */
  switchTargetGroup: (groupId: string) =>
    invoke<AppSettings>("switch_target_group", {
      groupId,
    }),

  /**
   * Switches to the next available target group.
   *
   * Backend command:
   *
   * - `switch_next_target_group`
   *
   * The order of target groups is defined by
   * the stored application settings.
   *
   * @returns Updated application settings.
   */
  switchNextTargetGroup: () =>
    invoke<AppSettings>("switch_next_target_group"),

  onChanged: (handler: () => void) =>
    listen(SETTINGS_CHANGED_EVENT, handler),

};
