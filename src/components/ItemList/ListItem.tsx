import { Globe, FileText, FileCode, Settings, Star, Plug } from "lucide-react";

import { useI18nContext } from "@/i18n/I18nProvider";
import type { TranslationFunctions } from "@/i18n/i18n-types";
import { getInternalPageTitle } from "@/utils/internalPageTitle";
import { isPluginInternalPage } from "@/features/plugins/pluginRegistry";

import { IndexItem, SearchSnippet } from "@/types";

type Props = {
  item: IndexItem;
  snippets?: SearchSnippet[];
  isSelected: boolean;
  onClick: () => void;
  onSnippetClick?: (snippet: SearchSnippet) => void;
  compact?: boolean;
};

const getItemIcon = (item: IndexItem) => {
  if (item.preview.type === "external") {
    return Globe;
  }

  if (
    item.open?.type === "pluginAction" ||
    (item.preview.type === "internal" &&
      (item.preview.page === "plugin" ||
        isPluginInternalPage(item.preview.page)))
  ) {
    return Plug;
  }

  if (item.preview.type === "internal") {
    return Settings;
  }

  if (item.preview.type === "raw") {
    return FileCode;
  }

  return FileText;
};

const shouldShowDate = (item: IndexItem) => item.preview.type !== "internal";

const getItemSubtitle = (item: IndexItem) =>
  item.preview.type === "external" ? item.preview.url : (item.sourcePath ?? "");

const getSnippetLabel = (snippet: SearchSnippet, LL: TranslationFunctions) => {
  switch (snippet.source) {
    case "body":
      return LL.itemList.snippetSources.body();
    case "title":
      return LL.itemList.snippetSources.title();
    case "alias":
      return LL.itemList.snippetSources.alias();
    case "tag":
      return LL.itemList.snippetSources.tag();
  }
};

function formatRelativeTime(
  dateString: string,
  LL: TranslationFunctions,
): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffInDays === 0) return LL.itemList.today();
  if (diffInDays === 1) return LL.itemList.yesterday();
  return LL.itemList.daysAgo({ count: diffInDays });
}

export const ListItem = ({
  item,
  snippets,
  isSelected,
  onClick,
  onSnippetClick,
  compact,
}: Props) => {
  if (compact) {
    return (
      <CompactListItem item={item} isSelected={isSelected} onClick={onClick} />
    );
  }

  const { LL } = useI18nContext();

  const title =
    item.preview.type === "internal"
      ? getInternalPageTitle(item.preview.page, LL)
      : item.title;

  const Icon = getItemIcon(item);
  const subtitle = getItemSubtitle(item);
  const snippet = snippets?.[0];

  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 cursor-pointer border-b border-border-main/30 ${isSelected ? "bg-accent text-text-accent" : "text-text-muted"}`}
    >
      <div className="flex items-center gap-3">
        {/* icon & pin */}
        <div className="relative w-5 h-5 flex items-center justify-center shrink-0">
          <span className="text-lg opacity-80 leading-none">
            <Icon className="h-4 w-4 opacity-80" />
          </span>

          {item.metadata.star && (
            <Star className="absolute -top-1 -right-1 h-3 w-3 fill-current" />
          )}
        </div>

        {/* Content Area */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex justify-between items-baseline gap-2">
            <span
              className={`font-medium truncate ${isSelected ? "text-text-accent" : "text-text-main"}`}
            >
              {title}
            </span>
            {shouldShowDate(item) && (
              <span
                className={`text-[10px] whitespace-nowrap ${isSelected ? "opacity-80" : "opacity-40"}`}
              >
                {formatRelativeTime(item.updatedAt, LL)}
              </span>
            )}
          </div>

          {subtitle && (
            <span className="text-[10px] opacity-60 truncate mt-0.5">
              {subtitle}
            </span>
          )}

          {snippet && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSnippetClick?.(snippet);
              }}
              className={`mt-1.5 flex min-w-0 appearance-none items-baseline gap-1.5 border-0 bg-transparent p-0 text-left text-[11px] leading-snug ${
                isSelected ? "text-text-accent/90" : "text-text-muted"
              } ${snippet.chunk ? "cursor-pointer" : "cursor-default"}`}
            >
              <span
                className={`shrink-0 text-[9px] uppercase tracking-normal ${
                  isSelected ? "opacity-70" : "opacity-50"
                }`}
              >
                {getSnippetLabel(snippet, LL)}
              </span>
              <span className="line-clamp-2 min-w-0 break-words">
                {snippet.fragments.map((fragment, index) => (
                  <span
                    key={`${fragment.text}-${index}`}
                    className={
                      fragment.matched
                        ? isSelected
                          ? "font-semibold text-text-accent"
                          : "font-semibold text-text-main"
                        : undefined
                    }
                  >
                    {fragment.text}
                  </span>
                ))}
              </span>
            </button>
          )}

          {/* Tags */}
          {item.metadata.tags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-1.5">
              {item.metadata.tags.map((tag) => (
                <span
                  key={tag}
                  className={`text-[9px] px-1.5 py-0.5 rounded-sm ${
                    isSelected
                      ? "bg-black/20 text-text-accent"
                      : "bg-border-main/50 text-text-main/70"
                  }`}
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const CompactListItem = ({ item, isSelected, onClick }: Props) => {
  const { LL } = useI18nContext();

  const title =
    item.preview.type === "internal"
      ? getInternalPageTitle(item.preview.page, LL)
      : item.title;

  const Icon = getItemIcon(item);

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer border-b border-border-main/30 px-3 py-2 ${
        isSelected ? "bg-accent text-text-accent" : "text-text-muted"
      }`}
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <Icon className="h-4 w-4 shrink-0 opacity-80" />

        <div className="min-w-0 flex-1">
          <div
            className={`truncate text-sm font-medium ${
              isSelected ? "text-text-accent" : "text-text-main"
            }`}
          >
            {item.metadata.star && (
              <Star className="mr-1 inline h-3 w-3 fill-current" />
            )}
            {title}
          </div>
        </div>
      </div>
    </div>
  );
};
