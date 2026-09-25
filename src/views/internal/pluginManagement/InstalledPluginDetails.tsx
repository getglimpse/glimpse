import { Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { TranslationFunctions } from "@/i18n/i18n-types";
import type { PluginRegistryItem } from "@/types";
import { PluginReadmeMarkdown, usePluginReadme } from "./PluginReadme";

export const InstalledPluginRow = ({
  plugin,
  selected,
  onSelect,
}: {
  plugin: PluginRegistryItem;
  selected: boolean;
  onSelect: () => void;
}) => (
  <article
    role="button"
    tabIndex={0}
    aria-label={plugin.name}
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
          {plugin.name}
        </span>
        <span className="text-xs text-text-muted">v{plugin.version}</span>
        <span
          className={`rounded border px-1.5 py-0.5 text-[11px] ${
            plugin.enabled
              ? "border-accent/50 text-accent"
              : "border-border-main text-text-muted"
          }`}
        >
          {plugin.enabled ? "ON" : "OFF"}
        </span>
      </div>

      <code className="block truncate text-xs text-text-muted">
        {plugin.id}
      </code>

      {plugin.description && (
        <p className="line-clamp-1 text-sm text-text-muted">
          {plugin.description}
        </p>
      )}
    </div>
  </article>
);

export const InstalledPluginDetail = ({
  plugin,
  trusting,
  uninstalling,
  LL,
  onEnabledChange,
  onUninstall,
}: {
  plugin: PluginRegistryItem;
  trusting: boolean;
  uninstalling: boolean;
  LL: TranslationFunctions;
  onEnabledChange: (enabled: boolean) => void;
  onUninstall: () => void;
}) => {
  const readmeState = usePluginReadme(plugin.id, LL);
  const hasReadmeContent = readmeState.content.trim().length > 0;

  return (
    <aside
      data-testid="installed-plugin-detail"
      className="min-w-0 rounded-md border border-border-main bg-main-bg p-4 @min-[760px]:h-full @min-[760px]:min-h-0 @min-[760px]:overflow-y-auto"
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <h2 className="min-w-0 text-base font-medium text-text-main">
              {plugin.name}
            </h2>
            <code className="break-all rounded border border-border-main px-1.5 py-0.5 text-xs text-text-muted">
              {plugin.id}
            </code>
            <span className="text-xs text-text-muted">v{plugin.version}</span>
          </div>

          {plugin.description && (
            <p className="mt-1 text-text-muted">{plugin.description}</p>
          )}
        </div>

        <PluginManagementActions
          plugin={plugin}
          trusting={trusting}
          uninstalling={uninstalling}
          LL={LL}
          onEnabledChange={onEnabledChange}
          onUninstall={onUninstall}
        />
      </div>

      {(readmeState.loading || readmeState.error || hasReadmeContent) && (
        <section className="mt-4 border-t border-border-main/70 pt-3">
          <h3 className="text-xs font-medium text-text-main">
            {LL.pluginPage.installed.readme()}
          </h3>

          {readmeState.loading && (
            <div className="mt-3 text-xs text-text-muted">
              {LL.pluginPage.installed.readmeLoading()}
            </div>
          )}

          {readmeState.error && (
            <div className="mt-3 text-xs text-red-300">{readmeState.error}</div>
          )}

          {hasReadmeContent && (
            <PluginReadmeMarkdown content={readmeState.content} />
          )}
        </section>
      )}
    </aside>
  );
};

const PluginManagementActions = ({
  plugin,
  trusting,
  uninstalling,
  LL,
  onEnabledChange,
  onUninstall,
}: {
  plugin: PluginRegistryItem;
  trusting: boolean;
  uninstalling: boolean;
  LL: TranslationFunctions;
  onEnabledChange: (enabled: boolean) => void;
  onUninstall: () => void;
}) => (
  <div className="flex flex-wrap items-center gap-3 justify-self-start sm:justify-end">
    <label className="flex items-center gap-2">
      <span className="text-xs text-text-muted">
        {plugin.enabled
          ? LL.pluginPage.pluginRow.on()
          : LL.pluginPage.pluginRow.off()}
      </span>
      <Switch
        checked={plugin.enabled}
        onCheckedChange={onEnabledChange}
        disabled={trusting}
        aria-label={LL.pluginPage.pluginRow.toggleLabel({
          name: plugin.name,
        })}
      />
    </label>
    <button
      type="button"
      onClick={onUninstall}
      disabled={uninstalling}
      aria-label={LL.pluginPage.pluginRow.uninstall()}
      title={LL.pluginPage.pluginRow.uninstall()}
      className="inline-flex size-8 items-center justify-center rounded border border-red-500/40 text-red-300 hover:text-red-200 disabled:opacity-50"
    >
      <Trash2 size={15} aria-hidden="true" />
    </button>
  </div>
);

export const PluginCard = ({
  plugin,
  trusting,
  uninstalling,
  LL,
  onEnabledChange,
  onUninstall,
}: {
  plugin: PluginRegistryItem;
  trusting: boolean;
  uninstalling: boolean;
  LL: TranslationFunctions;
  onEnabledChange: (enabled: boolean) => void;
  onUninstall: () => void;
}) => {
  const readmeState = usePluginReadme(plugin.id, LL);
  const hasReadmeContent = readmeState.content.trim().length > 0;

  return (
    <article className="rounded-md border border-border-main bg-main-bg p-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <span className="min-w-0 text-base font-medium text-text-main">
              {plugin.name}
            </span>
            <code className="break-all rounded border border-border-main px-1.5 py-0.5 text-xs text-text-muted">
              {plugin.id}
            </code>
            <span className="text-xs text-text-muted">v{plugin.version}</span>
          </div>

          {plugin.description && (
            <p className="mt-1 truncate text-text-muted">
              {plugin.description}
            </p>
          )}
        </div>

        <PluginManagementActions
          plugin={plugin}
          trusting={trusting}
          uninstalling={uninstalling}
          LL={LL}
          onEnabledChange={onEnabledChange}
          onUninstall={onUninstall}
        />
      </div>

      {(readmeState.loading || readmeState.error || hasReadmeContent) && (
        <details className="mt-4 border-t border-border-main/70 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-text-main marker:text-text-muted">
            {LL.pluginPage.installed.readme()}
          </summary>

          {readmeState.loading && (
            <div className="mt-3 text-xs text-text-muted">
              {LL.pluginPage.installed.readmeLoading()}
            </div>
          )}

          {readmeState.error && (
            <div className="mt-3 text-xs text-red-300">{readmeState.error}</div>
          )}

          {hasReadmeContent && (
            <PluginReadmeMarkdown content={readmeState.content} />
          )}
        </details>
      )}
    </article>
  );
};
