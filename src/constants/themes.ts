export type ThemeOption = {
  id: string;
  name: string;
  source: "built-in" | "custom";
};

export const BUILT_IN_THEMES: ThemeOption[] = [
  {
    id: "dark",
    name: "Glimpse Dark",
    source: "built-in",
  },
  {
    id: "nord",
    name: "Nordic Blue",
    source: "built-in",
  },
  {
    id: "sepia",
    name: "Paper Focus",
    source: "built-in",
  },
];