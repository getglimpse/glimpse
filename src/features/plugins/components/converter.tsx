import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { fileApi, type PluginFileGrant } from "@/api/file";
import { openerApi } from "@/api/opener";
import { useOptionalI18nContext } from "@/i18n/I18nProvider";

import { readPluginPreference, writePluginPreference } from "./settings";
import { invokePluginAction, type PluginActions } from "./actions";
import { getPluginButtonClassName } from "./styles";
import { usePluginPageActivity } from "./tool";

export type FileDropConverterProps = {
  action: string;
  accept?: string;
  multiple?: boolean;
  maxBytes?: number;
  maxFiles?: number;
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
  | { kind: "sourcePaths"; sourcePaths: PluginFileGrant[] };

type FileDropConverterOutputMode = "create" | "overwrite";

const DEFAULT_FILE_DROP_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_OUTPUT_DIRECTORY_PREFERENCE = "downloadDirectory";
const CONVERTED_FILE_PREFIX_PREFERENCE = "convertedFilePrefix";
const DEFAULT_CONVERTED_FILE_PREFIX = ".converted";

export const FileDropConverter = ({
  action,
  accept = ".txt,.md,.markdown,text/plain,text/markdown",
  multiple = false,
  maxBytes = DEFAULT_FILE_DROP_MAX_BYTES,
  maxFiles = 1,
  outputModes = ["create", "overwrite"],
  outputDirectoryPreference = DEFAULT_OUTPUT_DIRECTORY_PREFERENCE,
  description = "Converted files are written to the configured output directory.",
  chooseFileLabel = "Choose File",
  emptyLabel = "Drop a text file here",
  convertingLabel = "Converting",
  runLabel = "Run",
  createModeLabel,
  overwriteModeLabel,
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
  const i18n = useOptionalI18nContext();
  const pageActive = usePluginPageActivity();
  const resolvedCreateModeLabel =
    createModeLabel ?? i18n?.LL.pluginPage.converter.create() ?? "Create new";
  const resolvedOverwriteModeLabel =
    overwriteModeLabel ??
    i18n?.LL.pluginPage.converter.overwrite() ??
    "Overwrite";
  const outputModeLabel =
    i18n?.LL.pluginPage.converter.outputMode() ?? "Output mode";
  const overwriteDroppedFilesOnlyMessage =
    i18n?.LL.pluginPage.converter.overwriteDroppedFilesOnly() ??
    "Overwrite requires files dropped from the file system";
  const [dragActive, setDragActive] = useState(false);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [directory, setDirectory] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<FileDropConverterSavedResult[]>([]);
  const [stagedInput, setStagedInput] = useState<FileDropConverterInput | null>(
    null,
  );
  const [outputMode, setOutputMode] =
    useState<FileDropConverterOutputMode>("create");
  const overwriteAvailable = outputModes.includes("overwrite");

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
        ensureAcceptedFile(file.name, file.type, accept);

        if (file.size > maxBytes) {
          throw new Error(
            `File is too large: ${formatBytes(file.size)} exceeds ${formatBytes(maxBytes)}`,
          );
        }
      }
      return;
    }

    for (const source of input.sourcePaths) {
      ensureSupportedTextFile(
        source.path.split(/[\\/]/).pop() || "dropped-file.txt",
        "",
      );
      ensureAcceptedFile(
        source.path.split(/[\\/]/).pop() || "dropped-file.txt",
        "",
        accept,
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
      input.sourcePaths.map(async (source) => {
        const name = source.path.split(/[\\/]/).pop() || "dropped-file.txt";
        const text = await fileApi.readPluginTextInput(source.token);

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
          sourcePath: source.path,
        };
      }),
    );
  };

  const persistConverterOutputs = async (
    input: FileDropConverterInput,
    sourceName: string,
    result: unknown,
    mode: FileDropConverterOutputMode,
  ): Promise<boolean> => {
    const prefix =
      mode === "create"
        ? normalizeConvertedFilePrefix(
            await readPluginPreference(
              pluginId,
              CONVERTED_FILE_PREFIX_PREFERENCE,
            ),
          )
        : DEFAULT_CONVERTED_FILE_PREFIX;
    const outputs = normalizeFileDropConverterResults(
      sourceName,
      result,
      prefix,
    );

    if (mode === "overwrite") {
      if (input.kind !== "sourcePaths") {
        throw new Error(overwriteDroppedFilesOnlyMessage);
      }

      if (outputs.length !== input.sourcePaths.length) {
        throw new Error(
          "Overwrite requires exactly one output for each input file",
        );
      }

      const savedPaths = await Promise.all(
        outputs.map((output, index) =>
          fileApi.overwritePluginTextInput({
            grantToken: input.sourcePaths[index].token,
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
      return true;
    }

    const preferredDirectory =
      (await readPluginPreference(pluginId, outputDirectoryPreference)) ??
      directory;
    if (!preferredDirectory) {
      throw new Error("Output directory is not available");
    }

    let outputGrant =
      await fileApi.getPluginOutputDirectoryGrant(preferredDirectory);
    if (!outputGrant) {
      outputGrant = await fileApi.selectOutputDirectory();
      if (!outputGrant) {
        return false;
      }
      setDirectory(outputGrant.path);
      await writePluginPreference(
        pluginId,
        outputDirectoryPreference,
        outputGrant.path,
      );
    }

    const savedPaths = await Promise.all(
      outputs.map((output) =>
        fileApi.writePluginTextOutput({
          grantToken: outputGrant.token,
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
    return true;
  };

  const runInput = async (
    input: FileDropConverterInput,
    mode: FileDropConverterOutputMode,
  ) => {
    if (runningRef.current) {
      return;
    }

    if (mode === "overwrite" && input.kind !== "sourcePaths") {
      setMessage(overwriteDroppedFilesOnlyMessage);
      return;
    }

    runningRef.current = true;
    setRunning(true);
    setMessage(null);

    try {
      const payloadFiles = await preparePayloadFiles(input);
      const result = await invokePluginAction(actions, action, {
        ...(multiple ? { files: payloadFiles } : payloadFiles[0]),
      });

      const saved = await persistConverterOutputs(
        input,
        payloadFiles[0]?.name ?? "converted.txt",
        result,
        mode,
      );
      if (saved) {
        setStagedInput(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  const stageInput = (input: FileDropConverterInput) => {
    if (runningRef.current) {
      return;
    }

    try {
      validateStagedInput(input);
      setStagedInput(input);
      setOutputMode((current) => (input.kind === "files" ? "create" : current));
      setMessage(null);
    } catch (error) {
      setStagedInput(null);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (!pageActive) {
      setDragActive(false);
      return;
    }

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
        const paths = multiple
          ? event.payload.paths
          : event.payload.paths.slice(0, 1);
        void fileApi
          .claimPluginTextInputs(paths)
          .then((sourcePaths) =>
            stageInput({ kind: "sourcePaths", sourcePaths }),
          )
          .catch((error) =>
            setMessage(error instanceof Error ? error.message : String(error)),
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
  }, [
    action,
    actions,
    directory,
    maxFiles,
    maxBytes,
    multiple,
    pageActive,
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

  const chooseFiles = async () => {
    try {
      const sourcePaths = await fileApi.selectPluginTextInputs(
        multiple,
        acceptedTextExtensions(accept),
      );
      if (sourcePaths) {
        stageInput({ kind: "sourcePaths", sourcePaths });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const clearResults = () => {
    setResults([]);
    setMessage(null);
  };
  const stagedNames = stagedInput
    ? stagedInput.kind === "files"
      ? stagedInput.files.map((file) => file.name)
      : stagedInput.sourcePaths.map(
          (source) => source.path.split(/[\\/]/).pop() || "dropped-file.txt",
        )
    : [];
  const stagedSummary =
    stagedNames.length <= 1
      ? (stagedNames[0] ?? "")
      : `${stagedNames[0]} +${stagedNames.length - 1}`;
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
            aria-label={outputModeLabel}
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
              {resolvedCreateModeLabel}
            </button>
            <button
              type="button"
              aria-pressed={outputMode === "overwrite"}
              onClick={(event) => {
                event.stopPropagation();
                setOutputMode("overwrite");
              }}
              disabled={running}
              className={`border-l border-border-main px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                outputMode === "overwrite"
                  ? "bg-red-500/15 text-red-300"
                  : "text-text-muted hover:text-red-300"
              }`}
            >
              {resolvedOverwriteModeLabel}
            </button>
          </div>
        )}
        <div className="text-sm font-medium text-text-main">
          {running ? convertingLabel : stagedInput ? stagedSummary : emptyLabel}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void chooseFiles();
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

  const saveValue = async (nextValue: string) => {
    try {
      await writePluginPreference(pluginId, preference, nextValue);
      setMessage("Saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const chooseDirectory = async () => {
    const selected = await fileApi.selectOutputDirectory();

    if (!selected) {
      return;
    }

    setValue(selected.path);
    await saveValue(selected.path);
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
          readOnly
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

export const ConvertedFilePrefixSettings = ({
  pluginId,
}: {
  pluginId: string;
}) => {
  const inputId = useId();
  const i18n = useOptionalI18nContext();
  const [value, setValue] = useState(DEFAULT_CONVERTED_FILE_PREFIX);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readPluginPreference(pluginId, CONVERTED_FILE_PREFIX_PREFERENCE)
      .then((saved) => {
        if (!cancelled) setValue(normalizeConvertedFilePrefix(saved));
      })
      .catch((error) => {
        if (!cancelled)
          setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId]);

  const save = async () => {
    const normalized = normalizeConvertedFilePrefix(value);
    try {
      await writePluginPreference(
        pluginId,
        CONVERTED_FILE_PREFIX_PREFERENCE,
        normalized === DEFAULT_CONVERTED_FILE_PREFIX ? null : normalized,
      );
      setValue(normalized);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="space-y-2 py-3">
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-text-main"
      >
        {i18n?.LL.pluginPage.converter.fileNamePrefix() ??
          "Converted filename prefix"}
      </label>
      <p className="text-sm text-text-muted">
        {i18n?.LL.pluginPage.converter.fileNamePrefixDescription() ??
          "Text inserted before the output extension (for example, notes.converted.txt)."}
      </p>
      <input
        id={inputId}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        placeholder={DEFAULT_CONVERTED_FILE_PREFIX}
        className="w-full rounded border border-border-main bg-main-bg px-3 py-2 text-sm text-text-main outline-none focus:border-accent"
      />
      {message && <div className="text-xs text-red-300">{message}</div>}
    </div>
  );
};

const normalizeFileDropConverterResult = (
  sourceName: string,
  result: unknown,
  prefix: string,
): FileDropConverterResult => {
  if (typeof result === "string") {
    return {
      fileName: convertedFileName(sourceName, "txt", prefix),
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
          ? replaceConvertedFilePrefix(record.fileName, prefix)
          : convertedFileName(
              sourceName,
              typeof record.extension === "string" ? record.extension : "txt",
              prefix,
            ),
      body,
    };
  }

  throw new Error("Converter action must return text output");
};

const normalizeFileDropConverterResults = (
  sourceName: string,
  result: unknown,
  prefix: string,
): FileDropConverterResult[] => {
  if (Array.isArray(result)) {
    if (result.length === 0) {
      throw new Error("Converter action must return at least one output");
    }

    return result.map((entry, index) =>
      normalizeFileDropConverterResult(
        addFileNameIndex(sourceName, index),
        entry,
        prefix,
      ),
    );
  }

  return [normalizeFileDropConverterResult(sourceName, result, prefix)];
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

const acceptedTextExtensions = (accept: string): string[] => {
  const entries = accept.split(",").map((entry) => entry.trim().toLowerCase());
  const extensions = new Set(
    entries
      .filter((entry) => /^\.(txt|md|markdown)$/.test(entry))
      .map((entry) => entry.slice(1)),
  );
  if (entries.includes("text/plain")) extensions.add("txt");
  if (entries.includes("text/markdown")) {
    extensions.add("md");
    extensions.add("markdown");
  }
  return extensions.size > 0 ? [...extensions] : ["txt", "md", "markdown"];
};

const ensureAcceptedFile = (name: string, type: string, accept: string) => {
  const extensions = acceptedTextExtensions(accept);
  const extension = name.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase();
  if (!extension || !extensions.includes(extension)) {
    if (
      !(type === "text/plain" && extensions.includes("txt")) &&
      !(type === "text/markdown" && extensions.includes("md"))
    ) {
      throw new Error("File type is not accepted by this converter");
    }
  }
};

const normalizeConvertedFilePrefix = (value: string | null): string =>
  value?.trim() || DEFAULT_CONVERTED_FILE_PREFIX;

const replaceConvertedFilePrefix = (fileName: string, prefix: string): string =>
  fileName.replace(/\.converted(?=\.[^.\\/]+$)/i, () => prefix);

const convertedFileName = (
  sourceName: string,
  extension: string,
  prefix: string,
): string => {
  const cleanExtension = extension.trim().replace(/^\./, "") || "txt";
  const stem = sourceName.replace(/\.[^.\\/]+$/, "") || "converted";

  return `${stem}${prefix}.${cleanExtension}`;
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
