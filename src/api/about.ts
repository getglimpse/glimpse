import { invoke } from "@tauri-apps/api/core";

import { AboutInfo } from "@/types";

/**
 * Backend API for application metadata.
 *
 * This module provides access to static information about
 * the running Glimpse application, such as:
 *
 * - application name
 * - version
 * - description
 * - repository URL
 * - author information
 *
 * Frontend components should use this wrapper instead of
 * calling Tauri `invoke()` directly.
 */
export const aboutApi = {
  /**
   * Retrieves application metadata from the backend.
   *
   * Backend command:
   *
   * - `get_about_info`
   *
   * @returns Application information used by the About page.
   */
  get() {
    return invoke<AboutInfo>("get_about_info");
  },
};