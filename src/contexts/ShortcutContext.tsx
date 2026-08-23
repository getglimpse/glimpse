import {
  createContext,
  ReactNode,
  useContext,
  useMemo,
} from "react";

import { KeybindingMap, ShortcutAction } from "@/types";

type ShortcutContextValue = {
  keybindings: KeybindingMap;
};

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

type Props = {
  keybindings: KeybindingMap;
  children: ReactNode;
};

export const ShortcutProvider = ({ keybindings, children }: Props) => {
  const value = useMemo(
    () => ({ keybindings }),
    [keybindings],
  );

  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  );
};

export const useShortcutLabel = (
  action: ShortcutAction,
): string | null => {
  const context = useContext(ShortcutContext);

  if (!context) {
    return null;
  }

  const binding = context.keybindings[action];

  if (!binding) {
    return null;
  }

  const first = Array.isArray(binding) ? binding[0] : binding;

  if (!first) {
    return null;
  }

  return formatKeybindingLabel(first);
};

const formatKeybindingLabel = (binding: string): string => {
  return binding
    .split("+")
    .map((part) => {
      const key = part.trim();

      switch (key.toLowerCase()) {
        case "ctrl":
          return "Ctrl";
        case "meta":
          return "Meta";
        case "shift":
          return "Shift";
        case "alt":
          return "Alt";
        case "escape":
          return "Esc";
        case "arrowup":
          return "↑";
        case "arrowdown":
          return "↓";
        case "arrowleft":
          return "←";
        case "arrowright":
          return "→";
        case " ":
        case "space":
          return "Space";
        default:
          return key.length === 1 ? key.toUpperCase() : key;
      }
    })
    .join("+");
};
