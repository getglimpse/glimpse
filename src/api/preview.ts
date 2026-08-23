import { Preview } from "@/types";
import { invoke } from "@tauri-apps/api/core";

/**
 * Backend API for preview window operations.
 *
 * This module provides commands related to the preview system,
 * including opening, closing, and managing preview panels.
 *
 * Frontend components should use this wrapper instead of
 * calling Tauri `invoke()` directly.
 */
export const previewApi = {
  async getPreview(id: string): Promise<Preview | null> {
    return invoke<Preview | null>("get_preview", { id });
  },

  /**
   * Closes the preview panel.
   *
   * Backend command:
   *
   * - `close_preview`
   *
   * This command is typically used when:
   *
   * - the user closes the active preview tab
   * - no pinned preview tabs remain
   * - the preview area should be hidden completely
   *
   * @returns Resolves when the close request is accepted.
   */
  closePreview: () => invoke<void>("close_preview"),
};