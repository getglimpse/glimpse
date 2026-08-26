import { useEffect } from "react";

const STARTUP_THEME_STORAGE_KEY = "glimpse:theme";

/**
 * Applies the selected CSS theme to the document root.
 *
 * Theme colors are defined in CSS using:
 *
 * ```css
 * [data-theme="nord"] {
 *   --app-bg: ...;
 * }
 * ```
 */
export const useTheme = (themeId: string) => {
  useEffect(() => {
    document.documentElement.dataset.theme = themeId;
    localStorage.setItem(STARTUP_THEME_STORAGE_KEY, themeId);
  }, [themeId]);
};

export const getStoredStartupTheme = () => {
  try {
    const themeId = localStorage.getItem(STARTUP_THEME_STORAGE_KEY);

    return themeId && /^[a-z0-9-]+$/.test(themeId) ? themeId : "nord";
  } catch {
    return "nord";
  }
};
