import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, RotateCcw, WandSparkles } from "lucide-react";
import { fileApi } from "@/api/file";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PluginFormTab } from "@/types";
import { copyText } from "@/utils/clipboard";
import { invokePluginAction } from "../components";
import { getPluginRuntime } from "../runtime";
import {
  getDefaultFormFieldValue,
  PluginFormFieldControl,
} from "./PluginFormFields";

export const StandardPluginForm = ({
  tab,
  runtime,
}: {
  tab: PluginFormTab;
  runtime: NonNullable<ReturnType<typeof getPluginRuntime>>;
}) => {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      (tab.fields ?? []).map((field) => [
        field.id,
        field.default ?? getDefaultFormFieldValue(field),
      ]),
    ),
  );
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<PluginFormHistoryItem[]>([]);
  const [copiedHistoryId, setCopiedHistoryId] = useState<number | null>(null);
  const [savingMode, setSavingMode] = useState<PluginFormSaveMode | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const nextHistoryId = useRef(1);
  const historyEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [history.length]);

  const updateValue = (id: string, value: unknown) => {
    setValues((current) => ({
      ...current,
      [id]: value,
    }));
  };

  const submit = async () => {
    if (running) {
      return;
    }

    setRunning(true);

    try {
      const output = await invokePluginAction(
        runtime.actions,
        tab.action,
        values,
      );
      setHistory((previous) => [
        ...previous,
        {
          id: nextHistoryId.current++,
          result: formatPluginFormResult(output),
        },
      ]);
    } catch (submitError) {
      setHistory((previous) => [
        ...previous,
        {
          id: nextHistoryId.current++,
          result:
            submitError instanceof Error
              ? submitError.message
              : String(submitError),
          error: true,
        },
      ]);
    } finally {
      setRunning(false);
    }
  };

  const copyResult = async (item: PluginFormHistoryItem) => {
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
    } catch (copyError) {
      console.warn("Failed to copy plugin form result", copyError);
    }
  };

  const successfulHistory = history.filter((item) => !item.error);

  const saveResults = async (mode: PluginFormSaveMode) => {
    if (savingMode !== null || successfulHistory.length === 0) {
      return;
    }

    const results =
      mode === "latest" ? successfulHistory.slice(-1) : successfulHistory;

    setSavingMode(mode);
    setSaveMessage(null);

    try {
      const directory = await fileApi.selectOutputDirectory();

      if (!directory) {
        return;
      }

      const path = await fileApi.writePluginTextOutput({
        grantToken: directory.token,
        fileName: getPluginFormOutputFileName(runtime.pluginId, tab.id, mode),
        body: results.map((item) => item.result).join("\n"),
      });
      setSaveMessage(`Saved to ${path}`);
    } catch (saveError) {
      setSaveMessage(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setSavingMode(null);
    }
  };

  const resetHistory = () => {
    setHistory([]);
    setCopiedHistoryId(null);
    setSaveMessage(null);
    nextHistoryId.current = 1;
  };

  const copyLabel =
    tab.result?.copyLabel ?? tab.result?.copyLabelFallback ?? "Copy";
  const copiedLabel =
    tab.result?.copiedLabel ?? tab.result?.copiedLabelFallback ?? "Copied";
  const saveLatestLabel =
    tab.result?.saveLatestLabel ??
    tab.result?.saveLatestLabelFallback ??
    "Save latest result";
  const saveAllLabel =
    tab.result?.saveAllLabel ??
    tab.result?.saveAllLabelFallback ??
    "Save all results";
  const resetLabel =
    tab.result?.resetLabel ?? tab.result?.resetLabelFallback ?? "Reset results";
  const submitLabel = tab.submitLabel ?? tab.submitLabelFallback ?? "Run";

  return (
    <div
      className="@container flex h-full min-h-0 flex-col overflow-hidden border-y border-border-main/60"
      data-glimpse-plugin-form
    >
      <section className="relative min-h-0 w-full min-w-0 basis-1/2 overflow-hidden">
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={successfulHistory.length === 0 || savingMode !== null}
                className="grid size-8 place-items-center rounded border border-border-main bg-main-bg/95 text-text-muted shadow-sm backdrop-blur-sm hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-35"
                aria-label="Save results"
                title="Save results"
                data-glimpse-plugin-form-save
              >
                <Download aria-hidden="true" className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void saveResults("latest")}>
                {saveLatestLabel}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void saveResults("all")}>
                {saveAllLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            onClick={resetHistory}
            disabled={history.length === 0}
            className="grid size-8 place-items-center rounded border border-border-main bg-main-bg/95 text-text-muted shadow-sm backdrop-blur-sm hover:border-red-400/70 hover:text-red-400 disabled:pointer-events-none disabled:opacity-35"
            aria-label={resetLabel}
            title={resetLabel}
            data-glimpse-plugin-form-reset
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
          </button>
        </div>

        <div
          className="h-full w-full space-y-1 overflow-y-auto pt-3 pr-21 pb-14 pl-1 [scrollbar-gutter:stable]"
          aria-live="polite"
          data-glimpse-plugin-form-results
        >
          {history.length === 0 ? (
            <div className="flex h-full min-h-40 items-center justify-center px-4 text-center text-sm text-text-muted">
              Adjust the parameters below, then run the action.
            </div>
          ) : (
            history.map((item, index) => (
              <div
                key={item.id}
                className="grid grid-cols-[2.0rem_1fr] gap-x-1 rounded-md px-2 py-2 hover:bg-item-hover/60"
              >
                <div
                  className={`pt-0.5 text-xs font-semibold ${
                    item.error ? "text-red-300" : "text-text-main"
                  }`}
                  aria-label={`${item.error ? "Error" : "Result"} ${index + 1}`}
                >
                  [{index + 1}]:
                </div>
                {item.error ? (
                  <div className="min-w-0 text-sm leading-relaxed whitespace-pre-wrap break-words text-red-300">
                    {item.result}
                  </div>
                ) : tab.result?.copy ? (
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => void copyResult(item)}
                      className="block w-full rounded-sm text-left font-mono text-sm text-text-main select-text transition-colors hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                      aria-label={
                        copiedHistoryId === item.id ? copiedLabel : copyLabel
                      }
                      title={copyLabel}
                    >
                      <span className="block leading-relaxed break-all">
                        {item.result}
                      </span>
                    </button>
                    {copiedHistoryId === item.id && (
                      <span className="mt-0.5 block text-[11px] text-text-muted">
                        {copiedLabel}
                      </span>
                    )}
                  </div>
                ) : (
                  <pre className="min-w-0 overflow-x-auto font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-text-main">
                    {item.result}
                  </pre>
                )}
              </div>
            ))
          )}
          <div ref={historyEndRef} />
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={running}
          className="absolute right-2 bottom-2 z-10 grid size-10 touch-manipulation place-items-center rounded-full border border-accent bg-accent text-white select-none shadow-md transition-transform hover:scale-105 hover:opacity-90 disabled:pointer-events-none disabled:scale-100 disabled:opacity-50"
          aria-label={submitLabel}
          title={submitLabel}
          data-glimpse-plugin-form-action
        >
          {running ? (
            <LoaderCircle
              aria-hidden="true"
              className="pointer-events-none size-4 animate-spin"
            />
          ) : (
            <WandSparkles
              aria-hidden="true"
              className="pointer-events-none size-4"
            />
          )}
        </button>
      </section>

      <section
        className="flex min-h-0 flex-1 flex-col border-t border-border-main/60 bg-main-bg"
        data-glimpse-plugin-form-parameters
      >
        <div className="shrink-0 border-b border-border-main/40 bg-main-bg px-2 py-1.5 text-xs font-semibold tracking-wide text-text-muted uppercase">
          <span>Parameters</span>
          <span className="ml-1.5 font-normal tracking-normal text-text-muted/70 normal-case">
            {(tab.fields ?? []).length}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            className="grid w-full min-w-0 grid-cols-1 gap-1.5 p-2 @min-[420px]:grid-cols-2"
            data-glimpse-plugin-form-controls
          >
            {(tab.fields ?? []).map((field) => (
              <PluginFormFieldControl
                key={field.id}
                field={field}
                value={values[field.id]}
                onChange={(value) => updateValue(field.id, value)}
              />
            ))}
          </div>
        </div>

        {saveMessage && (
          <div
            className="shrink-0 border-t border-border-main/40 px-2 py-1.5 text-xs leading-4 break-words text-text-muted"
            aria-live="polite"
          >
            {saveMessage}
          </div>
        )}
      </section>
    </div>
  );
};

type PluginFormSaveMode = "latest" | "all";

type PluginFormHistoryItem = {
  id: number;
  result: string;
  error?: boolean;
};

const getPluginFormOutputFileName = (
  pluginId: string,
  tabId: string,
  mode: PluginFormSaveMode,
): string => {
  const baseName = `${pluginId}-${tabId}`
    .replace(/^plugin:/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = mode === "latest" ? "latest" : "results";

  return `${baseName || "generator"}-${suffix}.txt`;
};

const formatPluginFormResult = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
};
