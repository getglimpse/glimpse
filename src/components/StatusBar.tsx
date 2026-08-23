import { useI18nContext } from "@/i18n/I18nProvider";
import type { StartupWarmStats } from "@/types";

export const StatusBar = ({
  count,
  totalCount,
  currentTargetGroupName,
  startupWarm,
}: {
  count: number;
  totalCount?: number | null;
  animation: boolean;
  currentTargetGroupName?: string | null;
  startupWarm?: StartupWarmStats | null;
}) => {
  const { LL } = useI18nContext();
  const indexedCount =
    typeof totalCount === "number" ? `${count}/${totalCount}` : count;
  const showStartupWarm =
    startupWarm?.status === "running" && startupWarm.totalGroups > 0;
  const warmTargetName =
    startupWarm?.currentGroupName ?? startupWarm?.currentGroupId ?? "-";

  return (
    <footer
      className="
        flex-none h-6
        bg-status-bg
        border-t border-border-main
        px-3
        flex items-center justify-between
        text-[10px]
        text-text-muted
        uppercase tracking-widest
      "
    >
      <div>{LL.statusBar.indexedItems({ count: indexedCount })}</div>

      <div className="flex gap-4">
        {showStartupWarm && (
          <span>
            {LL.statusBar.startupWarm()}:{" "}
            {LL.statusBar.startupWarmRunning({
              name: warmTargetName,
              completed: startupWarm?.completedGroups ?? 0,
              total: startupWarm?.totalGroups ?? 0,
            })}
          </span>
        )}

        {currentTargetGroupName && (
          <span>
            {LL.statusBar.target()}: {currentTargetGroupName}
          </span>
        )}

        <span>Ctrl + R: {LL.statusBar.switchTarget()}</span>
      </div>
    </footer>
  );
};
