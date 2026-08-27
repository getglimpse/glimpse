/**
 * Converts a KeyboardEvent into a normalized shortcut string.
 *
 * Examples:
 *
 * - Enter -> "Enter"
 * - Ctrl + E -> "Ctrl+E"
 * - Ctrl + Shift + P -> "Ctrl+Shift+P"
 * - Ctrl + , -> "Ctrl+,"
 */
export const normalizeKeyboardEvent = (event: KeyboardEvent): string => {
  const parts: string[] = [];

  if (event.ctrlKey) {
    parts.push("Ctrl");
  }

  if (event.metaKey) {
    parts.push("Meta");
  }

  if (event.altKey) {
    parts.push("Alt");
  }

  if (event.shiftKey && event.key !== ":") {
    parts.push("Shift");
  }

  let key = event.key;

  const digit = event.code.match(/^Digit(\d)$/)?.[1];

  if (digit) {
    key = digit;
  } else if (key === " ") {
    key = "Space";
  } else if (key.length === 1) {
    key = key.toUpperCase();
  }

  parts.push(key);

  return parts.join("+");
};
