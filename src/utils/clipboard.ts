import { extractMarkdownCodeBlocks } from "@/utils/markdown";

/**
 * Copies plain text to the system clipboard.
 *
 * Returns `false` when the input text is empty.
 *
 * @param text Text to copy.
 *
 * @returns `true` if the text was copied successfully,
 * otherwise `false`.
 */
export const copyText = async (text: string) => {
  if (!text) {
    return false;
  }

  await navigator.clipboard.writeText(text);
  return true;
};

/**
 * Copies the currently displayed preview content.
 *
 * This is a convenience wrapper around {@link copyText}
 * used by preview components.
 *
 * @param content Preview content.
 *
 * @returns `true` if the content was copied successfully,
 * otherwise `false`.
 */
export const copyPreviewContent = async (content: string) => {
  return copyText(content);
};

/**
 * Copies a fenced Markdown code block to the clipboard.
 *
 * The code block is extracted using
 * `extractMarkdownCodeBlocks()` and copied without
 * Markdown fences.
 *
 * Example:
 *
 * ```md
 * ```ts
 * const x = 1;
 * ```
 * ```
 *
 * Copied text:
 *
 * ```ts
 * const x = 1;
 * ```
 *
 * @param content Raw Markdown content.
 * @param index Zero-based code block index.
 *
 * @returns `true` if the code block exists and was copied,
 * otherwise `false`.
 */
export const copyMarkdownCodeBlock = async (
  content: string,
  index: number,
) => {
  const codeBlock = extractMarkdownCodeBlocks(content)[index];

  if (!codeBlock) {
    return false;
  }

  return copyText(codeBlock.content);
};