/**
 * Loaded custom CSS theme.
 *
 * A custom theme corresponds to one CSS file under:
 *
 * ```text
 * <app_data_dir>/themes/
 * ```
 */
export type CssTheme = {
  /**
   * Stable theme identifier.
   *
   * Example:
   *
   * ```text
   * tokyo-night.css → "tokyo-night"
   * ```
   */
  id: string;

  /**
   * User-visible theme name.
   *
   * Example:
   *
   * ```text
   * "Tokyo Night"
   * ```
   */
  name: string;

  /**
   * Raw CSS content.
   */
  css: string;
};