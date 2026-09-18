import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { fileApi } from "@/api/file";
import { openerApi } from "@/api/opener";
import { settingsApi } from "@/api/settings";

import {
  isPluginConverterExecutionMode,
  publishPluginConverterExecution,
  subscribeToPluginConverterExecution,
  type PluginConverterExecutionMode,
} from "./converterExecution";
import { readPluginPreference, writePluginPreference } from "./settings";
import { invokePluginAction, type PluginActions } from "./actions";
import { getPluginButtonClassName } from "./styles";

export type FileDropConverterProps = {
  action: string;
  accept?: string;
  multiple?: boolean;
  maxBytes?: number;
  maxFiles?: number;
  execution?: "manual" | "immediate";
  executionPreference?: string;
  outputModes?: Array<"create" | "overwrite">;
  outputDirectoryPreference?: string;
  title?: ReactNode;
  description?: ReactNode;
  chooseFileLabel?: ReactNode;
  emptyLabel?: ReactNode;
  successLabel?: ReactNode;
  convertingLabel?: ReactNode;
  runLabel?: ReactNode;
  createModeLabel?: ReactNode;
  overwriteModeLabel?: ReactNode;
  resultsLabel?: ReactNode;
  revealLabel?: ReactNode;
  clearLabel?: ReactNode;
  fileColumnLabel?: ReactNode;
  sizeColumnLabel?: ReactNode;
  pathColumnLabel?: ReactNode;
  emptyResultsLabel?: ReactNode;
};

export type ConverterExecutionSettingsProps = {
  pluginId: string;
  preference: string;
  title: ReactNode;
  defaultExecution?: PluginConverterExecutionMode;
  manualLabel?: ReactNode;
  immediateLabel?: ReactNode;
};

export type OutputDirectorySettingsProps = {
  preference?: string;
  label?: ReactNode;
  placeholder?: string;
  chooseDirectoryLabel?: ReactNode;
  description?: ReactNode;
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

type FileDropConverterInput =
  | { kind: "files"; files: File[] }
  | { kind: "sourcePaths"; sourcePaths: string[] };

type FileDropConverterOutputMode = "create" | "overwrite";

const DEFAULT_FILE_DROP_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_OUTPUT_DIRECTORY_PREFERENCE = "downloadDirectory";

export const FileDropConverter = ({
  action,
  accept = ".txt,.md,.markdown,text/plain,text/markdown",
  multiple = false,
  maxBytes = DEFAULT_FILE_DROP_MAX_BYTES,
  maxFiles = 1,
  execution = "manual",
  executionPreference,
  outputModes = ["create"],
  outputDirectoryPreference = DEFAULT_OUTPUT_DIRECTORY_PREFERENCE,
  description = "Converted files are written to the configured output directory.",
  chooseFileLabel = "Choose File",
  emptyLabel = "Drop a text file here",
  convertingLabel = "Converting",
  runLabel = "Run",
  createModeLabel = "Create new",
  overwriteModeLabel = "Overwrite",
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
  const [stagedInput, setStagedInput] = useState<FileDropConverterInput | null>(
    null,
  );
  const [outputMode, setOutputMode] =
    useState<FileDropConverterOutputMode>("create");
  const [executionMode, setExecutionMode] = useState(execution);
  const overwriteAvailable = outputModes.includes("overwrite");

  useEffect(() => {
    setExecutionMode(execution);

    if (!executionPreference) {
      return;
    }

    let cancelled = false;
    let receivedChange = false;
    const unsubscribe = subscribeToPluginConverterExecution((change) => {
      if (
        change.pluginId === pluginId &&
        change.preference === executionPreference
      ) {
        receivedChange = true;
        setExecutionMode(change.execution);
      }
    });

    void readPluginPreference(pluginId, executionPreference)
      .then((saved) => {
        if (
          !cancelled &&
          !receivedChange &&
          isPluginConverterExecutionMode(saved)
        ) {
          setExecutionMode(saved);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [execution, executionPreference, pluginId]);

  useEffect(() => {
    if (executionMode === "immediate") {
      setOutputMode("create");
    }
  }, [executionMode]);

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

  const validateStagedInput = (input: FileDropConverterInput) => {
    const count =
      input.kind === "files" ? input.files.length : input.sourcePaths.length;

    if (count === 0) {
      throw new Error("File is required");
    }

    if (count > maxFiles) {
      throw new Error(`Too many files: ${count} exceeds ${maxFiles}`);
    }

    if (input.kind === "files") {
      for (const file of input.files) {
        ensureSupportedTextFile(file.name, file.type);

        if (file.size > maxBytes) {
          throw new Error(
            `File is too large: ${formatBytes(file.size)} exceeds ${formatBytes(maxBytes)}`,
          );
        }
      }
      return;
    }

    for (const sourcePath of input.sourcePaths) {
      ensureSupportedTextFile(
        sourcePath.split(/[\\/]/).pop() || "dropped-file.txt",
        "",
      );
    }
  };

  const preparePayloadFiles = async (input: FileDropConverterInput) => {
    if (input.kind === "files") {
      return Promise.all(
        input.files.map(async (file) => ({
          name: file.name,
          type: file.type,
          contentType: file.type,
          size: file.size,
          text: await file.text(),
        })),
      );
    }

    return Promise.all(
      input.sourcePaths.map(async (sourcePath) => {
        const name = sourcePath.split(/[\\/]/).pop() || "dropped-file.txt";
        const text = await fileApi.readPluginTextInput(sourcePath);

        if (text.length > maxBytes) {
          throw new Error(
            `File is too large: ${formatBytes(text.length)} exceeds ${formatBytes(maxBytes)}`,
          );
        }

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
  };

  const persistConverterOutputs = async (
    input: FileDropConverterInput,
    sourceName: string,
    result: unknown,
    mode: FileDropConverterOutputMode,
  ) => {
    const outputs = normalizeFileDropConverterResults(sourceName, result);

    if (mode === "overwrite") {
      if (input.kind !== "sourcePaths") {
        throw new Error(
          "Overwrite requires files dropped from the file system",
        );
      }

      if (outputs.length !== input.sourcePaths.length) {
        throw new Error(
          "Overwrite requires exactly one output for each input file",
        );
      }

      const savedPaths = await Promise.all(
        outputs.map((output, index) =>
          fileApi.overwritePluginTextInput({
            filePath: input.sourcePaths[index],
            body: output.body,
          }),
        ),
      );

      setResults(
        outputs.map((output, index) => ({
          fileName: savedPaths[index].split(/[\\/]/).pop() || output.fileName,
          path: savedPaths[index],
          size: output.body.length,
        })),
      );
      setMessage(null);
      return;
    }

    if (!directory) {
      throw new Error("Output directory is not available");
    }

    const savedPaths = await Promise.all(
      outputs.map((output) =>
        fileApi.writePluginTextOutput({
          directory,
          fileName: output.fileName,
          body: output.body,
        }),
      ),
    );

    setResults(
      outputs.map((output, index) => ({
        fileName: output.fileName,
        path: savedPaths[index],
        size: output.body.length,
      })),
    );
    setMessage(null);
  };

  const runInput = async (
    input: FileDropConverterInput,
    mode: FileDropConverterOutputMode,
  ) => {
    if (running) {
      return;
    }

    setRunning(true);
    setMessage(null);

    try {
      const payloadFiles = await preparePayloadFiles(input);
      const result = await invokePluginAction(actions, action, {
        ...(multiple ? { files: payloadFiles } : payloadFiles[0]),
      });

      await persistConverterOutputs(
        input,
        payloadFiles[0]?.name ?? "converted.txt",
        result,
        mode,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const stageInput = (input: FileDropConverterInput) => {
    if (running) {
      return;
    }

    try {
      validateStagedInput(input);
      setStagedInput(input);
      setOutputMode("create");
      setMessage(null);

      if (executionMode === "immediate") {
        void runInput(input, "create");
      }
    } catch (error) {
      setStagedInput(null);
      setOutputMode("create");
      setMessage(error instanceof Error ? error.message : String(error));
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
        stageInput({
          kind: "sourcePaths",
          sourcePaths: multiple
            ? event.payload.paths
            : event.payload.paths.slice(0, 1),
        });
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
  }, [
    action,
    actions,
    directory,
    executionMode,
    maxFiles,
    maxBytes,
    multiple,
    running,
  ]);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    stageInput({
      kind: "files",
      files: Array.from(event.dataTransfer.files).slice(
        0,
        multiple ? undefined : 1,
      ),
    });
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    stageInput({
      kind: "files",
      files: Array.from(event.target.files ?? []).slice(
        0,
        multiple ? undefined : 1,
      ),
    });
    event.target.value = "";
  };
  const clearResults = () => {
    setResults([]);
    setMessage(null);
  };
  const stagedNames = stagedInput
    ? stagedInput.kind === "files"
      ? stagedInput.files.map((file) => file.name)
      : stagedInput.sourcePaths.map(
          (sourcePath) => sourcePath.split(/[\\/]/).pop() || "dropped-file.txt",
        )
    : [];
  const stagedSummary =
    stagedNames.length <= 1
      ? (stagedNames[0] ?? "")
      : `${stagedNames[0]} +${stagedNames.length - 1}`;
  const canOverwrite =
    overwriteAvailable &&
    executionMode === "manual" &&
    stagedInput?.kind === "sourcePaths";

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
          "relative flex min-h-40 flex-col items-center justify-center gap-3 rounded-sm border border-dashed px-4 text-center transition-colors",
          overwriteAvailable ? "pt-16 pb-8" : "py-8",
          dragActive
            ? "border-accent bg-accent/10"
            : "border-border-main bg-main-bg hover:border-accent/70",
        ].join(" ")}
      >
        {overwriteAvailable && (
          <div
            role="group"
            aria-label="Output mode"
            className="absolute top-3 right-3 inline-flex overflow-hidden rounded-sm border border-border-main bg-main-bg"
          >
            <button
              type="button"
              aria-pressed={outputMode === "create"}
              onClick={(event) => {
                event.stopPropagation();
                setOutputMode("create");
              }}
              disabled={running}
              className={`px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                outputMode === "create"
                  ? "bg-item-hover text-text-main"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              {createModeLabel}
            </button>
            <button
              type="button"
              aria-pressed={outputMode === "overwrite"}
              onClick={(event) => {
                event.stopPropagation();
                setOutputMode("overwrite");
              }}
              disabled={running || !canOverwrite}
              title={
                canOverwrite
                  ? undefined
                  : executionMode === "immediate"
                    ? "Overwrite is only available with manual execution"
                    : "Overwrite requires files dropped from the file system"
              }
              className={`border-l border-border-main px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                outputMode === "overwrite"
                  ? "bg-red-500/15 text-red-300"
                  : "text-text-muted hover:text-red-300"
              }`}
            >
              {overwriteModeLabel}
            </button>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="text-sm font-medium text-text-main">
          {running ? convertingLabel : stagedInput ? stagedSummary : emptyLabel}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            inputRef.current?.click();
          }}
          disabled={running}
          className={getPluginButtonClassName("secondary")}
        >
          {chooseFileLabel}
        </button>
      </div>
      {stagedInput && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border-main bg-main-bg px-3 py-2">
          <div
            className="min-w-0 truncate text-xs text-text-muted"
            title={stagedNames.join(", ")}
          >
            {stagedSummary}
          </div>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => void runInput(stagedInput, outputMode)}
              disabled={running}
              className={getPluginButtonClassName(
                outputMode === "overwrite" ? "danger" : "default",
              )}
            >
              {running ? convertingLabel : runLabel}
            </button>
          </div>
        </div>
      )}
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
              className={getPluginButtonClassName("secondary")}
            >
              {revealLabel}
            </button>
            <button
              type="button"
              onClick={clearResults}
              disabled={results.length === 0 && !message}
              className={getPluginButtonClassName("secondary")}
            >
              {clearLabel}
            </button>
          </div>
        </div>

        {message && results.length > 0 && (
          <div className="mb-2 text-xs text-red-300">{message}</div>
        )}

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
                  <tr
                    key={result.path}
                    className="border-b border-border-main/40 last:border-b-0"
                  >
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

export const ConverterExecutionSettings = ({
  pluginId,
  preference,
  title,
  defaultExecution = "manual",
  manualLabel = "Manual",
  immediateLabel = "Immediate",
}: ConverterExecutionSettingsProps) => {
  const [execution, setExecution] =
    useState<PluginConverterExecutionMode>(defaultExecution);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setExecution(defaultExecution);
    void readPluginPreference(pluginId, preference)
      .then((saved) => {
        if (!cancelled && isPluginConverterExecutionMode(saved)) {
          setExecution(saved);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [defaultExecution, pluginId, preference]);

  const updateExecution = async (next: PluginConverterExecutionMode) => {
    const previous = execution;

    setExecution(next);
    setMessage(null);
    publishPluginConverterExecution({
      pluginId,
      preference,
      execution: next,
    });

    try {
      await writePluginPreference(pluginId, preference, next);
      publishPluginConverterExecution({
        pluginId,
        preference,
        execution: next,
      });
    } catch (error) {
      setExecution(previous);
      publishPluginConverterExecution({
        pluginId,
        preference,
        execution: previous,
      });
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h2>
      <div className="border-y border-border-main/60">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <div className="text-sm text-text-main">Execution</div>
            <div className="mt-0.5 text-xs text-text-muted">
              Choose when conversion starts after selecting or dropping files.
            </div>
          </div>
          <div
            role="group"
            aria-label="Execution mode"
            className="inline-flex overflow-hidden rounded-sm border border-border-main"
          >
            <button
              type="button"
              aria-pressed={execution === "manual"}
              onClick={() => void updateExecution("manual")}
              className={`px-3 py-1.5 text-xs transition-colors ${
                execution === "manual"
                  ? "bg-item-hover text-text-main"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              {manualLabel}
            </button>
            <button
              type="button"
              aria-pressed={execution === "immediate"}
              onClick={() => void updateExecution("immediate")}
              className={`border-l border-border-main px-3 py-1.5 text-xs transition-colors ${
                execution === "immediate"
                  ? "bg-item-hover text-text-main"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              {immediateLabel}
            </button>
          </div>
        </div>
        {message && <div className="pb-3 text-xs text-red-300">{message}</div>}
      </div>
    </section>
  );
};

export const OutputDirectorySettings = ({
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
          className={getPluginButtonClassName("secondary")}
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
