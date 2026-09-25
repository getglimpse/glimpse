import type { ReactNode } from "react";
import { FolderOpen, RefreshCw, Search } from "lucide-react";
import { pluginsApi } from "@/api/plugins";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TranslationFunctions } from "@/i18n/i18n-types";

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

export const InstalledPluginSearchActions = ({
  LL,
  onReloadAll,
  reloadingAll,
}: {
  LL: TranslationFunctions;
  onReloadAll: () => void;
  reloadingAll: boolean;
}) => (
  <div className="flex items-center justify-end gap-2">
    <button
      type="button"
      onClick={() => {
        void pluginsApi.openFolder();
      }}
      aria-label={LL.pluginPage.installed.openFolder()}
      title={LL.pluginPage.installed.openFolder()}
      className="inline-flex size-9 items-center justify-center rounded border border-border-main text-text-muted hover:text-text-main"
    >
      <FolderOpen size={16} aria-hidden="true" />
    </button>
    <button
      type="button"
      onClick={onReloadAll}
      disabled={reloadingAll}
      aria-label={LL.pluginPage.installed.reloadAll()}
      title={LL.pluginPage.installed.reloadAll()}
      className="inline-flex size-9 items-center justify-center rounded border border-border-main text-text-muted hover:text-text-main disabled:opacity-50"
    >
      <RefreshCw
        size={16}
        aria-hidden="true"
        className={reloadingAll ? "animate-spin" : undefined}
      />
    </button>
  </div>
);

export const LocalPluginInstallDialog = ({
  canInstall,
  draggingPluginFolder,
  installSourcePath,
  installSourcePaths,
  installing,
  LL,
  managementMessage,
  onInstall,
  onOpenChange,
  onSourcePathChange,
  open,
  renderSelectedInstallPaths,
}: {
  canInstall: boolean;
  draggingPluginFolder: boolean;
  installSourcePath: string;
  installSourcePaths: string[];
  installing: boolean;
  LL: TranslationFunctions;
  managementMessage: string | null;
  onInstall: () => void;
  onOpenChange: (open: boolean) => void;
  onSourcePathChange: (value: string) => void;
  open: boolean;
  renderSelectedInstallPaths: () => ReactNode;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{LL.pluginPage.installed.localInstall()}</DialogTitle>
        <DialogDescription>
          {LL.pluginPage.installed.installReplaceHint()}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <button
          type="button"
          disabled={installing}
          onClick={onInstall}
          className={`flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-5 text-center transition-colors disabled:opacity-50 ${
            draggingPluginFolder
              ? "border-accent bg-item-hover text-text-main"
              : "border-border-main text-text-muted hover:border-accent hover:text-text-main"
          }`}
        >
          <span className="text-sm font-medium text-text-main">
            {installing
              ? LL.pluginPage.installed.installing()
              : LL.pluginPage.installed.install()}
          </span>
          <span className="max-w-xl text-xs">
            {LL.pluginPage.installed.installDropHint()}
          </span>
          {renderSelectedInstallPaths()}
        </button>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <textarea
            value={installSourcePath}
            onChange={(event) => {
              onSourcePathChange(event.target.value);
            }}
            placeholder={LL.pluginPage.installed.installPlaceholder()}
            rows={Math.min(Math.max(installSourcePaths.length, 1), 4)}
            className="min-h-8 resize-y rounded border border-border-main bg-transparent px-2 py-1.5 text-xs text-text-main placeholder:text-text-muted"
          />
          <button
            type="button"
            disabled={!canInstall}
            onClick={onInstall}
            className="rounded border border-border-main px-2 py-1 text-xs text-text-muted hover:text-text-main disabled:opacity-50"
          >
            {installing
              ? LL.pluginPage.installed.installing()
              : LL.pluginPage.installed.install()}
          </button>
        </div>

        {managementMessage && (
          <div className="whitespace-pre-line text-xs text-text-muted">
            {managementMessage}
          </div>
        )}
      </div>
    </DialogContent>
  </Dialog>
);
