import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { Copy, FlipHorizontal2, Save, X } from "lucide-react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { fileApi, type PluginFileGrant } from "@/api/file";
import { openerApi } from "@/api/opener";
import { copyText } from "@/utils/clipboard";
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
  allowPaste?: boolean;
  execution?: "auto" | "manual";
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

type FileDropConverterResultRow = FileDropConverterResult & {
  id: number;
  size: number;
  sourceGrant?: PluginFileGrant;
  savedPath?: string;
  error?: string;
};

type FileDropConverterInput =
  | { kind: "files"; files: File[] }
  | { kind: "sourcePaths"; sourcePaths: PluginFileGrant[] }
  | { kind: "paste"; text: string };

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
  allowPaste = true,
  execution = "auto",
  outputModes = ["create", "overwrite"],
  outputDirectoryPreference = DEFAULT_OUTPUT_DIRECTORY_PREFERENCE,
  description = "Convert files, then save or copy each result.",
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
  const labels = i18n?.LL.pluginPage.converter;
  const [dragActive, setDragActive] = useState(false);
  const [running, setRunning] = useState(false);
  const jobIdRef = useRef(0);
  const inputRequestIdRef = useRef(0);
  const nextResultIdRef = useRef(1);
  const savingIdsRef = useRef(new Set<number>());
  const [savingIds, setSavingIds] = useState<number[]>([]);
  const [savingAll, setSavingAll] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [inputMode, setInputMode] = useState<"files" | "text">("files");
  const [pasteText, setPasteText] = useState("");
  const [directory, setDirectory] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<FileDropConverterResultRow[]>([]);
  const [stagedInput, setStagedInput] = useState<FileDropConverterInput | null>(
    null,
  );
  const [outputMode, setOutputMode] =
    useState<FileDropConverterOutputMode>("create");
  const overwriteAvailable = outputModes.includes("overwrite");
  const unsavedResults = results.filter((row) => !row.savedPath);
  const canOverwriteResults =
    unsavedResults.length > 0 &&
    unsavedResults.every((row) => Boolean(row.sourceGrant));

  useEffect(
    () => () => {
      jobIdRef.current += 1;
      inputRequestIdRef.current += 1;
    },
    [],
  );

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
    if (input.kind === "paste") {
      if (!allowPaste || !input.text) {
        throw new Error("Text is required");
      }
      if (new TextEncoder().encode(input.text).length > maxBytes) {
        throw new Error(`Text is too large: exceeds ${formatBytes(maxBytes)}`);
      }
      return;
    }
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
    if (input.kind === "paste") {
      return [
        {
          name: "pasted-text.txt",
          type: "text/plain",
          contentType: "text/plain",
          size: new TextEncoder().encode(input.text).length,
          text: input.text,
        },
      ];
    }
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

        if (new TextEncoder().encode(text).length > maxBytes) {
          throw new Error(
            `File is too large: exceeds ${formatBytes(maxBytes)}`,
          );
        }

        return {
          name,
          type: "",
          contentType: "",
          size: new TextEncoder().encode(text).length,
          text,
          sourcePath: source.path,
        };
      }),
    );
  };

  const runInput = async (input: FileDropConverterInput) => {
    const jobId = ++jobIdRef.current;
    setRunning(true);
    setMessage(null);

    try {
      const payloadFiles = await preparePayloadFiles(input);
      if (jobId !== jobIdRef.current) return;
      const result = await invokePluginAction(actions, action, {
        ...(multiple ? { files: payloadFiles } : payloadFiles[0]),
      });
      if (jobId !== jobIdRef.current) return;
      const prefix = normalizeConvertedFilePrefix(
        await readPluginPreference(pluginId, CONVERTED_FILE_PREFIX_PREFERENCE),
      );
      if (jobId !== jobIdRef.current) return;
      const outputs = normalizeFileDropConverterResults(
        payloadFiles[0]?.name ?? "converted.txt",
        result,
        prefix,
      );
      const sourceGrants =
        input.kind === "sourcePaths" &&
        outputs.length === input.sourcePaths.length
          ? input.sourcePaths
          : [];
      setResults((previous) => [
        ...previous,
        ...outputs.map((output, index) => ({
          ...output,
          id: nextResultIdRef.current++,
          size: new TextEncoder().encode(output.body).length,
          sourceGrant: sourceGrants[index],
        })),
      ]);
      setStagedInput(null);
    } catch (error) {
      if (jobId === jobIdRef.current) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (jobId === jobIdRef.current) setRunning(false);
    }
  };

  const stageInput = (input: FileDropConverterInput) => {
    try {
      validateStagedInput(input);
      setStagedInput(input);
      if (input.kind !== "sourcePaths") setOutputMode("create");
      setMessage(null);
      if (execution === "auto") void runInput(input);
    } catch (error) {
      jobIdRef.current += 1;
      setRunning(false);
      setStagedInput(null);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const saveRow = async (
    row: FileDropConverterResultRow,
  ): Promise<"saved" | "failed" | "cancelled"> => {
    if (savingIdsRef.current.has(row.id)) return "failed";
    savingIdsRef.current.add(row.id);
    setSavingIds([...savingIdsRef.current]);
    setResults((previous) =>
      previous.map((item) =>
        item.id === row.id ? { ...item, error: undefined } : item,
      ),
    );
    try {
      let savedPath: string;
      if (outputMode === "overwrite") {
        if (!row.sourceGrant) throw new Error(overwriteDroppedFilesOnlyMessage);
        try {
          savedPath = await fileApi.overwritePluginTextInput({
            grantToken: row.sourceGrant.token,
            body: row.body,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (/grant|changed|replaced/i.test(detail)) {
            throw new Error(
              labels?.permissionExpired() ??
                "Original file permission expired or changed. Select and convert the original file again.",
            );
          }
          throw error;
        }
      } else {
        const preferredDirectory =
          (await readPluginPreference(pluginId, outputDirectoryPreference)) ??
          directory;
        if (!preferredDirectory)
          throw new Error("Output directory is not available");
        let grant =
          await fileApi.getPluginOutputDirectoryGrant(preferredDirectory);
        if (!grant) {
          grant = await fileApi.selectOutputDirectory();
          if (!grant) return "cancelled";
          setDirectory(grant.path);
          await writePluginPreference(
            pluginId,
            outputDirectoryPreference,
            grant.path,
          );
        }
        savedPath = await fileApi.writePluginTextOutput({
          grantToken: grant.token,
          fileName: row.fileName,
          body: row.body,
        });
      }
      setResults((previous) =>
        previous.map((item) =>
          item.id === row.id
            ? {
                ...item,
                fileName:
                  outputMode === "overwrite"
                    ? savedPath.split(/[\\/]/).pop() || item.fileName
                    : item.fileName,
                savedPath,
                error: undefined,
              }
            : item,
        ),
      );
      return "saved";
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setResults((previous) =>
        previous.map((item) =>
          item.id === row.id ? { ...item, error: detail } : item,
        ),
      );
      return "failed";
    } finally {
      savingIdsRef.current.delete(row.id);
      setSavingIds([...savingIdsRef.current]);
    }
  };

  const saveAll = async () => {
    if (savingAll) return;
    setSavingAll(true);
    for (const row of results.filter((item) => !item.savedPath)) {
      if ((await saveRow(row)) === "cancelled") break;
    }
    setSavingAll(false);
  };

  const copyRow = async (row: FileDropConverterResultRow) => {
    try {
      const copied = row.body
        ? await copyText(row.body)
        : await navigator.clipboard.writeText("").then(() => true);
      if (copied) setCopiedId(row.id);
    } catch (error) {
      setResults((previous) =>
        previous.map((item) =>
          item.id === row.id
            ? {
                ...item,
                error: error instanceof Error ? error.message : String(error),
              }
            : item,
        ),
      );
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
        if (inputMode === "text") {
          setDragActive(false);
          return;
        }
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragActive(true);
          return;
        }

        if (event.payload.type === "leave") {
          setDragActive(false);
          return;
        }

        setDragActive(false);
        const requestId = ++inputRequestIdRef.current;
        const paths = multiple
          ? event.payload.paths
          : event.payload.paths.slice(0, 1);
        void fileApi
          .claimPluginTextInputs(paths)
          .then((sourcePaths) => {
            if (!disposed && requestId === inputRequestIdRef.current)
              stageInput({ kind: "sourcePaths", sourcePaths });
          })
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
    accept,
    action,
    actions,
    allowPaste,
    execution,
    inputMode,
    maxFiles,
    maxBytes,
    multiple,
    pageActive,
    pluginId,
  ]);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    inputRequestIdRef.current += 1;
    stageInput({
      kind: "files",
      files: Array.from(event.dataTransfer.files).slice(
        0,
        multiple ? undefined : 1,
      ),
    });
  };

  const chooseFiles = async () => {
    const requestId = ++inputRequestIdRef.current;
    try {
      const sourcePaths = await fileApi.selectPluginTextInputs(
        multiple,
        acceptedTextExtensions(accept),
      );
      if (sourcePaths && requestId === inputRequestIdRef.current) {
        stageInput({ kind: "sourcePaths", sourcePaths });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const clearResults = () => {
    jobIdRef.current += 1;
    inputRequestIdRef.current += 1;
    setRunning(false);
    setStagedInput(null);
    setResults([]);
    setMessage(null);
  };
  const stagedNames = stagedInput
    ? stagedInput.kind === "files"
      ? stagedInput.files.map((file) => file.name)
      : stagedInput.kind === "paste"
        ? ["Pasted text"]
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
          if (inputMode !== "files") return;
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          if (inputMode !== "files") return;
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          if (inputMode !== "files") return;
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={inputMode === "files" ? handleDrop : undefined}
        className={[
          "relative flex min-h-40 flex-col rounded-sm border border-dashed px-4 transition-colors",
          inputMode === "files"
            ? "items-center justify-center gap-3 py-8 text-center"
            : "py-4",
          dragActive
            ? "border-accent bg-accent/10"
            : "border-border-main bg-main-bg hover:border-accent/70",
        ].join(" ")}
      >
        {inputMode === "files" ? (
          <>
            <div className="text-sm font-medium text-text-main">
              {running
                ? convertingLabel
                : stagedInput
                  ? stagedSummary
                  : emptyLabel}
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void chooseFiles();
              }}
              className={getPluginButtonClassName("secondary")}
            >
              {chooseFileLabel}
            </button>
          </>
        ) : (
          <div className="w-full space-y-2 pr-9">
            <textarea
              aria-label={labels?.pasteLabel() ?? "Paste text to convert"}
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              onPaste={(event) => {
                const text = event.clipboardData.getData("text/plain");
                if (!text) return;
                event.preventDefault();
                inputRequestIdRef.current += 1;
                setPasteText(text);
                stageInput({ kind: "paste", text });
              }}
              className="min-h-24 w-full rounded-sm border border-border-main bg-main-bg px-3 py-2 text-sm text-text-main outline-none focus:border-accent"
              placeholder={labels?.pastePlaceholder() ?? "Paste text here"}
            />
            <button
              type="button"
              onClick={() => {
                inputRequestIdRef.current += 1;
                stageInput({ kind: "paste", text: pasteText });
              }}
              disabled={!pasteText}
              className={getPluginButtonClassName("secondary")}
            >
              {labels?.convertText() ?? "Convert text"}
            </button>
          </div>
        )}
        {allowPaste && (
          <button
            type="button"
            onClick={() => {
              setDragActive(false);
              setInputMode((current) =>
                current === "files" ? "text" : "files",
              );
            }}
            aria-label={
              inputMode === "files"
                ? (labels?.switchToTextInput() ?? "Switch to text input")
                : (labels?.switchToFileInput() ?? "Switch to file input")
            }
            title={
              inputMode === "files"
                ? (labels?.switchToTextInput() ?? "Switch to text input")
                : (labels?.switchToFileInput() ?? "Switch to file input")
            }
            className="absolute right-3 bottom-3 rounded-sm border border-border-main bg-main-bg p-2 text-text-muted shadow-sm transition-colors hover:border-accent hover:text-text-main focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            <FlipHorizontal2 size={16} />
          </button>
        )}
      </div>
      {stagedInput && (running || execution === "manual" || message) && (
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
              onClick={() => void runInput(stagedInput)}
              disabled={running}
              className={getPluginButtonClassName("secondary")}
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
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap">
            {overwriteAvailable && (
              <div
                role="group"
                aria-label={outputModeLabel}
                className="inline-flex shrink-0 overflow-hidden rounded-sm border border-border-main bg-main-bg"
              >
                <button
                  type="button"
                  aria-pressed={outputMode === "create"}
                  onClick={() => setOutputMode("create")}
                  disabled={savingAll || savingIds.length > 0}
                  className={`px-3 py-1.5 text-xs ${outputMode === "create" ? "bg-item-hover text-text-main" : "text-text-muted hover:text-text-main"}`}
                >
                  {resolvedCreateModeLabel}
                </button>
                <button
                  type="button"
                  aria-pressed={outputMode === "overwrite"}
                  onClick={() => setOutputMode("overwrite")}
                  disabled={
                    savingAll || savingIds.length > 0 || !canOverwriteResults
                  }
                  className={`border-l border-border-main px-3 py-1.5 text-xs disabled:opacity-40 ${outputMode === "overwrite" ? "bg-red-500/15 text-red-300" : "text-text-muted hover:text-red-300"}`}
                >
                  {resolvedOverwriteModeLabel}
                </button>
              </div>
            )}
            {overwriteAvailable && (
              <span
                aria-hidden="true"
                className="mx-0.5 h-5 w-px shrink-0 bg-border-main"
              />
            )}
            <button
              type="button"
              onClick={() => void saveAll()}
              disabled={savingAll || unsavedResults.length === 0}
              className={getPluginButtonClassName("secondary")}
            >
              {labels?.saveAll() ?? "Save all"}
            </button>
            <button
              type="button"
              onClick={() => {
                const saved = [...results]
                  .reverse()
                  .find((row) => row.savedPath);
                if (saved?.savedPath)
                  void openerApi.revealInExplorer(saved.savedPath);
              }}
              disabled={!results.some((row) => row.savedPath)}
              className={getPluginButtonClassName("secondary")}
            >
              {revealLabel}
            </button>
            <button
              type="button"
              onClick={clearResults}
              disabled={
                savingAll ||
                savingIds.length > 0 ||
                (results.length === 0 && !message)
              }
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
                <th className="px-2 py-2 font-medium">{fileColumnLabel}</th>
                <th className="w-20 px-2 py-2 text-right font-medium">
                  {sizeColumnLabel}
                </th>
                <th className="w-24 px-2 py-2 text-right font-medium">
                  {labels?.actions() ?? "Actions"}
                </th>
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
                    key={result.id}
                    className="border-b border-border-main/40 last:border-b-0"
                  >
                    <td className="truncate px-2 py-2 text-text-main">
                      <span>{result.fileName}</span>
                      {result.savedPath && (
                        <span
                          className="ml-2 text-green-400"
                          title={result.savedPath}
                        >
                          {labels?.saved() ?? "Saved"}
                        </span>
                      )}
                      {result.error && (
                        <div className="whitespace-normal text-red-300">
                          {result.error}
                        </div>
                      )}
                      {copiedId === result.id && (
                        <span className="ml-2 text-text-muted">
                          {labels?.copied() ?? "Copied"}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-text-muted">
                      {formatBytes(result.size)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          aria-label={
                            labels?.saveResult({ name: result.fileName }) ??
                            `Save ${result.fileName}`
                          }
                          title={
                            labels?.saveResult({ name: result.fileName }) ??
                            `Save ${result.fileName}`
                          }
                          onClick={() => void saveRow(result)}
                          disabled={
                            Boolean(result.savedPath) ||
                            savingAll ||
                            savingIds.includes(result.id) ||
                            (outputMode === "overwrite" && !result.sourceGrant)
                          }
                          className="rounded p-1 text-text-muted hover:text-text-main disabled:opacity-40"
                        >
                          <Save size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label={
                            labels?.copyResult({ name: result.fileName }) ??
                            `Copy ${result.fileName}`
                          }
                          title={
                            labels?.copyResult({ name: result.fileName }) ??
                            `Copy ${result.fileName}`
                          }
                          onClick={() => void copyRow(result)}
                          className="rounded p-1 text-text-muted hover:text-text-main"
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label={
                            labels?.removeResult({ name: result.fileName }) ??
                            `Remove ${result.fileName} from results`
                          }
                          title={
                            labels?.removeResult({ name: result.fileName }) ??
                            `Remove ${result.fileName} from results`
                          }
                          onClick={() =>
                            setResults((previous) =>
                              previous.filter((item) => item.id !== result.id),
                            )
                          }
                          disabled={savingAll || savingIds.includes(result.id)}
                          className="rounded p-1 text-text-muted hover:text-text-main disabled:opacity-40"
                        >
                          <X size={15} />
                        </button>
                      </div>
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
