import type { ReactNode } from "react";
import { AlertCircle, RefreshCw, Search } from "lucide-react";
import type { TranslationFunctions } from "@/i18n/i18n-types";
import type { PluginRegistryEntry } from "@/types";
import type {
  RemotePluginInstallKind,
  RemotePluginInstallState,
} from "@/features/plugins/remote/viewModel";
import {
  getRemotePluginStatusLabel,
  RemotePluginStatusBadge,
} from "./RemotePluginStatus";

export const PluginSearchControls = ({
  actions,
  onChange,
  placeholder,
  value,
}: {
  actions?: ReactNode;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) => (
  <div
    className={
      actions ? "grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" : undefined
    }
  >
    <div className="relative">
      <Search
        size={15}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        aria-label={placeholder}
        placeholder={placeholder}
        className="h-9 w-full rounded border border-border-main bg-transparent pl-8 pr-3 text-sm text-text-main outline-none placeholder:text-text-muted focus:border-accent"
      />
    </div>
    {actions}
  </div>
);

export const RemotePluginSearchActions = ({
  LL,
  loading,
  onRefresh,
}: {
  LL: TranslationFunctions;
  loading: boolean;
  onRefresh: () => void;
}) => (
  <button
    type="button"
    onClick={onRefresh}
    disabled={loading}
    aria-label={LL.pluginPage.remote.refresh()}
    title={LL.pluginPage.remote.refresh()}
    className="inline-flex size-9 items-center justify-center rounded border border-border-main text-text-muted hover:text-text-main disabled:opacity-50"
  >
    <RefreshCw
      size={16}
      aria-hidden="true"
      className={loading ? "animate-spin" : undefined}
    />
  </button>
);

export const RemotePluginCatalogRow = ({
  entry,
  installKind,
  installState,
  error,
  LL,
  selected,
  onSelect,
}: {
  entry: PluginRegistryEntry;
  installKind: RemotePluginInstallKind;
  installState?: RemotePluginInstallState;
  error?: string;
  LL: TranslationFunctions;
  selected: boolean;
  onSelect: () => void;
}) => {
  const statusLabel = getRemotePluginStatusLabel(
    LL,
    installKind,
    installState,
    Boolean(error),
  );

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={LL.pluginPage.remote.openDetails({ name: entry.name })}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        onSelect();
      }}
      className={`border-b border-border-main/60 px-3 py-3 outline-none last:border-b-0 hover:bg-item-hover focus:bg-item-hover ${
        selected ? "bg-item-hover" : ""
      }`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 font-medium text-text-main">
            {entry.name}
          </span>
          <span className="text-xs text-text-muted">v{entry.version}</span>
          <RemotePluginStatusBadge
            failed={Boolean(error)}
            installKind={installKind}
            label={statusLabel}
          />
        </div>

        {entry.description && (
          <p className="line-clamp-1 text-sm text-text-muted">
            {entry.description}
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-300">
            <AlertCircle size={14} aria-hidden="true" className="mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </article>
  );
};
