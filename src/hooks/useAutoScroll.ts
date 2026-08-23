import { useEffect } from "react";

/**
 * Automatically scrolls the item list so that
 * the currently selected item is positioned
 * near the vertical center of the viewport.
 *
 * This hook is primarily used by the search result list
 * to keep keyboard navigation comfortable while moving
 * through items with arrow keys.
 *
 * Behavior:
 *
 * - Runs whenever `selectedIndex` changes.
 * - Calculates the target scroll position based on the
 *   selected element's offset and height.
 * - Scrolls immediately without animation.
 *
 * @param listRef Reference to the scrollable list container.
 * @param selectedIndex Currently selected item index.
 */
export const useAutoScroll = (
  listRef: React.RefObject<HTMLDivElement | null>,
  selectedIndex: number,
) => {
  useEffect(() => {
    const listElement = listRef.current;

    if (!listElement) return;

    const selectedElement = listElement.children[selectedIndex] as HTMLElement;

    if (!selectedElement) return;

    // Center the selected item within the viewport.
    const target =
      selectedElement.offsetTop -
      listElement.clientHeight / 2 +
      selectedElement.clientHeight / 2;

    listElement.scrollTo({
      top: Math.max(0, target),
      behavior: "auto",
    });
  }, [selectedIndex]);
};