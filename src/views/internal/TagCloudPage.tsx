import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownAZ,
  ListFilter,
  RefreshCw,
  Search,
  Tags,
} from "lucide-react";

import { statsApi } from "@/api/stats";
import { useI18nContext } from "@/i18n/I18nProvider";
import type { TagCloudEntry } from "@/types";

type SortMode = "count" | "name";

const getWeightClass = (count: number, maxCount: number) => {
  if (maxCount <= 1) {
    return "text-sm";
  }

  const ratio = count / maxCount;

  if (ratio >= 0.8) {
    return "text-2xl";
  }

  if (ratio >= 0.55) {
    return "text-xl";
  }

  if (ratio >= 0.3) {
    return "text-lg";
  }

  return "text-sm";
};

type Props = {
  onTagSelect: (tag: string) => void;
};

export const TagCloudPage = ({ onTagSelect }: Props) => {
  const { LL } = useI18nContext();
  const [tags, setTags] = useState<TagCloudEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("count");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTags = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const entries = await statsApi.getTagCloud();
      setTags(entries);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadTags();
  }, []);

  const maxCount = useMemo(
    () => tags.reduce((max, entry) => Math.max(max, entry.count), 0),
    [tags],
  );

  const taggedItemTotal = useMemo(
    () => tags.reduce((total, entry) => total + entry.count, 0),
    [tags],
  );

  const visibleTags = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase();
    const filtered = normalizedFilter
      ? tags.filter((entry) =>
          entry.tag.toLowerCase().includes(normalizedFilter),
        )
      : tags;

    return [...filtered].sort((a, b) => {
      if (sortMode === "name") {
        return a.tag.localeCompare(b.tag);
      }

      return b.count - a.count || a.tag.localeCompare(b.tag);
    });
  }, [filter, sortMode, tags]);

  return (
    <div className="h-full overflow-auto bg-main-bg">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-text-main">
              <Tags className="h-5 w-5 text-accent" />
              <h1 className="text-xl font-semibold">
                {LL.tagCloudPage.title()}
              </h1>
            </div>

            <div className="mt-2 flex flex-wrap gap-3 text-xs text-text-muted">
              <span>{LL.tagCloudPage.tags({ count: tags.length })}</span>
              <span>
                {LL.tagCloudPage.tagAssignments({ count: taggedItemTotal })}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSortMode((current) =>
                  current === "count" ? "name" : "count",
                );
              }}
              title={
                sortMode === "count"
                  ? LL.tagCloudPage.sortByName()
                  : LL.tagCloudPage.sortByCount()
              }
              aria-label={
                sortMode === "count"
                  ? LL.tagCloudPage.sortByName()
                  : LL.tagCloudPage.sortByCount()
              }
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-border-main text-text-muted hover:border-accent hover:bg-item-hover hover:text-text-main"
            >
              {sortMode === "count" ? (
                <ArrowDownAZ className="h-4 w-4" />
              ) : (
                <ListFilter className="h-4 w-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                void loadTags();
              }}
              disabled={isLoading}
              title={LL.common.reload()}
              aria-label={LL.common.reload()}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-border-main text-text-muted hover:border-accent hover:bg-item-hover hover:text-text-main disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={LL.tagCloudPage.filterPlaceholder()}
            className="h-9 w-full rounded border border-border-main bg-input-bg py-2 pr-3 pl-9 text-sm text-text-main outline-none placeholder:text-text-muted focus:border-accent"
          />
        </label>

        {error && (
          <div className="flex items-center gap-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {LL.tagCloudPage.loadError({ error })}
            </span>
          </div>
        )}

        {isLoading && tags.length === 0 ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 24 }, (_, index) => (
              <div
                key={index}
                className="h-8 w-20 animate-pulse rounded bg-border-main/40"
              />
            ))}
          </div>
        ) : visibleTags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {visibleTags.map((entry) => (
              <button
                type="button"
                key={entry.tag}
                onClick={() => onTagSelect(entry.tag)}
                title={LL.tagCloudPage.searchTag({ tag: entry.tag })}
                aria-label={LL.tagCloudPage.searchTag({ tag: entry.tag })}
                className={`inline-flex items-baseline gap-1 rounded border border-border-main bg-item-hover/40 px-2.5 py-1 text-text-main hover:border-accent hover:bg-item-hover focus:border-accent focus:outline-none ${getWeightClass(
                  entry.count,
                  maxCount,
                )}`}
              >
                <span>#{entry.tag}</span>
                <span className="text-[10px] text-text-muted">
                  {entry.count}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded border border-border-main px-4 py-8 text-center text-sm text-text-muted">
            {LL.tagCloudPage.empty()}
          </div>
        )}
      </div>
    </div>
  );
};
