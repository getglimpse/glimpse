import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { openerApi } from "@/api/opener";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/utils/clipboard";

import {
  readPluginCopySuccessfulSearchResultEnabled,
  writePluginCopySuccessfulSearchResultEnabled,
} from "./pluginSettings";

export type PluginActionHandler = (
  input?: unknown,
) => unknown | Promise<unknown>;

export type PluginActionRegistration =
  | PluginActionHandler
  | {
      handler: PluginActionHandler;
      title?: string;
      description?: string;
    };

export type PluginAction = {
  handler: PluginActionHandler;
  title?: string;
  description?: string;
};

export type PluginActions = Record<string, PluginAction>;

export type PluginActionInvoker = (
  id: string,
  input?: unknown,
) => Promise<unknown>;

export type PluginPageRenderContext = {
  h: typeof import("react").createElement;
  components: PluginComponents;
  actions: {
    invoke: PluginActionInvoker;
  };
  plugin: {
    id: string;
    version: string;
  };
  i18n: {
    readonly language: string;
    readonly locale: string;
    t: (key: string, fallback?: string) => string;
    has: (key: string) => boolean;
  };
};

export type PluginPageRenderer = (
  context: PluginPageRenderContext,
) => ReactNode;

export type PluginViewerRenderContext = PluginPageRenderContext & {
  sourcePath?: string | null;
};

export type PluginViewerRenderer = (
  context: PluginViewerRenderContext,
) => ReactNode;

export type PluginComponents = {
  Stack: ComponentType<StackProps>;
  Text: ComponentType<TextProps>;
  Section: ComponentType<SectionProps>;
  KeyValueList: ComponentType<KeyValueListProps>;
  Button: ComponentType<ButtonProps>;
  Input: ComponentType<InputProps>;
  Table: ComponentType<TableProps>;
  Tabs: ComponentType<TabsProps>;
  List: ComponentType<ListProps>;
  Details: ComponentType<DetailsProps>;
  Markdown: ComponentType<MarkdownProps>;
  DeferredFrame: ComponentType<DeferredFrameProps>;
  FileOpenButton: ComponentType<FileOpenButtonProps>;
  ActionPlayground: ComponentType<ActionPlaygroundPublicProps>;
  ActionSettings: ComponentType<ActionSettingsPublicProps>;
  CalculationPanel: ComponentType<CalculationPanelPublicProps>;
};

type StackProps = {
  gap?: "sm" | "md" | "lg";
  children?: ReactNode;
};

type TextProps = {
  variant?: "default" | "muted" | "code" | "strong";
  children?: ReactNode;
};

type SectionProps = {
  title?: string;
  children?: ReactNode;
};

type KeyValueListProps = {
  rows?: Array<[string, string] | { label: string; value: string }>;
};

type ButtonProps = {
  action?: string;
  input?: unknown;
  onClick?: () => unknown | Promise<unknown>;
  variant?: "default" | "secondary" | "danger";
  disabled?: boolean;
  children?: ReactNode;
};

type InputProps = {
  action?: string;
  defaultValue?: string;
  placeholder?: string;
  submitLabel?: string;
  clearOnSubmit?: boolean;
  onSubmit?: (value: string) => unknown | Promise<unknown>;
};

type TableColumn = {
  key: string;
  title?: string;
};

type TableProps = {
  columns?: Array<string | TableColumn>;
  rows?: Array<Record<string, ReactNode> | ReactNode[]>;
  empty?: ReactNode;
};

type TabsProps = {
  items?: Array<{
    id: string;
    title: string;
    content: ReactNode;
  }>;
};

type ListProps = {
  items?: Array<ReactNode | StructuredListItem>;
  ordered?: boolean;
  empty?: ReactNode;
};

type StructuredListItem = {
  id?: string;
  title?: ReactNode;
  detail?: ReactNode;
};

type DetailsProps = {
  title?: ReactNode;
  defaultOpen?: boolean;
  children?: ReactNode;
};

type MarkdownProps = {
  content?: string;
};

type DeferredFrameProps = {
  src?: string;
  title?: string;
  className?: string;
  label?: ReactNode;
  description?: ReactNode;
  buttonLabel?: string;
};

type FileOpenButtonProps = {
  sourcePath?: string;
  label?: ReactNode;
  variant?: ButtonProps["variant"];
};

type ActionPlaygroundPublicProps = {
  action: string;
  placeholder?: string;
  examples?: string[];
  submitLabel?: string;
};

type ActionPlaygroundProps = ActionPlaygroundPublicProps & {
  actions: PluginActions;
};

type ActionSettingsPublicProps = {
  action: string;
  copySearchResultLabel?: string;
};

type ActionSettingsProps = ActionSettingsPublicProps & {
  pluginId: string;
};

type CalculationPanelPublicProps = {
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

export const createPluginComponents = (
  actions: PluginActions,
  pluginId = "unknown",
): PluginComponents => ({
  Stack,
  Text,
  Section,
  KeyValueList,
  Button: (props) => <Button {...props} actions={actions} />,
  Input: (props) => <Input {...props} actions={actions} />,
  Table,
  Tabs,
  List,
  Details,
  Markdown,
  DeferredFrame,
  FileOpenButton,
  ActionPlayground: (props) => <ActionPlayground {...props} actions={actions} />,
  ActionSettings: (props) => <ActionSettings {...props} pluginId={pluginId} />,
  CalculationPanel: (props) => (
    <CalculationPanel {...props} actions={actions} />
  ),
});

export const normalizePluginAction = (
  registration: PluginActionRegistration,
): PluginAction => {
  if (typeof registration === "function") {
    return {
      handler: registration,
    };
  }

  return registration;
};

export const invokePluginAction = async (
  actions: PluginActions,
  id: string,
  input?: unknown,
): Promise<unknown> => {
  const action = actions[id];

  if (!action) {
    throw new Error(`Missing action: ${id}`);
  }

  return action.handler(input);
};

const Stack = ({ gap = "md", children }: StackProps) => (
  <div className={getStackClassName(gap)}>{children}</div>
);

const Text = ({ variant = "default", children }: TextProps) => (
  <p className={getTextClassName(variant)}>{children}</p>
);

const Section = ({ title, children }: SectionProps) => (
  <section className="mb-6">
    {title && (
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h2>
    )}
    <div className="divide-y divide-border-main/60 border-y border-border-main/60">
      {children}
    </div>
  </section>
);

const KeyValueList = ({ rows }: KeyValueListProps) => (
  <>
    {rows?.map((row) => {
      const label = Array.isArray(row) ? row[0] : row.label;
      const value = Array.isArray(row) ? row[1] : row.value;

      return (
        <div
          key={`${label}:${value}`}
          className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-start gap-4 py-2"
        >
          <span className="min-w-0 break-words text-text-muted">{label}</span>
          <span className="min-w-0 break-all text-right font-mono text-xs text-text-main">
            {value}
          </span>
        </div>
      );
    })}
  </>
);

const Button = ({
  action,
  input,
  onClick,
  variant = "default",
  disabled,
  children,
  actions,
}: ButtonProps & { actions: PluginActions }) => {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = async () => {
    if (running || disabled) {
      return;
    }

    setRunning(true);
    setMessage(null);

    try {
      const result = action
        ? await invokePluginAction(actions, action, input)
        : await onClick?.();

      if (result !== undefined) {
        setMessage(String(result));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-start gap-1 py-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={disabled || running}
        className={getButtonClassName(variant)}
      >
        {running ? "Running" : children}
      </button>
      {message && <span className="text-xs text-text-muted">{message}</span>}
    </div>
  );
};

const Input = ({
  action,
  defaultValue = "",
  placeholder,
  submitLabel = "Submit",
  clearOnSubmit = false,
  onSubmit,
  actions,
}: InputProps & { actions: PluginActions }) => {
  const [value, setValue] = useState(defaultValue);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    if (running) {
      return;
    }

    setRunning(true);
    setMessage(null);

    try {
      const result = action
        ? await invokePluginAction(actions, action, value)
        : await onSubmit?.(value);

      if (result !== undefined) {
        setMessage(String(result));
      }

      if (clearOnSubmit) {
        setValue("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2 py-3">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void submit();
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded border border-border-main bg-main-bg px-3 py-2 text-sm text-text-main outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={running}
          className={getButtonClassName("secondary")}
        >
          {running ? "Running" : submitLabel}
        </button>
      </div>
      {message && <div className="text-xs text-text-muted">{message}</div>}
    </div>
  );
};

const Table = ({ columns, rows, empty = "No rows" }: TableProps) => {
  const normalizedColumns = columns?.map((column) =>
    typeof column === "string" ? { key: column, title: column } : column,
  );

  if (!rows || rows.length === 0) {
    return <div className="py-3 text-sm text-text-muted">{empty}</div>;
  }

  const inferredColumns =
    normalizedColumns ??
    Object.keys((rows[0] as Record<string, ReactNode>) ?? {}).map((key) => ({
      key,
      title: key,
    }));

  return (
    <div className="overflow-x-auto py-3">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border-main/60 text-xs uppercase text-text-muted">
            {inferredColumns.map((column) => (
              <th key={column.key} className="px-2 py-2 font-semibold">
                {column.title ?? column.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-main/60">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {inferredColumns.map((column, columnIndex) => (
                <td key={column.key} className="px-2 py-2 text-text-main">
                  {Array.isArray(row) ? row[columnIndex] : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Tabs = ({ items }: TabsProps) => {
  const [activeId, setActiveId] = useState(items?.[0]?.id ?? "");
  const activeItem = items?.find((item) => item.id === activeId) ?? items?.[0];

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col pb-3">
      <div className="mb-3 flex shrink-0 gap-1 border-b border-border-main/60">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveId(item.id)}
            className={`px-3 py-2 text-xs ${
              item.id === activeItem?.id
                ? "border-b border-accent text-text-main"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            {item.title}
          </button>
        ))}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {activeItem?.content}
      </div>
    </div>
  );
};

const List = ({ items, ordered, empty = "No items" }: ListProps) => {
  const Element = ordered ? "ol" : "ul";

  if (!items || items.length === 0) {
    return <div className="py-3 text-sm text-text-muted">{empty}</div>;
  }

  return (
    <Element
      className={
        ordered ? "list-decimal space-y-2 py-3 pl-5" : "space-y-2 py-3"
      }
    >
      {items.map((item, index) => {
        const key =
          typeof item === "object" && item !== null && "id" in item && item.id
            ? item.id
            : index;

        const structuredItem = isStructuredListItem(item) ? item : null;

        return (
          <li key={key} className="text-sm text-text-main">
            {structuredItem ? (
              <>
                <div>{structuredItem.title}</div>
                {structuredItem.detail && (
                  <div className="mt-0.5 text-xs text-text-muted">
                    {structuredItem.detail}
                  </div>
                )}
              </>
            ) : (
              (item as ReactNode)
            )}
          </li>
        );
      })}
    </Element>
  );
};

const isStructuredListItem = (
  item: ReactNode | StructuredListItem,
): item is StructuredListItem =>
  typeof item === "object" &&
  item !== null &&
  !("type" in item) &&
  ("title" in item || "detail" in item);

const Details = ({ title = "Details", children }: DetailsProps) => (
  <section className="border-y border-border-main/60 py-3">
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
      {title}
    </h2>
    <div className="space-y-3">{children}</div>
  </section>
);

const Markdown = ({ content = "" }: MarkdownProps) => (
  <div
    className="
      prose max-w-none select-text break-words py-3 text-sm
      [--tw-prose-body:var(--text-main)]
      [--tw-prose-headings:var(--text-main)]
      [--tw-prose-lead:var(--text-main)]
      [--tw-prose-links:var(--accent)]
      [--tw-prose-bold:var(--text-main)]
      [--tw-prose-counters:var(--text-muted)]
      [--tw-prose-bullets:var(--text-muted)]
      [--tw-prose-hr:var(--border)]
      [--tw-prose-quotes:var(--text-main)]
      [--tw-prose-quote-borders:var(--accent)]
      [--tw-prose-captions:var(--text-muted)]
      [--tw-prose-code:var(--text-main)]
      [--tw-prose-pre-code:var(--text-main)]
      [--tw-prose-pre-bg:var(--main-bg)]
      [--tw-prose-th-borders:var(--border)]
      [--tw-prose-td-borders:var(--border)]
      prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-text-main
      prose-p:my-2 prose-p:text-text-main
      prose-strong:text-text-main
      prose-em:text-text-main
      prose-li:text-text-main
      prose-blockquote:border-accent prose-blockquote:text-text-muted
      prose-hr:border-border-main
      prose-th:text-text-main prose-td:text-text-main
      prose-code:text-text-main
      prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-main-bg
      prose-a:text-accent hover:prose-a:underline
    "
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children, ...props }) => (
          <p {...props} className="my-2 text-text-main">
            {children}
          </p>
        ),
        ul: ({ children, ...props }) => (
          <ul {...props} className="my-3 list-disc space-y-1.5 pl-5">
            {children}
          </ul>
        ),
        ol: ({ children, ...props }) => (
          <ol {...props} className="my-3 list-decimal space-y-1.5 pl-5">
            {children}
          </ol>
        ),
        li: ({ children, ...props }) => (
          <li {...props} className="pl-1 text-text-main marker:text-text-muted">
            {children}
          </li>
        ),
        code: ({ children, className, ...props }) => (
          <code {...props} className={className}>
            {children}
          </code>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

const DeferredFrame = ({
  src,
  title,
  className,
  label = "Preview is paused",
  description,
  buttonLabel = "Load Preview",
}: DeferredFrameProps) => {
  const [loaded, setLoaded] = useState(false);

  if (loaded && src) {
    return (
      <iframe key={src} src={src} title={title} className={className} />
    );
  }

  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-3 border-y border-border-main bg-main-bg px-6 py-8 text-center">
      <div className="text-sm font-semibold text-text-main">{label}</div>
      {description && (
        <div className="max-w-xl text-sm text-text-muted">{description}</div>
      )}
      <button
        type="button"
        onClick={() => setLoaded(true)}
        disabled={!src}
        className={getButtonClassName("default")}
      >
        {buttonLabel}
      </button>
    </div>
  );
};

const FileOpenButton = ({
  sourcePath,
  label = "Open Externally",
  variant = "secondary",
}: FileOpenButtonProps) => {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openFile = async () => {
    if (!sourcePath || running) {
      return;
    }

    setRunning(true);
    setMessage(null);

    try {
      await openerApi.openSourceFileOrReveal(sourcePath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-center gap-1 py-1">
      <button
        type="button"
        onClick={() => void openFile()}
        disabled={!sourcePath || running}
        className={getButtonClassName(variant)}
      >
        {running ? "Opening" : label}
      </button>
      {message && <span className="text-xs text-text-muted">{message}</span>}
    </div>
  );
};

const ActionPlayground = ({
  action,
  placeholder,
  examples,
  submitLabel = "Run",
  actions,
}: ActionPlaygroundProps) => {
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

const ActionSettings = ({
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

const CalculationPanel = ({
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

const getStackClassName = (gap: StackProps["gap"]) => {
  switch (gap) {
    case "sm":
      return "space-y-2";
    case "lg":
      return "space-y-6";
    case "md":
    default:
      return "space-y-4";
  }
};

const getTextClassName = (variant: TextProps["variant"]) => {
  switch (variant) {
    case "code":
      return "font-mono text-xs text-text-main";
    case "strong":
      return "text-sm font-semibold text-text-main";
    case "muted":
      return "text-sm text-text-muted";
    case "default":
    default:
      return "text-sm text-text-main";
  }
};

const getButtonClassName = (variant: ButtonProps["variant"]) => {
  const base = "rounded border px-3 py-2 text-xs disabled:opacity-50";

  switch (variant) {
    case "danger":
      return `${base} border-red-500/50 text-red-300 hover:bg-red-500/10`;
    case "secondary":
      return `${base} border-border-main text-text-muted hover:text-text-main`;
    case "default":
    default:
      return `${base} border-accent/60 text-accent hover:bg-accent/10`;
  }
};
