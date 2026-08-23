import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

export type MarkdownTask = {
  index: number;
  start: number;
  checkedCharOffset: number;
  checked: boolean;
};

export const remarkTaskIndex: Plugin = () => {
  return (tree) => {
    let taskIndex = 0;

    visit(tree, "listItem", (node: any) => {
      if (typeof node.checked !== "boolean") {
        return;
      }

      node.data ??= {};
      node.data.hProperties ??= {};
      node.data.hProperties["data-task-index"] = String(taskIndex);

      taskIndex += 1;
    });
  };
};

export const extractMarkdownTasks = (
  markdown: string,
): MarkdownTask[] => {
  const tasks: MarkdownTask[] = [];
  const regex = /^(\s*[-*+]\s+\[)( |x|X)(\])/gm;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    tasks.push({
      index: tasks.length,
      start: match.index,
      checkedCharOffset: match.index + match[1].length,
      checked: match[2].toLowerCase() === "x",
    });
  }

  return tasks;
};

export const toggleMarkdownTask = (
  markdown: string,
  task: MarkdownTask,
): string => {
  const nextCheckedChar = task.checked ? " " : "x";

  return (
    markdown.slice(0, task.checkedCharOffset) +
    nextCheckedChar +
    markdown.slice(task.checkedCharOffset + 1)
  );
};

export const shouldIgnoreTaskToggle = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest("input, button, a, code, pre"),
  );
};