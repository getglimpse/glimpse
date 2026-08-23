import { CircleHelp, X } from "lucide-react";

import { useI18nContext } from "@/i18n/I18nProvider";
import { getHelpContent } from "@/utils/helpContent";

type Props = {
  itemPage: string;
  active?: boolean;
  onClose: () => void;
};

export const HelpPanel = ({ itemPage, active, onClose }: Props) => {
  const { LL } = useI18nContext();
  const help = getHelpContent(itemPage, LL);

  if (!help) {
    return null;
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border-main bg-main-bg text-text-main">
      <header className="relative flex flex-shrink-0 items-center justify-between border-b border-border-main bg-glass-bg px-4 py-2 backdrop-blur-md">
        {active && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-accent" />
        )}

        <div className="flex min-w-0 items-center gap-2">
          <CircleHelp className="h-4 w-4 shrink-0 text-text-muted" />
          <span className="truncate text-sm font-semibold tracking-wide">
            {help.title}
          </span>
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

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        <p className="text-sm leading-relaxed">{help.description}</p>

        {help.examples.length > 0 && (
          <section className="space-y-2">
            <h3 className="font-medium">{help.examplesTitle}</h3>

            {help.examples.map((example) => (
              <pre
                key={example}
                className="overflow-x-auto rounded-md border border-border-main bg-sub-bg p-3 text-sm"
              >
                <code>{example}</code>
              </pre>
            ))}
          </section>
        )}

        {help.commands.length > 0 && (
          <section className="space-y-2">
            <h3 className="font-medium">{help.commandsTitle}</h3>

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border-main">
                  <th className="px-3 py-2 text-left">{LL.common.command()}</th>
                  <th className="px-3 py-2 text-left">
                    {LL.common.description()}
                  </th>
                </tr>
              </thead>

              <tbody>
                {help.commands.map((command) => (
                  <tr
                    key={command.command}
                    className="border-b border-border-main"
                  >
                    <td className="px-3 py-2 font-mono">{command.command}</td>
                    <td className="px-3 py-2">{command.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
};
