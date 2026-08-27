import { describe, expect, it } from "vitest";

import { normalizeKeyboardEvent } from "./normalizeKeyboardEvent";

const keyboardEvent = (
  value: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">,
) =>
  ({
    altKey: false,
    code: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...value,
  }) as KeyboardEvent;

describe("normalizeKeyboardEvent", () => {
  it("uses digit codes when shift changes the typed character", () => {
    expect(
      normalizeKeyboardEvent(
        keyboardEvent({
          code: "Digit1",
          ctrlKey: true,
          key: "!",
          shiftKey: true,
        }),
      ),
    ).toBe("Ctrl+Shift+1");
  });

  it("normalizes Ctrl + colon without requiring Shift in the shortcut label", () => {
    expect(
      normalizeKeyboardEvent(
        keyboardEvent({
          code: "Semicolon",
          ctrlKey: true,
          key: ":",
          shiftKey: true,
        }),
      ),
    ).toBe("Ctrl+:");
  });
});
