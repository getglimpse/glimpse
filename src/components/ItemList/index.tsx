import { useEffect, useRef } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";

import { IndexItem, SearchResult, SearchSnippet } from "@/types";
import { EmptyState } from "./EmptyState";
import { ListItem } from "./ListItem";

type Props = {
  items: IndexItem[];
  results?: SearchResult[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  onSnippetClick?: (index: number, snippet: SearchSnippet) => void;
  isEmpty?: boolean;
  isLoading?: boolean;
  compact?: boolean;
  layout?: "launcher" | "sidebar";
};

export const ItemList = ({
  items,
  results,
  selectedIndex,
  onSelect,
  onSnippetClick,
  isEmpty,
  isLoading,
  compact,
  layout,
}: Props) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  useEffect(() => {
    if (items.length === 0) return;

    virtuosoRef.current?.scrollToIndex({
      index: selectedIndex,
      align: "center",
      behavior: "auto",
    });
  }, [selectedIndex, items.length]);

  return (
    <aside
      className={
        layout === "launcher"
          ? "flex-1 overflow-hidden bg-sidebar-bg"
          : "w-80 flex-none border-r border-border-main overflow-hidden bg-sidebar-bg"
      }
    >
      {isEmpty ? (
        <EmptyState isLoading={isLoading} />
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          className="h-full"
          data={items}
          itemContent={(index, item) => (
            <ListItem
              item={item}
              score={results?.[index]?.score}
              snippets={results?.[index]?.snippets}
              isSelected={index === selectedIndex}
              onClick={() => onSelect(index)}
              onSnippetClick={(snippet) => onSnippetClick?.(index, snippet)}
              compact={compact}
            />
          )}
        />
      )}
    </aside>
  );
};
