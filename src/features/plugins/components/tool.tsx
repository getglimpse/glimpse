import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Switch } from "@/components/ui/switch";
import { copyText } from "@/utils/clipboard";

import { invokePluginAction, type PluginActions } from "./actions";
import { subscribeToPluginPlaygroundExecutions } from "../events/playground";
import {
  readPluginCopySuccessfulSearchResultEnabled,
  writePluginCopySuccessfulSearchResultEnabled,
} from "./settings";

const PluginPageActivityContext = createContext(true);

export const PluginPageActivityProvider = ({
  active,
  children,
}: {
  active: boolean;
  children?: ReactNode;
}) => (
  <PluginPageActivityContext.Provider value={active}>
    {children}
  </PluginPageActivityContext.Provider>
);

export type ActionPlaygroundPublicProps = {
  action: string;
  placeholder?: string;
  examples?: string[];
  submitLabel?: string;
};

type ActionPlaygroundProps = ActionPlaygroundPublicProps & {
  actions: PluginActions;
  pluginId: string;
};

export type ActionSettingsPublicProps = {
  action: string;
  copySearchResultLabel?: string;
};

type ActionSettingsProps = ActionSettingsPublicProps & {
  pluginId: string;
};

export type CalculationPanelPublicProps = {
  action?: string;
  examples?: string[];
  input?: {
    placeholder?: string;
  };
  result?: {
    copyable?: boolean;
    history?: boolean;
  };
};

type CalculationPanelProps = CalculationPanelPublicProps & {
  actions: PluginActions;
};

type HistoryItem = {
  expression: string;
  result: string;
  error?: boolean;
};

type PlaygroundHistoryItem = {
  id: number;
  input: string;
  result: string;
  error?: boolean;
};

export const ActionPlayground = ({
  action,
  placeholder,
  examples,
  submitLabel = "Run",
  actions,
  pluginId,
}: ActionPlaygroundProps) => {
  const pageActive = useContext(PluginPageActivityContext);
  const [value, setValue] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<PlaygroundHistoryItem[]>([]);
  const [copiedHistoryId, setCopiedHistoryId] = useState<number | null>(null);
  const nextHistoryId = useRef(1);
  const historyEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [history.length]);

  useEffect(
    () =>
      subscribeToPluginPlaygroundExecutions((execution) => {
        if (
          !pageActive ||
          execution.pluginId !== pluginId ||
          execution.actionId !== action
        ) {
          return;
        }

        setHistory((previous) => [
          ...previous,
          {
            id: nextHistoryId.current++,
            input: execution.input,
            result: execution.result,
            error: execution.error,
          },
        ]);
      }),
    [action, pageActive, pluginId],
  );

  const run = async () => {
    if (running) {
      return;
    }

    setRunning(true);
    const input = value.trim();

    try {
      const result = await invokePluginAction(
        actions,
        action,
        input || undefined,
      );

      if (result !== undefined) {
        const nextMessage = String(result);
        setHistory((previous) => [
          ...previous,
          {
            id: nextHistoryId.current++,
            input,
            result: nextMessage,
          },
        ]);
        setValue("");
      }
    } catch (error) {
      setHistory((previous) => [
        ...previous,
        {
          id: nextHistoryId.current++,
          input,
          result: error instanceof Error ? error.message : String(error),
          error: true,
        },
      ]);
    } finally {
      setRunning(false);
    }
  };

  const copyPlaygroundResult = async (
    item: PlaygroundHistoryItem,
  ): Promise<void> => {
    if (item.error) {
      return;
    }

    try {
      const copied = await copyText(item.result);

      if (copied) {
        setCopiedHistoryId(item.id);
        window.setTimeout(() => {
          setCopiedHistoryId((current) =>
            current === item.id ? null : current,
          );
        }, 1200);
      }
    } catch (error) {
      console.warn("Failed to copy plugin playground result", error);
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden border-y border-border-main/60"
      data-glimpse-plugin-playground
    >
      <div
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1 py-3"
        aria-live="polite"
        data-glimpse-plugin-playground-messages
      >
        {history.length === 0 ? (
          <div className="flex h-full min-h-40 items-center justify-center px-4 text-center text-sm text-text-muted">
            {placeholder ?? "Enter a message to run this action."}
          </div>
        ) : (
          history.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1 rounded-md px-2 py-2 hover:bg-item-hover/60"
            >
              {item.input && (
                <>
                  <div className="pt-0.5 text-xs font-semibold text-text-main">
                    You:
                  </div>
                  <div className="min-w-0 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-text-main">
                    {item.input}
                  </div>
                </>
              )}

              {item.error ? (
                <>
                  <div className="pt-0.5 text-xs font-semibold text-red-300">
                    Error:
                  </div>
                  <div className="min-w-0 text-sm leading-relaxed whitespace-pre-wrap break-words text-red-300">
                    {item.result}
                  </div>
                </>
              ) : (
                <>
                  <div className="pt-0.5 text-xs font-semibold text-text-main">
                    Result:
                  </div>
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => void copyPlaygroundResult(item)}
                      className="block w-full rounded-sm text-left text-sm text-text-main select-text transition-colors hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                      aria-label="Copy playground result"
                      title="Copy result"
                    >
                      <span className="block leading-relaxed whitespace-pre-wrap break-words">
                        {item.result}
                      </span>
                    </button>
                    {copiedHistoryId === item.id && (
                      <span className="mt-0.5 block text-[11px] text-text-muted">
                        Copied
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}
        <div ref={historyEndRef} />
      </div>

      <div
        className="shrink-0 border-t border-border-main/60 bg-main-bg py-3"
        data-glimpse-plugin-playground-composer
      >
        {examples && examples.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setValue(example);
                  inputRef.current?.focus();
                }}
                className="rounded-full border border-border-main px-2.5 py-1 font-mono text-xs text-text-muted hover:bg-item-hover hover:text-text-main"
              >
                {example}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                void run();
              }
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 rounded-full border border-border-main bg-main-bg px-4 py-2 text-sm text-text-main outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="rounded-full border border-accent/60 px-4 py-2 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
          >
            {running ? "Running" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const ActionSettings = ({
  action,
  copySearchResultLabel = "Copy successful search result",
  pluginId,
}: ActionSettingsProps) => {
  const copyToggleId = useId();
  const [copySearchResult, setCopySearchResult] = useState(false);

  useEffect(() => {
    let cancelled = false;

    readPluginCopySuccessfulSearchResultEnabled(pluginId, action)
      .then((enabled) => {
        if (!cancelled) {
          setCopySearchResult(enabled);
        }
      })
      .catch((error) => {
        console.warn("Failed to load plugin search result settings", error);
      });

    return () => {
      cancelled = true;
    };
  }, [action, pluginId]);

  const updateCopySearchResult = (enabled: boolean) => {
    const previous = copySearchResult;

    setCopySearchResult(enabled);
    writePluginCopySuccessfulSearchResultEnabled(
      pluginId,
      action,
      enabled,
    ).catch((error) => {
      console.warn("Failed to save plugin search result settings", error);
      setCopySearchResult(previous);
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <label
        htmlFor={copyToggleId}
        className="text-xs font-medium text-text-muted"
      >
        {copySearchResultLabel}
      </label>
      <Switch
        id={copyToggleId}
        size="sm"
        checked={copySearchResult}
        onCheckedChange={updateCopySearchResult}
        aria-label={copySearchResultLabel}
      />
    </div>
  );
};

export const CalculationPanel = ({
  action = "calculate",
  examples,
  input,
  result,
  actions,
}: CalculationPanelProps) => {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [running, setRunning] = useState(false);
  const actionHandler = actions[action];

  const runCalculation = async () => {
    const expression = value.trim();

    if (!expression || running) return;

    if (!actionHandler) {
      setHistory((previous) => [
        {
          expression,
          result: `Missing action: ${action}`,
          error: true,
        },
        ...previous,
      ]);
      return;
    }

    setRunning(true);

    try {
      const nextResult = String(
        await invokePluginAction(actions, action, expression),
      );

      setHistory((previous) => [
        {
          expression,
          result: nextResult,
        },
        ...previous,
      ]);
      setValue("");
    } catch (error) {
      setHistory((previous) => [
        {
          expression,
          result: String(error),
          error: true,
        },
        ...previous,
      ]);
    } finally {
      setRunning(false);
    }
  };

  const copyResult = async (nextResult: string) => {
    await navigator.clipboard.writeText(nextResult);
  };

  return (
    <div className="space-y-3 py-3">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void runCalculation();
            }
          }}
          placeholder={input?.placeholder}
          className="min-w-0 flex-1 rounded border border-border-main bg-main-bg px-3 py-2 text-sm text-text-main outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => void runCalculation()}
          disabled={running}
          className="rounded border border-border-main px-3 py-2 text-xs text-text-muted hover:text-text-main disabled:opacity-50"
        >
          {running ? "Running" : "Run"}
        </button>
      </div>

      {examples && (
        <div className="flex flex-wrap gap-1.5">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setValue(example)}
              className="rounded border border-border-main px-2 py-1 font-mono text-xs text-text-muted hover:text-text-main"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {result?.history !== false && (
        <div className="space-y-3">
          {history.map((item, index) => (
            <div
              key={`${item.expression}-${index}`}
              className="rounded-lg border border-border-main bg-main-bg p-3"
            >
              <div className="mb-2 text-sm text-text-muted">
                {item.expression}
              </div>
              <div className="flex items-center justify-between gap-4">
                <div
                  className={`text-lg font-semibold ${
                    item.error ? "text-red-400" : "text-text-main"
                  }`}
                >
                  {item.result}
                </div>

                {result?.copyable && !item.error && (
                  <button
                    type="button"
                    onClick={() => void copyResult(item.result)}
                    className="rounded-md border border-border-main px-3 py-1 text-xs text-text-muted hover:bg-item-hover"
                  >
                    Copy
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
