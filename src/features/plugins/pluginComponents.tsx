import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type DragEvent,
  type ReactNode,
} from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { fileApi } from "@/api/file";
import { openerApi } from "@/api/opener";
import { settingsApi } from "@/api/settings";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/utils/clipboard";

import {
  readPluginCopySuccessfulSearchResultEnabled,
  readPluginPreference,
  writePluginCopySuccessfulSearchResultEnabled,
  writePluginPreference,
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

type FileDropConverterProps = {
  action: string;
  accept?: string;
  multiple?: boolean;
  maxBytes?: number;
  maxFiles?: number;
  outputDirectoryPreference?: string;
  title?: ReactNode;
  description?: ReactNode;
  chooseFileLabel?: ReactNode;
  emptyLabel?: ReactNode;
  successLabel?: ReactNode;
  convertingLabel?: ReactNode;
  resultsLabel?: ReactNode;
  revealLabel?: ReactNode;
  clearLabel?: ReactNode;
  fileColumnLabel?: ReactNode;
  sizeColumnLabel?: ReactNode;
  pathColumnLabel?: ReactNode;
  emptyResultsLabel?: ReactNode;
};

type OutputDirectorySettingsProps = {
  preference?: string;
  label?: ReactNode;
  placeholder?: string;
  chooseDirectoryLabel?: ReactNode;
  description?: ReactNode;
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
  FileDropConverter: (props) => (
    <FileDropConverter {...props} actions={actions} pluginId={pluginId} />
  ),
  OutputDirectorySettings: (props) => (
    <OutputDirectorySettings {...props} pluginId={pluginId} />
  ),
  ActionPlayground: (props) => (
    <ActionPlayground {...props} actions={actions} />
  ),
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
    return <iframe key={src} src={src} title={title} className={className} />;
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

type FileDropConverterResult = {
  fileName: string;
  body: string;
};

type FileDropConverterSavedResult = {
  fileName: string;
  path: string;
  size: number;
};

const DEFAULT_FILE_DROP_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_OUTPUT_DIRECTORY_PREFERENCE = "downloadDirectory";

const FileDropConverter = ({
  action,
  accept = ".txt,.md,.markdown,text/plain,text/markdown",
  multiple = false,
  maxBytes = DEFAULT_FILE_DROP_MAX_BYTES,
  maxFiles = 1,
  outputDirectoryPreference = DEFAULT_OUTPUT_DIRECTORY_PREFERENCE,
  description = "Converted files are written to the configured output directory.",
  chooseFileLabel = "Choose File",
  emptyLabel = "Drop a text file here",
  convertingLabel = "Converting",
  resultsLabel = "Results",
  revealLabel = "Reveal",
  clearLabel = "Clear",
  fileColumnLabel = "File",
  sizeColumnLabel = "Size",
  pathColumnLabel = "Path",
  emptyResultsLabel = "No output yet",
  actions,
  pluginId,
}: FileDropConverterProps & {
  actions: PluginActions;
  pluginId: string;
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [directory, setDirectory] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<FileDropConverterSavedResult[]>([]);

  useEffect(() => {
    let cancelled = false;

    const loadDirectory = async () => {
      try {
        const saved = await readPluginPreference(
          pluginId,
          outputDirectoryPreference,
        );
        const fallback = saved ?? (await fileApi.getDefaultDownloadDirectory());

        if (!cancelled) {
          setDirectory(fallback);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void loadDirectory();

    return () => {
      cancelled = true;
    };
  }, [outputDirectoryPreference, pluginId]);

  const saveConverterOutputs = async (
    sourceName: string,
    result: unknown,
  ): Promise<FileDropConverterSavedResult[]> => {
    if (!directory) {
      throw new Error("Output directory is not available");
    }

    const outputs = normalizeFileDropConverterResults(sourceName, result);
    const savedPaths = await Promise.all(
      outputs.map((output) =>
        fileApi.writePluginTextOutput({
          directory,
          fileName: output.fileName,
          body: output.body,
        }),
      ),
    );
    const savedResults = outputs.map((output, index) => ({
      fileName: output.fileName,
      path: savedPaths[index],
      size: output.body.length,
    }));

    setResults(savedResults);
    setMessage(null);

    return savedResults;
  };

  const convertFiles = async (files: File[]) => {
    if (!directory) {
      throw new Error("Output directory is not available");
    }

    if (files.length === 0) {
      throw new Error("File is required");
    }

    if (files.length > maxFiles) {
      throw new Error(`Too many files: ${files.length} exceeds ${maxFiles}`);
    }

    const payloadFiles = await Promise.all(
      files.map(async (file) => {
        ensureSupportedTextFile(file.name, file.type);

        if (file.size > maxBytes) {
          throw new Error(
            `File is too large: ${formatBytes(file.size)} exceeds ${formatBytes(maxBytes)}`,
          );
        }

        return {
          name: file.name,
          type: file.type,
          contentType: file.type,
          size: file.size,
          text: await file.text(),
        };
      }),
    );
    const result = await invokePluginAction(actions, action, {
      ...(multiple ? { files: payloadFiles } : payloadFiles[0]),
    });

    await saveConverterOutputs(payloadFiles[0]?.name ?? "converted.txt", result);
  };

  const convertSourcePaths = async (sourcePaths: string[]) => {
    if (sourcePaths.length === 0) {
      throw new Error("File is required");
    }

    if (sourcePaths.length > maxFiles) {
      throw new Error(`Too many files: ${sourcePaths.length} exceeds ${maxFiles}`);
    }

    const payloadFiles = await Promise.all(
      sourcePaths.map(async (sourcePath) => {
        const name = sourcePath.split(/[\\/]/).pop() || "dropped-file.txt";

        ensureSupportedTextFile(name, "");

        const text = await fileApi.readPluginTextInput(sourcePath);

        return {
          name,
          type: "",
          contentType: "",
          size: text.length,
          text,
          sourcePath,
        };
      }),
    );
    const result = await invokePluginAction(actions, action, {
      ...(multiple ? { files: payloadFiles } : payloadFiles[0]),
    });

    await saveConverterOutputs(payloadFiles[0]?.name ?? "converted.txt", result);
  };

  const runFiles = async (files: File[]) => {
    if (files.length === 0 || running) {
      return;
    }

    setRunning(true);
    setMessage(null);
    setResults([]);

    try {
      await convertFiles(files);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const runSourcePaths = async (sourcePaths: string[]) => {
    if (sourcePaths.length === 0 || running) {
      return;
    }

    setRunning(true);
    setMessage(null);
    setResults([]);

    try {
      await convertSourcePaths(sourcePaths);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragActive(true);
          return;
        }

        if (event.payload.type === "leave") {
          setDragActive(false);
          return;
        }

        setDragActive(false);
        void runSourcePaths(
          multiple ? event.payload.paths : event.payload.paths.slice(0, 1),
        );
      })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }

        unlisten = dispose;
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [action, actions, directory, maxFiles, maxBytes, multiple, running]);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    void runFiles(
      Array.from(event.dataTransfer.files).slice(
        0,
        multiple ? undefined : 1,
      ),
    );
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void runFiles(
      Array.from(event.target.files ?? []).slice(
        0,
        multiple ? undefined : 1,
      ),
    );
    event.target.value = "";
  };
  const clearResults = () => {
    setResults([]);
    setMessage(null);
  };

  return (
    <div className="space-y-4 py-3">
      {description && (
        <p className="text-sm leading-6 text-text-muted">{description}</p>
      )}
      <div
        data-glimpse-plugin-file-drop-converter
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={handleDrop}
        className={[
          "flex min-h-40 flex-col items-center justify-center gap-3 rounded-sm border border-dashed px-4 py-8 text-center transition-colors",
          dragActive
            ? "border-accent bg-accent/10"
            : "border-border-main bg-main-bg hover:border-accent/70",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="text-sm font-medium text-text-main">
          {running ? convertingLabel : emptyLabel}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            inputRef.current?.click();
          }}
          disabled={running}
          className={getButtonClassName("secondary")}
        >
          {chooseFileLabel}
        </button>
      </div>
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {resultsLabel}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void openerApi.revealInExplorer(results[0].path)}
              disabled={!results[0]}
              className={getButtonClassName("secondary")}
            >
              {revealLabel}
            </button>
            <button
              type="button"
              onClick={clearResults}
              disabled={results.length === 0 && !message}
              className={getButtonClassName("secondary")}
            >
              {clearLabel}
            </button>
          </div>
        </div>

        <div className="overflow-hidden border-y border-border-main/60">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="text-text-muted">
              <tr className="border-b border-border-main/60">
                <th className="w-[35%] px-2 py-2 font-medium">
                  {fileColumnLabel}
                </th>
                <th className="w-20 px-2 py-2 font-medium">
                  {sizeColumnLabel}
                </th>
                <th className="px-2 py-2 font-medium">{pathColumnLabel}</th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-2 py-3 text-text-muted">
                    {message ?? emptyResultsLabel}
                  </td>
                </tr>
              ) : (
                results.map((result) => (
                  <tr key={result.path} className="border-b border-border-main/40 last:border-b-0">
                    <td className="truncate px-2 py-2 text-text-main">
                      {result.fileName}
                    </td>
                    <td className="px-2 py-2 font-mono text-text-muted">
                      {formatBytes(result.size)}
                    </td>
                    <td className="truncate px-2 py-2 font-mono text-text-muted">
                      {result.path}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

const OutputDirectorySettings = ({
  preference = DEFAULT_OUTPUT_DIRECTORY_PREFERENCE,
  label = "Output directory",
  placeholder = "Output directory",
  chooseDirectoryLabel = "Open",
  description,
  pluginId,
}: OutputDirectorySettingsProps & { pluginId: string }) => {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadValue = async () => {
      try {
        const saved = await readPluginPreference(pluginId, preference);
        const fallback = saved ?? (await fileApi.getDefaultDownloadDirectory());

        if (!cancelled) {
          setValue(fallback);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void loadValue();

    return () => {
      cancelled = true;
    };
  }, [pluginId, preference]);

  const saveValue = async (nextValue = value) => {
    try {
      await writePluginPreference(pluginId, preference, nextValue);
      setMessage("Saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const chooseDirectory = async () => {
    const selected = await settingsApi.selectTargetDirectory();

    if (typeof selected !== "string") {
      return;
    }

    setValue(selected);
    await saveValue(selected);
  };

  return (
    <div className="space-y-2 py-3">
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-text-main"
      >
        {label}
      </label>
      {description && (
        <div className="text-sm text-text-muted">{description}</div>
      )}
      <div className="flex gap-2">
        <input
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void saveValue()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded border border-border-main bg-main-bg px-3 py-2 text-sm text-text-main outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => void chooseDirectory()}
          className={getButtonClassName("secondary")}
        >
          {chooseDirectoryLabel}
        </button>
      </div>
      {message && <div className="text-xs text-text-muted">{message}</div>}
    </div>
  );
};

const normalizeFileDropConverterResult = (
  sourceName: string,
  result: unknown,
): FileDropConverterResult => {
  if (typeof result === "string") {
    return {
      fileName: convertedFileName(sourceName, "txt"),
      body: result,
    };
  }

  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const body = record.body ?? record.text ?? record.content;

    if (typeof body !== "string") {
      throw new Error("Converter action must return text output");
    }

    return {
      fileName:
        typeof record.fileName === "string" && record.fileName.trim()
          ? record.fileName
          : convertedFileName(
              sourceName,
              typeof record.extension === "string" ? record.extension : "txt",
            ),
      body,
    };
  }

  throw new Error("Converter action must return text output");
};

const normalizeFileDropConverterResults = (
  sourceName: string,
  result: unknown,
): FileDropConverterResult[] => {
  if (Array.isArray(result)) {
    if (result.length === 0) {
      throw new Error("Converter action must return at least one output");
    }

    return result.map((entry, index) =>
      normalizeFileDropConverterResult(
        addFileNameIndex(sourceName, index),
        entry,
      ),
    );
  }

  return [normalizeFileDropConverterResult(sourceName, result)];
};

const addFileNameIndex = (sourceName: string, index: number): string => {
  if (index === 0) {
    return sourceName;
  }

  const extension = sourceName.match(/(\.[^.\\/]+)$/)?.[1] ?? "";
  const stem = extension ? sourceName.slice(0, -extension.length) : sourceName;

  return `${stem}-${index + 1}${extension}`;
};

const ensureSupportedTextFile = (fileName: string, type: string) => {
  const isTextExtension = /\.(txt|md|markdown)$/i.test(fileName);
  const isTextMime = ["text/plain", "text/markdown"].includes(type);

  if (!isTextExtension && !isTextMime) {
    throw new Error("Only text and Markdown files are supported");
  }
};

const convertedFileName = (sourceName: string, extension: string): string => {
  const cleanExtension = extension.trim().replace(/^\./, "") || "txt";
  const stem = sourceName.replace(/\.[^.\\/]+$/, "") || "converted";

  return `${stem}.converted.${cleanExtension}`;
};

const formatBytes = (bytes: number): string => {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
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
