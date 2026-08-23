import { useEffect } from "react";

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
  }, [themeId]);
};