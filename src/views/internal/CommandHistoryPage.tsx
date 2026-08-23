import { CheckCircle2Icon, CopyIcon, XCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18nContext } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { copyText } from "@/utils/clipboard";
import type { CommandHistoryEntry } from "@/types";

type Props = {
  entries: CommandHistoryEntry[];
};

const formatDateTime = (value: string) => {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
};

const copyResult = async (entry: CommandHistoryEntry) => {
  try {
    await copyText(entry.result);
  } catch (error) {
    console.warn("Failed to copy command history result", error);
  }
};

export const CommandHistoryPage = ({ entries }: Props) => {
  const { LL } = useI18nContext();

  return (
    <div className="h-full w-full overflow-y-auto p-6 text-sm text-text-main">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">
            {LL.commandHistoryPage.title()}
          </h1>
        </header>

        {entries.length === 0 ? (
          <div className="rounded-md border border-border-main bg-background/20 px-4 py-8 text-center text-sm text-text-muted">
            {LL.commandHistoryPage.empty()}
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry, index) => {
              const Icon =
                entry.status === "success" ? CheckCircle2Icon : XCircleIcon;

              return (
                <article
                  key={entry.id}
                  className="rounded-md border border-border-main bg-background/20 p-3"
                >
                  <div className="flex items-start gap-2">
                    <pre className="min-h-8 flex-1 overflow-auto rounded-sm border border-border-main bg-main-bg px-2 py-1.5 font-mono text-xs whitespace-pre-wrap text-text-main">{entry.result}</pre>

                    <Button
                      type="button"
                      variant="outline"
                      size="icon-xs"
                      aria-label={LL.commandHistoryPage.copyResult()}
                      onClick={() => {
                        void copyResult(entry);
                      }}
                    >
                      <CopyIcon className="size-3" aria-hidden="true" />
                    </Button>
                  </div>

                  <details className="mt-2 text-xs text-text-muted">
                    <summary className="cursor-pointer select-none rounded-sm px-1 py-0.5 outline-none hover:bg-item-hover focus-visible:ring-1 focus-visible:ring-ring/50">
                      {LL.commandHistoryPage.details()}
                    </summary>

                    <div className="mt-2 grid gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px]">
                          #{entries.length - index}
                        </span>

                        <Badge
                          variant="outline"
                          className={cn(
                            "gap-1",
                            entry.status === "success"
                              ? "border-primary/50 text-primary"
                              : "border-destructive/50 text-destructive",
                          )}
                        >
                          <Icon className="size-3" />
                          {LL.commandHistoryPage.status[entry.status]()}
                        </Badge>

                        <Badge variant="secondary">
                          {LL.commandHistoryPage.kind[entry.kind]()}
                        </Badge>

                        <span>{formatDateTime(entry.createdAt)}</span>
                      </div>

                      <div>
                        <div className="mb-1 text-[11px] font-medium">
                          {LL.commandHistoryPage.target()}
                        </div>
                        <pre className="overflow-auto rounded-sm border border-border-main bg-main-bg px-2 py-1.5 font-mono text-xs whitespace-pre-wrap text-text-main">{entry.target}</pre>
                      </div>

                      <div>
                        <div className="mb-1 text-[11px] font-medium">
                          {LL.commandHistoryPage.input()}
                        </div>
                        <pre className="overflow-auto rounded-sm border border-border-main bg-main-bg px-2 py-1.5 font-mono text-xs whitespace-pre-wrap text-text-main">{entry.input}</pre>
                      </div>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
