import type { PluginRuntimeLogLevel } from "./sandboxProtocol";
import type { PluginRuntimeSnapshot } from "./runtimeTypes";

const PLUGIN_RUNTIME_CHANGED_EVENT = "glimpse:plugin-runtime-changed";
const MAX_RUNTIME_LOGS = 30;
const runtimeSnapshots = new Map<string, PluginRuntimeSnapshot>();
let runtimeLogId = 0;

export const getPluginRuntimeSnapshot = (
  pluginId: string,
): PluginRuntimeSnapshot => getSnapshot(pluginId);

export const getPluginRuntimeSnapshots = (): PluginRuntimeSnapshot[] => [
  ...runtimeSnapshots.values(),
];

export const subscribeToPluginRuntimeChanges = (listener: () => void) => {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(PLUGIN_RUNTIME_CHANGED_EVENT, listener);

  return () => {
    window.removeEventListener(PLUGIN_RUNTIME_CHANGED_EVENT, listener);
  };
};

export const getSnapshot = (pluginId: string): PluginRuntimeSnapshot =>
  runtimeSnapshots.get(pluginId) ?? {
    pluginId,
    status: "inactive",
    logs: [],
    updatedAt: new Date(0).toISOString(),
  };

export const setRuntimeSnapshot = (
  pluginId: string,
  update: Partial<
    Omit<PluginRuntimeSnapshot, "pluginId" | "logs" | "updatedAt">
  >,
) => {
  const previous = getSnapshot(pluginId);

  runtimeSnapshots.set(pluginId, {
    ...previous,
    ...update,
    pluginId,
    logs: previous.logs,
    updatedAt: new Date().toISOString(),
  });

  dispatchRuntimeChanged();
};

export const appendRuntimeLog = (
  pluginId: string,
  level: PluginRuntimeLogLevel,
  message: string,
) => {
  const previous = getSnapshot(pluginId);

  runtimeSnapshots.set(pluginId, {
    ...previous,
    pluginId,
    logs: [
      {
        id: ++runtimeLogId,
        level,
        message,
        createdAt: new Date().toISOString(),
      },
      ...previous.logs,
    ].slice(0, MAX_RUNTIME_LOGS),
    updatedAt: new Date().toISOString(),
  });

  dispatchRuntimeChanged();
};

const dispatchRuntimeChanged = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(PLUGIN_RUNTIME_CHANGED_EVENT));
};

export const stringifyLogValues = (values: unknown[]): string =>
  values.map(stringifyLogValue).join(" ");

const stringifyLogValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return stringifyError(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
