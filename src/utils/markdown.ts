import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

/**
 * Extracted Markdown fenced code block.
 */
export type MarkdownCodeBlock = {
  /**
   * Zero-based code block index.
   *
   * This index corresponds to the order in which
   * code blocks appear in the Markdown document.
   */
  index: number;

  /**
   * Language identifier specified after the opening fence.
   *
   * Examples:
   *
   * - "ts"
   * - "rust"
   * - "bash"
   *
   * Returns `null` if no language is specified.
   */
  language: string | null;

  /**
   * Raw code content without Markdown fences.
   */
  content: string;

  /**
   * Character offset of the opening fence
   * within the original Markdown string.
   */
  startOffset: number;
};

/**
 * Extracts fenced code blocks from a Markdown document.
 *
 * Supported syntax:
 *
 * ```md
 * ```ts
 * const x = 1;
 * ```
 * ```
 *
 * Returned result:
 *
 * ```ts
 * {
 *   language: "ts",
 *   content: "const x = 1;"
 * }
 * ```
 *
 * Notes:
 *
 * - Only fenced code blocks (` ``` `) are extracted.
 * - Inline code (`code`) is ignored.
 * - Opening and closing fences are removed.
 * - The trailing newline before the closing fence is trimmed.
 *
 * @param markdown Raw Markdown content.
 *
 * @returns Extracted code blocks in appearance order.
 */
export function extractMarkdownCodeBlocks(
  markdown: string,
): MarkdownCodeBlock[] {
  const blocks: MarkdownCodeBlock[] = [];

  const regex = /```([^\n\r`]*)\r?\n([\s\S]*?)```/g;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    blocks.push({
      index: blocks.length,

      language: match[1]?.trim() || null,

      content: match[2].replace(/\n$/, ""),

      startOffset: match.index,
    });
  }

  return blocks;
}

export const remarkSoftLineBreaks: Plugin = () => {
  return (tree) => {
    visit(tree, "text", (node: any, index, parent: any) => {
      if (
        typeof index !== "number" ||
        !parent ||
        !Array.isArray(parent.children) ||
        typeof node.value !== "string" ||
        !node.value.includes("\n")
      ) {
        return;
      }

      const replacement = node.value
        .split("\n")
        .flatMap((text: string, textIndex: number) => {
          const nodes = [];

          if (textIndex > 0) {
            nodes.push({ type: "break" });
          }

          if (text.length > 0) {
            nodes.push({ ...node, value: text });
          }

          return nodes;
        });

      parent.children.splice(index, 1, ...replacement);

      return index + replacement.length;
    });
  };
};
