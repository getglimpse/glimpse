import { Bug, SearchCode, X } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { nord } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useI18nContext } from "@/i18n/I18nProvider";

type Props = {
  title: string;
  subtitle?: string;
  json: string;
  kind: "item" | "query";
  active?: boolean;
  onClose: () => void;
};

export const InspectorPanel = ({
  title,
  subtitle,
  json,
  kind,
  active,
  onClose,
}: Props) => {
  const { LL } = useI18nContext();
  const InspectorIcon = kind === "item" ? Bug : SearchCode;

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border-main bg-main-bg text-text-main">
      <header className="relative flex flex-shrink-0 items-center justify-between border-b border-border-main bg-glass-bg px-4 py-2 backdrop-blur-md">
        {active && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-accent" />
        )}

        <div className="flex min-w-0 items-center gap-2">
          <InspectorIcon className="h-4 w-4 shrink-0 text-text-muted" />
          <span className="truncate text-sm font-semibold tracking-wide">
            {title}
          </span>
          {subtitle && (
            <span className="truncate text-xs text-text-muted">{subtitle}</span>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-item-hover hover:text-text-main"
          title={LL.common.close()}
          tabIndex={-1}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-main-bg p-4">
        <div className="overflow-hidden rounded-md border border-border-main">
          <SyntaxHighlighter
            language="json"
            style={nord}
            customStyle={{
              margin: 0,
              minHeight: "100%",
              fontSize: "0.75rem",
            }}
          >
            {json}
          </SyntaxHighlighter>
        </div>
      </div>
    </main>
  );
};
