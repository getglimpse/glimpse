import { useEffect } from "react";

import { CssTheme } from "@/types";

const CUSTOM_THEMES_STYLE_ID = "glimpse-custom-themes";

export const useCustomThemeStyles = (themes: CssTheme[]) => {
  useEffect(() => {
    document.getElementById(CUSTOM_THEMES_STYLE_ID)?.remove();

    if (themes.length === 0) {
      return;
    }

    const style = document.createElement("style");

    style.id = CUSTOM_THEMES_STYLE_ID;
    style.textContent = themes.map((theme) => theme.css).join("\n\n");

    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, [themes]);
};