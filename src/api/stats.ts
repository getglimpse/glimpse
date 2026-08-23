import { invoke } from "@tauri-apps/api/core";

import { AppStats, TagCloudEntry } from "@/types";

/**
 * Backend API for application statistics.
 *
 * This module provides aggregated statistics about
 * the current Glimpse workspace and search index.
 *
 * Statistics may include:
 *
 * - indexed item count
 * - indexed file count
 * - dictionary count
 * - command count
 * - storage information
 *
 * Frontend components should use this wrapper instead of
 * calling Tauri `invoke()` directly.
 */
export const statsApi = {
  /**
   * Retrieves the current application statistics.
   *
   * Backend command:
   *
   * - `get_stats`
   *
   * The returned statistics are used by:
   *
   * - About page
   * - Debug page
   * - Status bar
   *
   * @returns Aggregated application statistics.
   */
  get: () => invoke<AppStats>("get_stats"),

  /**
   * Retrieves tag usage for the current active index.
   *
   * Backend command:
   *
   * - `get_tag_cloud`
   */
  getTagCloud: () => invoke<TagCloudEntry[]>("get_tag_cloud"),
};
