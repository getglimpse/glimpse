import { invoke } from "@tauri-apps/api/core";

/**
 * Backend API for opening files and revealing them
 * in the operating system's file manager.
 *
 * This module provides OS integration features used by:
 *
 * - search results
 * - preview panels
 * - context menus
 * - inspector dialogs
 *
 * Supported operations:
 *
 * - open files with the default application
 * - reveal files in the file explorer
 * - fallback from open to reveal
 *
 * Frontend components should use this wrapper instead of
 * calling Tauri `invoke()` directly.
 */
export const openerApi = {
  /**
   * Opens a source file using the operating system's
   * default application.
   *
   * Backend command:
   *
   * - `open_source_file`
   *
   * Examples:
   *
   * - Markdown → VSCode / editor
   * - Image → image viewer
   * - PDF → PDF viewer
   *
   * @param sourcePath Absolute source file path.
   */
  openSourceFile(sourcePath: string) {
    return invoke("open_source_file", {
      sourcePath,
    });
  },

  /**
   * Reveals a file in the operating system's file explorer.
   *
   * Backend command:
   *
   * - `reveal_in_explorer`
   *
   * Examples:
   *
   * - Windows → Explorer
   * - macOS → Finder
   * - Linux → File Manager
   *
   * @param sourcePath Absolute source file path.
   */
  revealInExplorer(sourcePath: string) {
    return invoke("reveal_in_explorer", {
      sourcePath,
    });
  },

  /**
   * Attempts to open a source file first.
   *
   * If the open operation fails, the file location is
   * revealed in the file explorer as a fallback.
   *
   * This method rethrows the original error after revealing
   * the file so callers can still handle the failure.
   *
   * Typical use cases:
   *
   * - unsupported file types
   * - missing file associations
   * - application launch failures
   *
   * @param sourcePath Absolute source file path.
   *
   * @throws Error if opening the file fails.
   */
  async openSourceFileOrReveal(sourcePath: string) {
    try {
      await this.openSourceFile(sourcePath);
    } catch (error) {
      await this.revealInExplorer(sourcePath);

      throw error;
    }
  },
};