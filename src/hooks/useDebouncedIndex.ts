import { useEffect, useRef, useState } from "react";

/**
 * Returns a debounced index value for preview rendering.
 *
 * This hook delays updates to the displayed index in order to
 * reduce excessive preview re-renders while the user rapidly
 * navigates search results with keyboard shortcuts.
 *
 * Two update modes are supported:
 *
 * - debounce mode:
 *   Updates the displayed index after the specified delay.
 *
 * - immediate mode:
 *   Updates instantly without waiting for the debounce timer.
 *
 * Typical use cases:
 *
 * - search result preview
 * - markdown preview rendering
 * - expensive preview components
 *
 * @param selectedIndex Current selected item index.
 * @param delay Debounce delay in milliseconds.
 * @param immediate If true, bypasses debounce and updates immediately.
 *
 * @returns The index used for rendering the preview.
 *
 * @example
 * ```ts
 * const displayIndex = useDebouncedIndex(
 *   selectedIndex,
 *   50,
 *   isSearching
 * );
 * ```
 */
export const useDebouncedIndex = (
  selectedIndex: number,
  delay: number,
  immediate = false,
) => {
  const [displayIndex, setDisplayIndex] = useState(selectedIndex);
  const timer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // -----------------------------
    // immediate mode
    // -----------------------------

    if (immediate) {
      if (timer.current) {
        clearTimeout(timer.current);
      }

      setDisplayIndex(selectedIndex);
      return;
    }

    // -----------------------------
    // debounce mode
    // -----------------------------

    if (timer.current) {
      clearTimeout(timer.current);
    }

    timer.current = setTimeout(() => {
      setDisplayIndex(selectedIndex);
    }, delay);

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [selectedIndex, delay, immediate]);

  return displayIndex;
};