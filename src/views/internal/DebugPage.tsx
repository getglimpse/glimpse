import { useEffect, useState } from "react";

import { commandLogsApi } from "@/api/commandLogs";
import { indexingApi } from "@/api/indexing";
import { statsApi } from "@/api/stats";

import { DebugRow } from "./debug/components/DebugRow";
import { DebugSection } from "./debug/components/DebugSection";
import { CommandExecutionLogList } from "./debug/components/CommandExecutionLogList";

import { useI18nContext } from "@/i18n/I18nProvider";
import { AppStats, CommandExecutionLog, IndexingStatusResponse } from "@/types";

export const DebugPage = () => {
  const { LL } = useI18nContext();

  const [stats, setStats] = useState<AppStats | null>(null);
  const [indexing, setIndexing] = useState<IndexingStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commandLogs, setCommandLogs] = useState<CommandExecutionLog[]>([]);

  useEffect(() => {
    Promise.all([
      statsApi.get(),
      indexingApi.getStats(),
      commandLogsApi.list(100),
    ])
      .then(([stats, indexing, commandLogs]) => {
        setStats(stats);
        setIndexing(indexing);
        setCommandLogs(commandLogs);
      })
      .catch((error) => setError(String(error)));
  }, []);

  if (error) {
    return (
      <div className="p-6 text-sm text-red-400">
        {LL.debugPage.loadError({ error })}
      </div>
    );
  }

  if (!stats || !indexing) {
    return (
      <div className="p-6 text-sm text-text-muted">
        {LL.debugPage.loading()}
      </div>
    );
  }

  const { stats: indexingStats, settings } = indexing;
  const startupWarm = indexingStats.startupWarm;
  const startupWarmCurrent =
    startupWarm.currentGroupName ??
    startupWarm.currentGroupId ??
    LL.debugPage.values.notAvailable();

  return (
    <div className="h-full w-full overflow-y-auto p-6 text-sm text-text-main">
      <div className=" mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">{LL.debugPage.title()}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {LL.debugPage.subtitle()}
          </p>
        </header>

        <DebugSection title={LL.debugPage.sections.index()}>
          <DebugRow
            label={LL.debugPage.labels.totalItems()}
            value={stats.totalItems}
          />
          <DebugRow
            label={LL.debugPage.labels.starItems()}
            value={stats.starItems}
          />
          <DebugRow
            label={LL.debugPage.labels.taggedItems()}
            value={stats.taggedItems}
          />
          <DebugRow
            label={LL.debugPage.labels.aliasItems()}
            value={stats.aliasItems}
          />
        </DebugSection>

        <DebugSection title={LL.debugPage.sections.previewTypes()}>
          <DebugRow
            label={LL.debugPage.labels.markdown()}
            value={stats.markdownItems}
          />
          <DebugRow label={LL.debugPage.labels.raw()} value={stats.rawItems} />
          <DebugRow
            label={LL.debugPage.labels.external()}
            value={stats.externalItems}
          />
        </DebugSection>

        <DebugSection title={LL.debugPage.sections.openActions()}>
          <DebugRow
            label={LL.debugPage.labels.commandItems()}
            value={stats.commandItems}
          />
          <DebugRow
            label={LL.debugPage.labels.externalOpenItems()}
            value={stats.externalOpenItems}
          />
        </DebugSection>

        <DebugSection title={LL.debugPage.sections.indexer()}>
          <DebugRow
            label={LL.debugPage.labels.indexedItems()}
            value={indexingStats.indexedItems}
          />
          <DebugRow
            label={LL.debugPage.labels.watchStatus()}
            value={indexingStats.watchStatus}
          />
          <DebugRow
            label={LL.debugPage.labels.lastScan()}
            value={
              indexingStats.lastScanAt ?? LL.debugPage.values.notAvailable()
            }
          />
          <DebugRow
            label={LL.debugPage.labels.startupWarmStatus()}
            value={startupWarm.status}
          />
          <DebugRow
            label={LL.debugPage.labels.startupWarmCurrent()}
            value={startupWarmCurrent}
          />
          <DebugRow
            label={LL.debugPage.labels.startupWarmProgress()}
            value={`${startupWarm.completedGroups}/${startupWarm.totalGroups}`}
          />
          {startupWarm.lastError && (
            <DebugRow
              label={LL.debugPage.labels.startupWarmError()}
              value={startupWarm.lastError}
            />
          )}
        </DebugSection>

        <DebugSection title={LL.debugPage.sections.filters()}>
          <DebugRow
            label={LL.debugPage.labels.ignoreHiddenFiles()}
            value={String(settings.ignoreHiddenFiles)}
          />
          <DebugRow
            label={LL.debugPage.labels.maxFileSize()}
            value={
              settings.maxFileSizeBytes === null
                ? LL.debugPage.values.unlimited()
                : LL.debugPage.values.bytes({
                    value: String(settings.maxFileSizeBytes),
                  })
            }
          />
        </DebugSection>

        <DebugSection title={LL.debugPage.sections.ignorePatterns()}>
          {settings.ignorePatterns.length === 0 ? (
            <div className="text-text-muted">
              {LL.debugPage.messages.noIgnorePatterns()}
            </div>
          ) : (
            <div className="space-y-1">
              {settings.ignorePatterns.map((pattern) => (
                <code key={pattern} className="block text-xs text-text-muted">
                  {pattern}
                </code>
              ))}
            </div>
          )}
        </DebugSection>

        <button
          type="button"
          onClick={() => {
            commandLogsApi.openFile().catch((error) => setError(String(error)));
          }}
          className="mb-4 rounded border border-border-main px-2 py-1 text-xs text-text-muted hover:text-text-main"
        >
          {LL.debugPage.messages.openLogsFolder()}
        </button>

        <DebugSection title={LL.debugPage.sections.commandExecutionLogs()}>
          <CommandExecutionLogList logs={commandLogs} />
        </DebugSection>
      </div>
    </div>
  );
};
