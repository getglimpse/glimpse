import { useState, type ComponentType, type ReactNode } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  invokePluginAction,
  type PluginActionInvoker,
  type PluginActions,
} from "./actions";
import { getPluginButtonClassName, type PluginButtonVariant } from "./styles";
import {
  FileDropConverter,
  OutputDirectorySettings,
  type FileDropConverterProps,
  type OutputDirectorySettingsProps,
} from "./converter";
import {
  ActionPlayground,
  ActionSettings,
  CalculationPanel,
  type ActionPlaygroundPublicProps,
  type ActionSettingsPublicProps,
  type CalculationPanelPublicProps,
} from "./tool";
import {
  DeferredFrame,
  FileOpenButton,
  type DeferredFrameProps,
  type FileOpenButtonProps,
} from "./viewer";

export { ConverterExecutionSettings } from "./converter";
export { PluginPageActivityProvider } from "./tool";
export { invokePluginAction, normalizePluginAction } from "./actions";
export type {
  PluginAction,
  PluginActionHandler,
  PluginActionInvoker,
  PluginActionRegistration,
  PluginActions,
} from "./actions";

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
  FileDropConverter: ComponentType<FileDropConverterProps>;
  OutputDirectorySettings: ComponentType<OutputDirectorySettingsProps>;
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
  variant?: PluginButtonVariant;
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
  FileDropConverter: (props) => (
    <FileDropConverter {...props} actions={actions} pluginId={pluginId} />
  ),
  OutputDirectorySettings: (props) => (
    <OutputDirectorySettings {...props} pluginId={pluginId} />
  ),
  ActionPlayground: (props) => (
    <ActionPlayground {...props} actions={actions} pluginId={pluginId} />
  ),
  ActionSettings: (props) => <ActionSettings {...props} pluginId={pluginId} />,
  CalculationPanel: (props) => (
    <CalculationPanel {...props} actions={actions} />
  ),
});

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
        className={getPluginButtonClassName(variant)}
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
          className={getPluginButtonClassName("secondary")}
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
