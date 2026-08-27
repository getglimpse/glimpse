import { useEffect, useMemo, useState } from "react";
import { Command, EyeOff, Hash, RefreshCw, Slash, X } from "lucide-react";
import { toast } from "@/utils/toast";

import { indexingApi } from "@/api/indexing";
import { statsApi } from "@/api/stats";
import {
  buildSearchInputFromDisplay,
  commitActiveTag,
  completeActiveTag,
  getTagCompletion,
  getSearchBarViewModel,
  removeCommittedTagAt,
  removeHiddenFilter,
  removeInternalFilter,
  removePluginPlaygroundFilter,
  sortTagSuggestions,
} from "@/features/search/searchBarViewModel";
import { useI18nContext } from "@/i18n/I18nProvider";
import { Badge } from "@/components/ui/badge";

type Props = {
  value: string;
  onChange: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFullScanCompleted?: () => Promise<void> | void;
};

export const SearchBar = ({
  value,
  onChange,
  inputRef,
  onFullScanCompleted,
}: Props) => {
  const { LL } = useI18nContext();
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const { displayValue, committedTags, hidden, internal, pluginPlayground } =
    getSearchBarViewModel(value);
  const tagCompletion = useMemo(
    () =>
      getTagCompletion({
        displayValue,
        committedTags,
        availableTags,
      }),
    [availableTags, committedTags, displayValue],
  );

  const loadTagSuggestions = async () => {
    try {
      const entries = await statsApi.getTagCloud();
      setAvailableTags(sortTagSuggestions(entries));
    } catch (error) {
      console.error("Failed to load tag suggestions:", error);
    }
  };

  useEffect(() => {
    void loadTagSuggestions();
  }, []);

  const handleFullScan = async () => {
    try {
      await indexingApi.fullScan();
      await loadTagSuggestions();
      await onFullScanCompleted?.();
      toast.success(LL.searchBar.indexRefreshed());
    } catch (error) {
      console.error(error);
      toast.error(LL.searchBar.refreshIndexFailed());
    }
  };

  const handleDisplayChange = (nextDisplayValue: string) => {
    onChange(buildSearchInputFromDisplay(value, nextDisplayValue));
  };

  const handleRemoveTag = (tagIndex: number) => {
    onChange(removeCommittedTagAt(value, tagIndex));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleRemoveHidden = () => {
    onChange(removeHiddenFilter(value));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleRemoveInternal = () => {
    onChange(removeInternalFilter(value));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleRemovePluginPlayground = () => {
    onChange(removePluginPlaygroundFilter(value));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      tagCompletion &&
      (event.key === "Tab" || event.key === " " || event.code === "Space")
    ) {
      event.preventDefault();
      onChange(
        buildSearchInputFromDisplay(
          value,
          completeActiveTag(displayValue, tagCompletion.tag),
        ),
      );
      return;
    }

    if (event.key === "Tab") {
      const nextDisplayValue = commitActiveTag(displayValue);

      if (nextDisplayValue) {
        event.preventDefault();
        onChange(buildSearchInputFromDisplay(value, nextDisplayValue));
        return;
      }
    }

    if (
      event.key === "Backspace" &&
      displayValue.length === 0 &&
      committedTags.length > 0
    ) {
      event.preventDefault();
      onChange(removeCommittedTagAt(value, committedTags.length - 1));
      return;
    }

    if (event.key === "Backspace" && displayValue.length === 0 && internal) {
      event.preventDefault();
      onChange(removeInternalFilter(value));
      return;
    }

    if (
      event.key === "Backspace" &&
      displayValue.length === 0 &&
      pluginPlayground
    ) {
      event.preventDefault();
      onChange(removePluginPlaygroundFilter(value));
      return;
    }

    if (event.key === "Backspace" && displayValue.length === 0 && hidden) {
      event.preventDefault();
      onChange(removeHiddenFilter(value));
    }
  };

  return (
    <header
      className="flex-none pl-5 pr-4 pt-3 pb-3 bg-header-bg border-b border-border-main"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-3">
        <div
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          data-tauri-drag-region="false"
        >
          {hidden && (
            <Badge
              variant="outline"
              className="h-7 rounded-md border-primary/40 bg-primary/10 px-2.5 text-sm font-medium text-text-main"
              title="Hidden filter"
            >
              <EyeOff size={13} aria-hidden="true" />
              <span>hidden</span>
              <button
                type="button"
                className="-mr-1 flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-item-hover hover:text-text-main focus:outline-none"
                aria-label="Remove hidden filter"
                onClick={handleRemoveHidden}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </Badge>
          )}

          {internal && (
            <Badge
              variant="outline"
              className="h-7 rounded-md border-primary/40 bg-primary/10 px-2.5 text-sm font-medium text-text-main"
              title="Internal search"
            >
              <Command size={13} aria-hidden="true" />
              <span>internal</span>
              <button
                type="button"
                className="-mr-1 flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-item-hover hover:text-text-main focus:outline-none"
                aria-label="Remove internal search"
                onClick={handleRemoveInternal}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </Badge>
          )}

          {pluginPlayground && (
            <Badge
              variant="outline"
              className="h-7 rounded-md border-primary/40 bg-primary/10 px-2.5 text-sm font-medium text-text-main"
              title="Plugin playground search"
            >
              <Slash size={13} aria-hidden="true" />
              <span>playground</span>
              <button
                type="button"
                className="-mr-1 flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-item-hover hover:text-text-main focus:outline-none"
                aria-label="Remove plugin playground search"
                onClick={handleRemovePluginPlayground}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </Badge>
          )}

          {committedTags.map((tag, index) => (
            <Badge
              key={`${tag}:${index}`}
              variant="outline"
              className="h-7 rounded-md border-primary/40 bg-primary/10 px-2.5 text-sm font-medium text-text-main"
              title={`Tag filter: #${tag}`}
            >
              <Hash size={13} aria-hidden="true" />
              <span>{tag}</span>
              <button
                type="button"
                className="-mr-1 flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-item-hover hover:text-text-main focus:outline-none"
                aria-label={`Remove tag filter #${tag}`}
                onClick={() => handleRemoveTag(index)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </Badge>
          ))}

          <div className="relative min-w-32 flex-1">
            {tagCompletion && (
              <div className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-2xl font-light">
                <span className="whitespace-pre text-transparent">
                  {displayValue}
                </span>
                <span className="whitespace-pre text-placeholder">
                  {tagCompletion.suffix}
                </span>
              </div>
            )}

            <input
              autoFocus
              ref={inputRef}
              className="relative z-10 w-full bg-transparent text-2xl font-light outline-none placeholder:text-placeholder"
              placeholder={
                committedTags.length > 0 ||
                hidden ||
                internal ||
                pluginPlayground
                  ? ""
                  : LL.searchBar.placeholder()
              }
              value={displayValue}
              onChange={(e) => handleDisplayChange(e.target.value)}
              onKeyDown={handleKeyDown}
              data-tauri-drag-region="false"
            />
          </div>
        </div>

        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-hover-bg hover:text-text-main focus:outline-none"
          title={LL.searchBar.fullScan()}
          onClick={handleFullScan}
          data-tauri-drag-region="false"
        >
          <RefreshCw size={18} />
        </button>
      </div>
    </header>
  );
};
