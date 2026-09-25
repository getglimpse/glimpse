import { useEffect, useState, type ReactNode } from "react";
import {
  AlertCircle,
  CloudDownload,
  Download,
  ExternalLink,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openerApi } from "@/api/opener";
import {
  formatRemoteDownloadCount,
  formatRemoteRelativeDate,
  getRemotePluginReadmeUrl,
  resolvePluginReadmeLink,
  type RemotePluginInstallKind,
  type RemotePluginInstallState,
  type RemotePluginManagementState,
} from "@/features/plugins/remote/viewModel";
import type { TranslationFunctions } from "@/i18n/i18n-types";
import type { PluginRegistryEntry, PluginRegistryItem } from "@/types";
import {
  getRemotePluginActionLabel,
  getRemotePluginEnabledActionLabel,
  getRemotePluginStatusLabel,
  isRemotePluginActionDisabled,
  RemotePluginStatusBadge,
} from "./RemotePluginStatus";

const REMOTE_PLUGIN_README_MAX_LENGTH = 100_000;

export const RemotePluginDetail = ({
  entry,
  installedPlugin,
  conflictingInstalledPlugin,
  installKind,
  installState,
  managementState,
  error,
  LL,
  locale,
  onInstall,
  onEnabledChange,
  onUninstall,
  surface,
}: {
  entry: PluginRegistryEntry;
  installedPlugin?: PluginRegistryItem;
  conflictingInstalledPlugin?: PluginRegistryItem;
  installKind: RemotePluginInstallKind;
  installState?: RemotePluginInstallState;
  managementState?: RemotePluginManagementState;
  error?: string;
  LL: TranslationFunctions;
  locale: string;
  onInstall: () => void;
  onEnabledChange: (plugin: PluginRegistryItem, enabled: boolean) => void;
  onUninstall: (plugin: PluginRegistryItem) => void;
  surface: "inline" | "dialog";
}) => {
  const installDisabled = isRemotePluginActionDisabled(
    installKind,
    installState,
  );
  const managing = Boolean(managementState || installState);
  const installedPluginEnabled = Boolean(installedPlugin?.enabled);
  const statusLabel = getRemotePluginStatusLabel(
    LL,
    installKind,
    installState,
    Boolean(error),
  );
  const actionLabel = getRemotePluginActionLabel(LL, installKind, installState);
  const readmeUrl = getRemotePluginReadmeUrl(entry);
  const [readmeState, setReadmeState] = useState<{
    content: string;
    error: string | null;
    loading: boolean;
  }>({
    content: "",
    error: null,
    loading: false,
  });

  useEffect(() => {
    if (!readmeUrl) {
      setReadmeState({ content: "", error: null, loading: false });
      return;
    }

    let cancelled = false;

    setReadmeState({ content: "", error: null, loading: true });

    void fetch(readmeUrl, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const content = await response.text();

        if (content.length > REMOTE_PLUGIN_README_MAX_LENGTH) {
          throw new Error("readme too large");
        }

        if (!cancelled) {
          setReadmeState({ content, error: null, loading: false });
        }
      })
      .catch((readmeError) => {
        if (!cancelled) {
          setReadmeState({
            content: "",
            error:
              readmeError instanceof Error &&
              readmeError.message === "readme too large"
                ? LL.pluginPage.remote.readmeTooLarge()
                : LL.pluginPage.remote.readmeLoadError(),
            loading: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [LL, readmeUrl]);

  const repositoryUrl = entry.repositoryUrl;
  const hasReadmeContent = readmeState.content.trim().length > 0;
  const downloadCountLabel =
    typeof entry.downloadCount === "number"
      ? formatRemoteDownloadCount(entry.downloadCount, locale)
      : "-";

  return (
    <aside
      className={
        surface === "inline"
          ? "min-w-0 rounded-md border border-border-main bg-main-bg p-4 @min-[760px]:h-full @min-[760px]:min-h-0 @min-[760px]:overflow-y-auto"
          : "min-w-0"
      }
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <h3 className="text-base font-semibold text-text-main">
            {entry.name}
          </h3>
          <RemotePluginStatusBadge
            failed={Boolean(error)}
            installKind={installKind}
            label={statusLabel}
          />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          {entry.author && <span>{entry.author}</span>}
          {entry.author && <span aria-hidden="true">|</span>}
          <span
            aria-label={`${LL.pluginPage.remote.downloads()}: ${downloadCountLabel}`}
            className="inline-flex items-center gap-1"
          >
            <CloudDownload size={13} aria-hidden="true" />
            <span>{downloadCountLabel}</span>
          </span>
        </div>
      </div>

      <div className="mt-3 space-y-1.5 border-y border-border-main/70 py-3 text-xs">
        <RemotePluginMetadataLine
          label={LL.pluginPage.remote.version()}
          value={entry.version}
        />

        {repositoryUrl && (
          <RemotePluginMetadataLine
            label={LL.pluginPage.remote.repository()}
            value={
              <button
                type="button"
                onClick={() => {
                  openRemotePluginLink(repositoryUrl);
                }}
                className="inline-flex min-w-0 items-center gap-1 text-left text-text-main hover:text-accent"
              >
                <ExternalLink size={13} aria-hidden="true" />
                <span className="break-all">{repositoryUrl}</span>
              </button>
            }
          />
        )}

        {entry.releaseDate && (
          <RemotePluginMetadataLine
            label={LL.pluginPage.remote.lastUpdated()}
            value={formatRemoteRelativeDate(entry.releaseDate, locale)}
          />
        )}

        {entry.category && (
          <RemotePluginMetadataLine
            label={LL.pluginPage.remote.category()}
            value={
              <span className="rounded border border-border-main px-1.5 py-0.5 text-[11px] text-text-main">
                {entry.category}
              </span>
            }
          />
        )}
      </div>

      {entry.description && (
        <p className="mt-4 whitespace-pre-line text-sm leading-6 text-text-main">
          {entry.description}
        </p>
      )}

      {conflictingInstalledPlugin && (
        <div className="mt-4 rounded-md border border-border-main bg-main-bg p-3 text-xs text-text-muted">
          {LL.pluginPage.remote.localConflict({
            pluginId: conflictingInstalledPlugin.id,
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {(installKind === "not-installed" ||
          installKind === "update-available" ||
          (!installedPlugin && installKind === "unsupported")) && (
          <button
            type="button"
            onClick={onInstall}
            disabled={installDisabled}
            className="inline-flex min-h-9 min-w-28 items-center justify-center gap-2 rounded border border-border-main px-3 py-1.5 text-xs text-text-main hover:border-accent disabled:text-text-muted disabled:opacity-70"
          >
            <Download size={14} aria-hidden="true" />
            {actionLabel}
          </button>
        )}

        {installedPlugin && (
          <>
            <button
              type="button"
              onClick={() => {
                onEnabledChange(installedPlugin, !installedPluginEnabled);
              }}
              disabled={managing}
              className="inline-flex min-h-9 min-w-28 items-center justify-center rounded border border-border-main px-3 py-1.5 text-xs text-text-main hover:border-accent disabled:text-text-muted disabled:opacity-70"
            >
              {getRemotePluginEnabledActionLabel(
                LL,
                installedPlugin,
                managementState,
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                onUninstall(installedPlugin);
              }}
              disabled={managing}
              className="inline-flex min-h-9 min-w-28 items-center justify-center rounded border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:text-red-200 disabled:text-text-muted disabled:opacity-70"
            >
              {managementState === "uninstalling"
                ? LL.pluginPage.remote.uninstalling()
                : LL.pluginPage.remote.uninstall()}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 text-xs text-red-300">
          <AlertCircle size={14} aria-hidden="true" className="mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {readmeUrl && (
        <section className="mt-6 border-t border-border-main/70 pt-4">
          <h4 className="text-xs font-medium text-text-main">
            {LL.pluginPage.remote.readme()}
          </h4>

          {readmeState.loading && (
            <div className="mt-3 text-xs text-text-muted">
              {LL.pluginPage.remote.readmeLoading()}
            </div>
          )}

          {readmeState.error && (
            <div className="mt-3 text-xs text-red-300">{readmeState.error}</div>
          )}

          {hasReadmeContent && (
            <PluginReadmeMarkdown
              content={readmeState.content}
              baseUrl={readmeUrl}
            />
          )}
        </section>
      )}
    </aside>
  );
};

const RemotePluginMetadataLine = ({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) => (
  <div className="grid min-w-0 gap-1 min-[520px]:grid-cols-[7.5rem_minmax(0,1fr)]">
    <div className="text-text-muted">{label}</div>
    <div className="min-w-0 text-text-main">{value}</div>
  </div>
);

const PluginReadmeMarkdown = ({
  content,
  baseUrl,
}: {
  content: string;
  baseUrl?: string;
}) => (
  <div
    className="
      prose prose-sm mt-3 max-w-none select-text break-words text-sm
      [--tw-prose-body:var(--text-main)]
      [--tw-prose-headings:var(--text-main)]
      [--tw-prose-links:var(--accent)]
      [--tw-prose-bold:var(--text-main)]
      [--tw-prose-counters:var(--text-muted)]
      [--tw-prose-bullets:var(--text-muted)]
      [--tw-prose-hr:var(--border)]
      [--tw-prose-quotes:var(--text-main)]
      [--tw-prose-quote-borders:var(--accent)]
      [--tw-prose-code:var(--text-main)]
      [--tw-prose-pre-code:var(--text-main)]
      [--tw-prose-pre-bg:var(--main-bg)]
      prose-headings:mt-4 prose-headings:mb-2
      prose-p:my-2 prose-li:text-text-main
      prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-main-bg prose-a:text-accent
    "
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const resolvedHref = resolvePluginReadmeLink(href, baseUrl);

          return (
            <button
              type="button"
              onClick={() => {
                if (resolvedHref) {
                  openRemotePluginLink(resolvedHref);
                }
              }}
              disabled={!resolvedHref}
              className="text-left text-accent hover:underline disabled:text-text-muted"
            >
              {children}
            </button>
          );
        },
        img: ({ alt }) =>
          alt ? <span className="text-text-muted">{alt}</span> : null,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

const openRemotePluginLink = (url: string) => {
  void openerApi.openExternalUrl(url).catch((openError) => {
    console.warn("Failed to open plugin detail URL:", openError);
  });
};
