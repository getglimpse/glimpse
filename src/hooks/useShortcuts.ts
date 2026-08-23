import { useEffect } from "react";

import type {
  FrontendStaticShortcutAction,
  FrontendShortcutAction,
  KeybindingMap,
  ShortcutAction,
  ShortcutHandlers,
} from "@/types";
import {
  isPluginActionPageShortcutAction,
  pluginActionPageFromShortcutAction,
} from "@/types";

import { normalizeKeyboardEvent } from "@/features/shortcuts/normalizeKeyboardEvent";

type Params = {
  bindings: KeybindingMap;
  handlers: ShortcutHandlers;
  disabled?: boolean;
  disabledWhen?: (event: KeyboardEvent) => boolean;
};

const isFrontendShortcutAction = (
  action: ShortcutAction,
): action is FrontendShortcutAction => {
  return action !== "toggleMainWindow";
};

const isFrontendStaticShortcutAction = (
  action: FrontendShortcutAction,
): action is FrontendStaticShortcutAction => {
  return !isPluginActionPageShortcutAction(action);
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  );
};

/**
 * Registers global keyboard shortcuts.
 *
 * This hook attaches a single `keydown` listener to the window
 * and dispatches keyboard events to the first matching shortcut binding.
 */
export const useShortcuts = ({
  bindings,
  handlers,
  disabled = false,
  disabledWhen,
}: Params) => {
  useEffect(() => {
    if (disabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (disabledWhen?.(event)) {
        return;
      }

      const pressed = normalizeKeyboardEvent(event);

      if (
        (pressed === "Home" || pressed === "End") &&
        isEditableTarget(event.target)
      ) {
        return;
      }

      const action = Object.entries(bindings).find(([, binding]) => {
        const keys = Array.isArray(binding) ? binding : [binding];
        return keys.includes(pressed);
      })?.[0] as ShortcutAction | undefined;

      if (!action || !isFrontendShortcutAction(action)) {
        return;
      }

      event.preventDefault();

      if (isPluginActionPageShortcutAction(action)) {
        handlers.openPluginActionPage(
          pluginActionPageFromShortcutAction(action),
        );
        return;
      }

      if (!isFrontendStaticShortcutAction(action)) {
        return;
      }

      const handler = handlers[action];

      if (typeof handler !== "function") {
        return;
      }

      handler();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [bindings, handlers, disabled, disabledWhen]);
};
