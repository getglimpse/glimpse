import { invoke } from "@tauri-apps/api/core";
import { IndexingStatusResponse } from "@/types";

/**
 * Backend API for indexing status and maintenance operations.
 *
 * This module provides utilities related to the filesystem index,
 * including:
 *
 * - indexing statistics
 * - watch status
 * - source cleanup
 *
 * Frontend components should use this wrapper instead of
 * calling Tauri `invoke()` directly.
 */
export const indexingApi = {
  /**
   * Removes source paths that no longer exist on disk.
   *
   * Backend command:
   *
   * - `cleanup_missing_source_paths`
   *
   * This operation is typically executed:
   *
   * - during application startup
   * - when refreshing target groups
   * - after filesystem changes outside of Glimpse
   *
   * @returns Number of removed source paths.
   */
  cleanupMissingSourcePaths: () =>
    invoke<number>("cleanup_missing_source_paths"),

  /**
   * Runs a manual full scan for the current target group.
   *
   * Backend command:
   *
   * - `full_scan`
   */
  fullScan: () => invoke<void>("full_scan"),  

  /**
   * Retrieves the current indexing status.
   *
   * Backend command:
   *
   * - `get_indexing_stats`
   *
   * The returned information may include:
   *
   * - indexed item count
   * - indexed file count
   * - indexing progress
   * - watch status
   *
   * @returns Current indexing statistics and status.
   */
  getStats: () => invoke<IndexingStatusResponse>("get_indexing_stats"),
};
