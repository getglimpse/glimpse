import { invoke } from "@tauri-apps/api/core";

import { CssTheme } from "@/types";

/**
 * Backend API for custom CSS themes.
 *
 * Theme files are loaded from:
 *
 * ```text
 * <app_data_dir>/themes/*.css
 * ```
 */
export const themesApi = {
  /**
   * Retrieves all available custom CSS themes.
   *
   * Backend command:
   *
   * - `get_custom_themes`
   */
  getCustomThemes: () => invoke<CssTheme[]>("get_custom_themes"),

  /**
   * Opens the themes folder in the operating system's file explorer.
   *
   * Backend command:
   *
   * - `open_themes_folder`
   */
  openFolder: () => invoke<void>("open_themes_folder"),
};