import { invoke } from "@tauri-apps/api/core";

/**
 * Payload for creating a new Markdown file.
 */
export type CreateMarkdownFilePayload = {
  /**
   * File title.
   *
   * Usually used as the filename without extension.
   */
  title: string;

  /**
   * Initial Markdown content.
   */
  body: string;
};

export type CreateTextFilePayload = {
  title: string;
  body: string;
  extension: "md" | "gjson";
};

export type WritePluginTextOutputPayload = {
  directory: string;
  fileName: string;
  body: string;
};

export type FileMetadata = {
  sizeBytes: number;
};

/**
 * Backend API for text file operations.
 *
 * This module provides file management features for
 * documents stored in the Glimpse workspace.
 *
 * Supported operations:
 *
 * - read text files
 * - create Markdown files
 * - update Markdown file titles
 * - update Markdown file bodies
 *
 * Frontend components should use this wrapper instead of
 * calling Tauri `invoke()` directly.
 */
export const fileApi = {
  /**
   * Reads a UTF-8 text file.
   *
   * Backend command:
   *
   * - `read_text_file`
   *
   * @param filePath Absolute file path.
   *
   * @returns File contents as a string.
   */
  readTextFile: (filePath: string) =>
    invoke<string>("read_text_file", { filePath }),

  readPluginTextInput: (filePath: string) =>
    invoke<string>("read_plugin_text_input", { filePath }),

  /**
   * Reads a UTF-8 text file constrained to one configured Target Group.
   *
   * Backend command:
   *
   * - `read_text_file_in_target_group`
   *
   * @param filePath Absolute file path.
   * @param targetGroupId Configured Target Group to use as the read scope.
   *
   * @returns File contents as a string.
   */
  readTextFileInTargetGroup: (filePath: string, targetGroupId: string) =>
    invoke<string>("read_text_file_in_target_group", {
      filePath,
      targetGroupId,
    }),

  /**
   * Reads basic file metadata.
   *
   * Backend command:
   *
   * - `get_file_metadata`
   */
  getFileMetadata: (filePath: string) =>
    invoke<FileMetadata>("get_file_metadata", { filePath }),

  /**
   * Reads basic file metadata constrained to one configured Target Group.
   *
   * Backend command:
   *
   * - `get_file_metadata_in_target_group`
   */
  getFileMetadataInTargetGroup: (filePath: string, targetGroupId: string) =>
    invoke<FileMetadata>("get_file_metadata_in_target_group", {
      filePath,
      targetGroupId,
    }),

  /**
   * Reads a binary file as base64.
   *
   * Backend command:
   *
   * - `read_binary_file`
   */
  readBinaryFile: (filePath: string) =>
    invoke<string>("read_binary_file", { filePath }),

  /**
   * Reads a binary file as base64 constrained to one configured Target Group.
   *
   * Backend command:
   *
   * - `read_binary_file_in_target_group`
   */
  readBinaryFileInTargetGroup: (filePath: string, targetGroupId: string) =>
    invoke<string>("read_binary_file_in_target_group", {
      filePath,
      targetGroupId,
    }),

  /**
   * Reads a local preview asset as a data URL after backend scope checks.
   *
   * Backend command:
   *
   * - `read_preview_asset_data_url`
   *
   * The asset must belong to the same configured Target Group as the source
   * file that produced the Markdown/GJSON preview.
   */
  readPreviewAssetDataUrl: (sourcePath: string, assetPath: string) =>
    invoke<string>("read_preview_asset_data_url", {
      sourcePath,
      assetPath,
    }),

  /**
   * Creates a new text file.
   *
   * Backend command:
   *
   * - `create_text_file`
   *
   * @returns Absolute path of the created file.
   */
  createTextFile: (payload: CreateTextFilePayload) =>
    invoke<string>("create_text_file", { payload }),

  getDefaultDownloadDirectory: () =>
    invoke<string>("get_default_download_directory"),

  writePluginTextOutput: (payload: WritePluginTextOutputPayload) =>
    invoke<string>("write_plugin_text_output", { payload }),

  /**
   * Creates a new Markdown file.
   *
   * Backend command:
   *
   * - `create_markdown_file`
   *
   * The backend determines the destination directory
   * and returns the created file path.
   *
   * @param payload Markdown creation parameters.
   *
   * @returns Absolute path of the created file.
   */
  createMarkdownFile: (payload: CreateMarkdownFilePayload) =>
    invoke<string>("create_markdown_file", { payload }),

  /**
   * Updates only the text file title / filename while preserving extension.
   *
   * Backend command:
   *
   * - `update_text_file_title`
   *
   * @returns Final file path after rename.
   */
  updateTextFileTitle: (filePath: string, title: string) =>
    invoke<string>("update_text_file_title", { filePath, title }),

  /**
   * Updates only the Markdown file title / filename.
   *
   * Backend command:
   *
   * - `update_markdown_file_title`
   *
   * @returns Final file path after rename.
   */
  updateMarkdownFileTitle: (filePath: string, title: string) =>
    invoke<string>("update_markdown_file_title", { filePath, title }),

  /**
   * Updates only the text file body.
   *
   * Backend command:
   *
   * - `update_text_file_body`
   */
  updateTextFileBody: (filePath: string, body: string) =>
    invoke<void>("update_text_file_body", { filePath, body }),

  /**
   * Updates only the Markdown file body.
   *
   * Backend command:
   *
   * - `update_markdown_file_body`
   */
  updateMarkdownFileBody: (filePath: string, body: string) =>
    invoke<void>("update_markdown_file_body", { filePath, body }),
};
