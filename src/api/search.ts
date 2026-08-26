import { invoke } from "@tauri-apps/api/core";
import type { SearchResult } from "@/types";

/**
 * Search request parameters.
 *
 * This interface corresponds to the backend
 * `SearchRequest` structure and the `search_items`
 * Tauri command arguments.
 */
export interface SearchParams {
  /**
   * Search query string.
   *
   * Examples:
   *
   * - `rust`
   * - `tag:rust`
   * - `#rust`
   */
  query: string;

  /**
   * Restricts the search to a specific dictionary.
   *
   * If omitted, all available dictionaries are searched.
   */
  dictionaryId?: string;

  /**
   * Maximum number of search results to return.
   */
  limit?: number;

  /**
   * Searches only items marked as hidden metadata.
   */
  hidden?: boolean;
}

/**
 * Backend API for searching indexed items.
 *
 * This module is the primary entry point for retrieving
 * search results from the backend search engine.
 *
 * Supported backends:
 *
 * - SQLite FTS5
 * - Tantivy (experimental)
 *
 * Frontend components should use this wrapper instead of
 * calling Tauri `invoke()` directly.
 */
export const searchApi = {
  /**
   * Executes a search request.
   *
   * Backend command:
   *
   * - `search_items`
   *
   * Search behavior:
   *
   * - Empty queries may return recent items.
   * - Supports fuzzy matching and ranking.
   * - Searches the current target group.
   *
   * @param params Search parameters.
   *
   * @returns A list of matching search results.
   *
   * @throws Error When the backend search request fails.
   */
  async getItems(params: SearchParams): Promise<SearchResult[]> {
    try {
      const results = await invoke<SearchResult[]>("search_items", {
        query: params.query,
        dictionaryId: params.dictionaryId,
        limit: params.limit,
        hiddenOnly: params.hidden,
      });

      return results;
    } catch (error) {
      console.error("API Error (search_items):", error);

      throw new Error(
        typeof error === "string" ? error : "Unknown search error",
      );
    }
  },

  async getItemsBySourcePath(sourcePath: string): Promise<SearchResult[]> {
    try {
      return await invoke<SearchResult[]>("get_items_by_source_path", {
        sourcePath,
      });
    } catch (error) {
      console.error("API Error (get_items_by_source_path):", error);

      throw new Error(
        typeof error === "string" ? error : "Unknown source path lookup error",
      );
    }
  },

  // Future APIs:
  // async getDictionaries() { ... }
  // async togglePin(id: string) { ... }
};
