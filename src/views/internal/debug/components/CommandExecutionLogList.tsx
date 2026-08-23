import { CommandExecutionLog } from "@/types";
import { useI18nContext } from "@/i18n/I18nProvider";

type Props = {
  logs: CommandExecutionLog[];
};

const getStatusClassName = (status: CommandExecutionLog["status"]) => {
  switch (status) {
    case "success":
      return "text-green-400";

    case "blocked":
      return "text-yellow-400";

    case "failed":
      return "text-red-400";
  }
};

export const CommandExecutionLogList = ({ logs }: Props) => {
  const { LL } = useI18nContext();

  if (logs.length === 0) {
    return (
      <div className="py-2 text-text-muted">
        {LL.debugPage.messages.noCommandLogs()}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-main/60">
      {logs.map((log, index) => (
        <div key={`${log.timestamp}-${index}`} className="py-3">
          <div className="space-y-1">
            <div className="font-mono text-xs">
              <span className={getStatusClassName(log.status)}>
                [{log.status}]
              </span>{" "}
              <span className="text-text-muted">{log.stage}</span>
            </div>

            <div className="font-mono text-xs text-text-main">
              {log.command}
            </div>

            <div className="text-xs text-text-muted">
              {new Date(log.timestamp).toLocaleString()}
            </div>

            {log.error && (
              <div className="text-xs text-text-muted">
                {log.error}
              </div>
            )}

            <details>
              <summary className="cursor-pointer text-xs text-text-muted">
                {LL.debugPage.messages.details()}
              </summary>

              <div className="mt-1 font-mono text-xs text-text-muted">
                {log.resolvedPath}
              </div>

              {log.args.length > 0 && (
                <div className="mt-1 font-mono text-xs text-text-muted">
                  {log.args.join(" ")}
                </div>
              )}
            </details>
          </div>
        </div>
      ))}
    </div>
  );
};