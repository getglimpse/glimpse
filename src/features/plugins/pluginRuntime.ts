import {
  createElement,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { convertFileSrc } from "@tauri-apps/api/core";
import { fileApi, type FileMetadata } from "@/api/file";
import { pluginsApi } from "@/api/plugins";
import { settingsApi } from "@/api/settings";
import type {
  GlimpsePlugin,
  PluginFileReadScope,
  PluginRegistryItem,
} from "@/types";

import {
  createPluginComponents,
  type PluginActionInvoker,
  type PluginActions,
  type PluginComponents,
  type PluginPageRenderer,
  type PluginViewerRenderer,
  invokePluginAction,
} from "./pluginComponents";
import {
  createPluginI18nApi,
  getCurrentPluginLocale,
  type PluginI18nApi,
} from "./pluginI18n";

type PluginRuntimeStatus = "inactive" | "loading" | "active" | "error";

export type PluginRuntimeLogLevel = "info" | "warn" | "error";

export type PluginRuntimeLogEntry = {
  id: number;
  level: PluginRuntimeLogLevel;
  message: string;
  createdAt: string;
};

export type PluginRuntimeSnapshot = {
  pluginId: string;
  status: PluginRuntimeStatus;
  error?: string;
  logs: PluginRuntimeLogEntry[];
  activatedAt?: string;
  updatedAt: string;
};

type PluginContext = {
  registerAction: never;
  registerPage: (id: string, render: PluginPageRenderer) => void;
  registerViewer: (id: string, render: PluginViewerRenderer) => void;
  h: typeof createElement;
  components: PluginComponents;
  actions: {
    invoke: PluginActionInvoker;
  };
  plugin: {
    id: string;
    version: string;
    apiVersion: string;
  };
  i18n: PluginI18nApi;
  api: {
    version: string;
  };
  files: {
    readText: (sourcePath: string) => Promise<string>;
    readBinary: (sourcePath: string) => Promise<string>;
    getMetadata: (sourcePath: string) => Promise<FileMetadata>;
    toAssetUrl: (sourcePath: string) => string;
  };
  log: {
    info: (...values: unknown[]) => void;
    warn: (...values: unknown[]) => void;
    error: (...values: unknown[]) => void;
  };
};

export type LoadedPluginRuntime = {
  pluginId: string;
  version: string;
  fileReadScope: PluginFileReadScope;
  actions: PluginActions;
  pages: Map<string, PluginPageRenderer>;
  viewers: Map<string, PluginViewerRenderer>;
  components: PluginComponents;
  styleElement?: HTMLStyleElement;
  deactivate?: (context: PluginContext) => unknown;
  context: PluginContext;
  sandbox: PluginSandbox;
};

type SerializedPluginNode =
  | null
  | string
  | number
  | boolean
  | SerializedPluginElement
  | SerializedPluginNode[];

type SerializedPluginElement = {
  __glimpsePluginNode: true;
  type: string;
  props?: Record<string, unknown>;
  children?: SerializedPluginNode[];
};

type PluginSandboxInitResult = {
  actions?: string[];
  pages?: string[];
  viewers?: string[];
};

type PluginSandbox = {
  init: (input: {
    plugin: GlimpsePlugin;
    mainSource: string;
    pageSource?: string;
  }) => Promise<PluginSandboxInitResult>;
  invokeAction: (actionId: string, input?: unknown) => Promise<unknown>;
  renderPage: (pageId: string) => Promise<SerializedPluginNode>;
  renderViewer: (
    viewerId: string,
    sourcePath?: string | null,
  ) => Promise<SerializedPluginNode>;
  deactivate: () => Promise<void>;
  terminate: () => void;
};

type SandboxWorkerRequest =
  | {
      id: number;
      type: "init";
      plugin: unknown;
      mainSource: string;
      pageSource?: string;
      locale: string;
    }
  | {
      id: number;
      type: "invokeAction";
      actionId: string;
      input?: unknown;
      locale: string;
      capabilityToken?: string;
    }
  | {
      id: number;
      type: "renderPage";
      pageId: string;
      locale: string;
      capabilityToken?: string;
    }
  | {
      id: number;
      type: "renderViewer";
      viewerId: string;
      sourcePath?: string | null;
      locale: string;
      capabilityToken?: string;
    }
  | { id: number; type: "deactivate"; locale: string };

type SandboxWorkerRequestInput<T> = T extends unknown
  ? Omit<T, "id" | "locale">
  : never;

type SandboxWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | {
      type: "hostRequest";
      requestId: number;
      request:
        | {
            kind: "readText";
            sourcePath: string;
            capabilityToken?: string;
          }
        | {
            kind: "readBinary";
            sourcePath: string;
            capabilityToken?: string;
          }
        | {
            kind: "getMetadata";
            sourcePath: string;
            capabilityToken?: string;
          }
        | { kind: "log"; level: PluginRuntimeLogLevel; values: unknown[] };
    };

type PluginCapabilityContext = {
  token: string;
  activeTabSourcePath?: string | null;
  targetGroupId?: string | null;
  targetGroupPaths: string[];
};

const PLUGIN_RUNTIME_CHANGED_EVENT = "glimpse:plugin-runtime-changed";
const MAX_RUNTIME_LOGS = 30;
const PLUGIN_SANDBOX_REQUEST_TIMEOUT_MS = {
  init: 5_000,
  invokeAction: 10_000,
  renderPage: 5_000,
  renderViewer: 5_000,
  deactivate: 2_000,
} satisfies Record<SandboxWorkerRequest["type"], number>;

const loadedRuntimes = new Map<string, LoadedPluginRuntime>();
const loadingRuntimes = new Map<string, Promise<LoadedPluginRuntime>>();
const runtimeSnapshots = new Map<string, PluginRuntimeSnapshot>();
const runtimeActivationVersions = new Map<string, number>();
let runtimeLogId = 0;

export const getPluginRuntime = (
  pluginId: string,
): LoadedPluginRuntime | undefined => loadedRuntimes.get(pluginId);

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

export const activatePluginRuntime = async (
  plugin: GlimpsePlugin,
): Promise<LoadedPluginRuntime> => {
  const loaded = loadedRuntimes.get(plugin.id);

  if (loaded) {
    return loaded;
  }

  const loading = loadingRuntimes.get(plugin.id);

  if (loading) {
    return loading;
  }

  const activationVersion = bumpRuntimeActivationVersion(plugin.id);
  const nextLoading = loadPluginRuntime(plugin, activationVersion).finally(
    () => {
      loadingRuntimes.delete(plugin.id);
    },
  );

  loadingRuntimes.set(plugin.id, nextLoading);

  return nextLoading;
};

export const deactivatePluginRuntime = async (pluginId: string) => {
  bumpRuntimeActivationVersion(pluginId);

  const loading = loadingRuntimes.get(pluginId);

  if (loading) {
    await loading.catch(() => undefined);
  }

  const runtime = loadedRuntimes.get(pluginId);

  if (!runtime) {
    setRuntimeSnapshot(pluginId, {
      status: "inactive",
      error: undefined,
      activatedAt: undefined,
    });
    return;
  }

  loadedRuntimes.delete(pluginId);

  try {
    if (runtime.deactivate) {
      await runtime.deactivate(runtime.context);
    }
  } catch (error) {
    appendRuntimeLog(pluginId, "error", stringifyError(error));
  }

  runtime.styleElement?.remove();
  runtime.sandbox.terminate();

  setRuntimeSnapshot(pluginId, {
    status: "inactive",
    error: undefined,
    activatedAt: undefined,
  });
};

export const reloadPluginRuntime = async (
  plugin: GlimpsePlugin,
): Promise<LoadedPluginRuntime> => {
  await deactivatePluginRuntime(plugin.id);

  return activatePluginRuntime(plugin);
};

export const syncPluginRuntimes = async (plugins: PluginRegistryItem[]) => {
  const enabledPluginIds = new Set(
    plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.id),
  );
  const activePluginIds = new Set([
    ...loadedRuntimes.keys(),
    ...loadingRuntimes.keys(),
  ]);

  await Promise.all(
    [...activePluginIds]
      .filter((pluginId) => !enabledPluginIds.has(pluginId))
      .map(deactivatePluginRuntime),
  );

  await Promise.allSettled(
    plugins
      .filter((plugin) => plugin.enabled)
      .map((plugin) => activatePluginRuntime(plugin)),
  );
};

const loadPluginRuntime = async (
  plugin: GlimpsePlugin,
  activationVersion: number,
): Promise<LoadedPluginRuntime> => {
  setRuntimeSnapshot(plugin.id, {
    status: "loading",
    error: undefined,
    activatedAt: undefined,
  });

  let styleElement: HTMLStyleElement | undefined;
  let sandbox: PluginSandbox | undefined;

  try {
    const mainSource = await pluginsApi.getEntrypointSource(plugin.id, "main");
    assertRuntimeActivationCurrent(plugin.id, activationVersion);

    const pageSource = plugin.entrypoints?.page
      ? await pluginsApi.getEntrypointSource(plugin.id, "page")
      : undefined;
    assertRuntimeActivationCurrent(plugin.id, activationVersion);

    const actions: PluginActions = {};
    const pages = new Map<string, PluginPageRenderer>();
    const viewers = new Map<string, PluginViewerRenderer>();
    const components = createPluginComponents(actions, plugin.id);
    const fileReadScope = getPluginFileReadScope(plugin);
    const activeSandbox = createPluginSandbox(plugin);
    sandbox = activeSandbox;
    const context = createPluginContext(plugin, actions, components);

    styleElement = await loadPluginStyles(plugin.id);
    assertRuntimeActivationCurrent(plugin.id, activationVersion);

    const registrations = await activeSandbox.init({
      plugin,
      mainSource: mainSource.source,
      pageSource: pageSource?.source,
    });
    assertRuntimeActivationCurrent(plugin.id, activationVersion);

    for (const actionId of registrations.actions ?? []) {
      assertPluginRegistrationId(actionId, "action");
      actions[actionId] = {
        handler: (input) => activeSandbox.invokeAction(actionId, input),
      };
    }

    const runtimeShell = {
      pluginId: plugin.id,
      version: plugin.version,
      fileReadScope,
      actions,
      pages,
      viewers,
      components,
      styleElement,
      context,
      sandbox: activeSandbox,
    } satisfies Omit<LoadedPluginRuntime, "deactivate">;

    for (const pageId of registrations.pages ?? []) {
      assertPluginPageId(plugin.id, pageId);
      pages.set(pageId, () =>
        createElement(SandboxedPluginRender, {
          runtime: runtimeShell,
          renderKind: "page",
          renderId: pageId,
        }),
      );
    }

    for (const viewerId of registrations.viewers ?? []) {
      assertPluginRegistrationId(viewerId, "viewer");
      viewers.set(viewerId, ({ sourcePath }) =>
        createElement(SandboxedPluginRender, {
          runtime: runtimeShell,
          renderKind: "viewer",
          renderId: viewerId,
          sourcePath,
        }),
      );
    }

    const runtime: LoadedPluginRuntime = {
      pluginId: plugin.id,
      version: plugin.version,
      fileReadScope,
      actions,
      pages,
      viewers,
      components,
      styleElement,
      deactivate: () => activeSandbox.deactivate(),
      context,
      sandbox: activeSandbox,
    };

    if (!isRuntimeActivationCurrent(plugin.id, activationVersion)) {
      await cleanupCancelledRuntime(runtime);
      throw new PluginRuntimeActivationCancelled(plugin.id);
    }

    loadedRuntimes.set(plugin.id, runtime);

    setRuntimeSnapshot(plugin.id, {
      status: "active",
      error: undefined,
      activatedAt: new Date().toISOString(),
    });

    return runtime;
  } catch (error) {
    styleElement?.remove();
    sandbox?.terminate();

    if (error instanceof PluginRuntimeActivationCancelled) {
      throw error;
    }

    const message = stringifyError(error);
    appendRuntimeLog(plugin.id, "error", message);
    setRuntimeSnapshot(plugin.id, {
      status: "error",
      error: message,
      activatedAt: undefined,
    });

    throw error;
  }
};

class PluginRuntimeActivationCancelled extends Error {
  constructor(pluginId: string) {
    super(`Plugin activation was cancelled: ${pluginId}`);
    this.name = "PluginRuntimeActivationCancelled";
  }
}

class PluginSandboxTimeoutError extends Error {
  constructor(pluginId: string, requestType: SandboxWorkerRequest["type"]) {
    super(`Plugin sandbox ${requestType} timed out: ${pluginId}`);
    this.name = "PluginSandboxTimeoutError";
  }
}

const bumpRuntimeActivationVersion = (pluginId: string): number => {
  const nextVersion = (runtimeActivationVersions.get(pluginId) ?? 0) + 1;
  runtimeActivationVersions.set(pluginId, nextVersion);

  return nextVersion;
};

const isRuntimeActivationCurrent = (
  pluginId: string,
  activationVersion: number,
): boolean => runtimeActivationVersions.get(pluginId) === activationVersion;

const assertRuntimeActivationCurrent = (
  pluginId: string,
  activationVersion: number,
) => {
  if (!isRuntimeActivationCurrent(pluginId, activationVersion)) {
    throw new PluginRuntimeActivationCancelled(pluginId);
  }
};

const cleanupCancelledRuntime = async (runtime: LoadedPluginRuntime) => {
  try {
    if (runtime.deactivate) {
      await runtime.deactivate(runtime.context);
    }
  } catch (error) {
    appendRuntimeLog(runtime.pluginId, "error", stringifyError(error));
  }

  runtime.styleElement?.remove();
  runtime.sandbox.terminate();
};

const createPluginSandbox = (plugin: GlimpsePlugin): PluginSandbox => {
  const pluginId = plugin.id;

  if (typeof Worker === "undefined") {
    if (import.meta.env.MODE === "test") {
      return createInProcessPluginSandbox(plugin);
    }

    throw new Error("Plugin sandbox worker is not available in this runtime");
  }

  const worker = new Worker(
    new URL("./pluginSandboxWorker.ts", import.meta.url),
    { type: "module", name: `glimpse-plugin:${pluginId}` },
  );
  const pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
      capabilityToken?: string;
    }
  >();
  const capabilityContexts = new Map<string, PluginCapabilityContext>();
  let requestId = 0;
  let capabilityTokenId = 0;
  let terminated = false;

  worker.onmessage = (event: MessageEvent<SandboxWorkerResponse>) => {
    const message = event.data;

    if ("type" in message && message.type === "hostRequest") {
      void handleSandboxHostRequest(
        plugin,
        worker,
        capabilityContexts,
        message,
      );
      return;
    }

    const response = message as Exclude<
      SandboxWorkerResponse,
      { type: "hostRequest" }
    >;
    const pending = pendingRequests.get(response.id);
    pendingRequests.delete(response.id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutId);
    if (pending.capabilityToken) {
      capabilityContexts.delete(pending.capabilityToken);
    }

    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(new Error(response.error));
    }
  };

  worker.onerror = (event) => {
    const message = event.message || "plugin sandbox worker failed";

    terminateSandbox(new Error(message), { markRuntimeError: true });
  };

  const request = <T>(
    message: SandboxWorkerRequestInput<SandboxWorkerRequest>,
  ): Promise<T> => {
    if (terminated) {
      return Promise.reject(
        new Error(`Plugin sandbox is terminated: ${pluginId}`),
      );
    }

    const id = ++requestId;
    const requestType = message.type;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const error = new PluginSandboxTimeoutError(pluginId, requestType);

        terminateSandbox(error, { markRuntimeError: true });
      }, PLUGIN_SANDBOX_REQUEST_TIMEOUT_MS[requestType]);

      pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeoutId,
      });

      void createPluginCapabilityContext({
        plugin,
        requestType,
        sourcePath:
          "sourcePath" in message && typeof message.sourcePath === "string"
            ? message.sourcePath
            : null,
        nextToken: () => `cap:${pluginId}:${++capabilityTokenId}`,
      })
        .then((capabilityContext) => {
          if (terminated) {
            throw new Error(`Plugin sandbox is terminated: ${pluginId}`);
          }

          if (capabilityContext) {
            capabilityContexts.set(capabilityContext.token, capabilityContext);
            const pending = pendingRequests.get(id);
            if (pending) {
              pending.capabilityToken = capabilityContext.token;
            }
          }

          worker.postMessage({
            ...message,
            id,
            locale: getCurrentPluginLocale(),
            capabilityToken: capabilityContext?.token,
          } as SandboxWorkerRequest);
        })
        .catch((error) => {
          pendingRequests.delete(id);
          clearTimeout(timeoutId);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  };

  const terminateSandbox = (
    error: Error | undefined,
    {
      markRuntimeError,
    }: {
      markRuntimeError: boolean;
    },
  ) => {
    if (terminated) {
      return;
    }

    terminated = true;
    worker.terminate();

    const pendingError =
      error ?? new Error(`Plugin sandbox was terminated: ${pluginId}`);

    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeoutId);
      if (pending.capabilityToken) {
        capabilityContexts.delete(pending.capabilityToken);
      }
      pending.reject(pendingError);
    }

    pendingRequests.clear();
    capabilityContexts.clear();

    if (markRuntimeError) {
      failLoadedPluginRuntime(pluginId, pendingError);
    }
  };

  return {
    init: ({ plugin, mainSource, pageSource }) =>
      request<PluginSandboxInitResult>({
        type: "init",
        plugin: {
          id: plugin.id,
          version: plugin.version,
          apiVersion: plugin.apiVersion ?? "0.1.0",
          i18n: plugin.i18n,
        },
        mainSource,
        pageSource,
      }),
    invokeAction: (actionId, input) =>
      request({ type: "invokeAction", actionId, input }),
    renderPage: (pageId) => request({ type: "renderPage", pageId }),
    renderViewer: (viewerId, sourcePath) =>
      request({ type: "renderViewer", viewerId, sourcePath }),
    deactivate: async () => {
      await request({ type: "deactivate" });
    },
    terminate: () => {
      terminateSandbox(undefined, { markRuntimeError: false });
    },
  };
};

const failLoadedPluginRuntime = (pluginId: string, error: Error) => {
  const runtime = loadedRuntimes.get(pluginId);

  if (runtime) {
    loadedRuntimes.delete(pluginId);
    runtime.styleElement?.remove();
  }

  const message = stringifyError(error);
  appendRuntimeLog(pluginId, "error", message);
  setRuntimeSnapshot(pluginId, {
    status: "error",
    error: message,
    activatedAt: undefined,
  });
};

const createPluginCapabilityContext = async ({
  plugin,
  requestType,
  sourcePath,
  nextToken,
}: {
  plugin: GlimpsePlugin;
  requestType: SandboxWorkerRequest["type"];
  sourcePath?: string | null;
  nextToken: () => string;
}): Promise<PluginCapabilityContext | undefined> => {
  const readScope = getPluginFileReadScope(plugin);

  if (
    readScope === "none" ||
    requestType === "init" ||
    requestType === "deactivate"
  ) {
    return undefined;
  }

  const targetGroupSnapshot =
    readScope === "target-group"
      ? await getActiveTargetGroupSnapshot()
      : undefined;

  return {
    token: nextToken(),
    activeTabSourcePath: requestType === "renderViewer" ? sourcePath : null,
    targetGroupId: targetGroupSnapshot?.id ?? null,
    targetGroupPaths: targetGroupSnapshot?.paths ?? [],
  };
};

const getActiveTargetGroupSnapshot = async (): Promise<
  { id: string; paths: string[] } | undefined
> => {
  try {
    const settings = await settingsApi.get();
    const currentGroup = settings.targetGroups.find(
      (group) => group.id === settings.currentTargetGroupId,
    );

    return currentGroup
      ? {
          id: currentGroup.id,
          paths: currentGroup.paths,
        }
      : undefined;
  } catch {
    return undefined;
  }
};

const getPluginFileReadScope = (plugin: GlimpsePlugin): PluginFileReadScope =>
  plugin.capabilities?.files?.read ?? "none";

const assertPluginFileAccess = (
  plugin: GlimpsePlugin,
  requestedPath: string,
  context?: PluginCapabilityContext,
) => {
  const readScope = getPluginFileReadScope(plugin);

  if (!context) {
    throw new Error(`plugin file read is not available: ${plugin.id}`);
  }

  if (readScope === "none") {
    throw new Error(
      `plugin does not declare file read capability: ${plugin.id}`,
    );
  }

  if (
    readScope === "active-tab" &&
    pathsEqual(requestedPath, context.activeTabSourcePath)
  ) {
    return;
  }

  if (readScope === "target-group" && context.targetGroupId) {
    return;
  }

  throw new Error(
    `plugin file read denied by ${readScope} capability: ${plugin.id}`,
  );
};

const readPluginTextFile = async (
  plugin: GlimpsePlugin,
  sourcePath: string,
  context?: PluginCapabilityContext,
): Promise<string> => {
  assertPluginFileAccess(plugin, sourcePath, context);

  if (getPluginFileReadScope(plugin) === "target-group") {
    return fileApi.readTextFileInTargetGroup(
      sourcePath,
      context?.targetGroupId ?? "",
    );
  }

  return fileApi.readTextFile(sourcePath);
};

const readPluginBinaryFile = async (
  plugin: GlimpsePlugin,
  sourcePath: string,
  context?: PluginCapabilityContext,
): Promise<string> => {
  assertPluginFileAccess(plugin, sourcePath, context);

  if (getPluginFileReadScope(plugin) === "target-group") {
    return fileApi.readBinaryFileInTargetGroup(
      sourcePath,
      context?.targetGroupId ?? "",
    );
  }

  return fileApi.readBinaryFile(sourcePath);
};

const readPluginFileMetadata = async (
  plugin: GlimpsePlugin,
  sourcePath: string,
  context?: PluginCapabilityContext,
): Promise<FileMetadata> => {
  assertPluginFileAccess(plugin, sourcePath, context);

  if (getPluginFileReadScope(plugin) === "target-group") {
    return fileApi.getFileMetadataInTargetGroup(
      sourcePath,
      context?.targetGroupId ?? "",
    );
  }

  return fileApi.getFileMetadata(sourcePath);
};

const pathsEqual = (left?: string | null, right?: string | null): boolean => {
  if (!left || !right) {
    return false;
  }

  return normalizePathForComparison(left) === normalizePathForComparison(right);
};

const normalizePathForComparison = (value: string): string => {
  let normalized = value
    .trim()
    .replace(/^\\\\\?\\/, "")
    .replace(/^\/\/\?\//, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");

  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
};

const createInProcessPluginSandbox = (plugin: GlimpsePlugin): PluginSandbox => {
  const pluginId = plugin.id;
  const actions: Record<
    string,
    (input?: unknown) => unknown | Promise<unknown>
  > = {};
  const pages = new Map<string, (context: unknown) => unknown>();
  const viewers = new Map<string, (context: unknown) => unknown>();
  const deactivates: Array<(context: unknown) => unknown> = [];
  let activePlugin: GlimpsePlugin | null = null;
  let mathApi: { all: unknown; create: unknown } | null = null;
  let currentCapabilityContext:
    | Omit<PluginCapabilityContext, "token">
    | undefined;

  const createContext = ({ sourcePath }: { sourcePath?: string | null }) => {
    if (!activePlugin || !mathApi) {
      throw new Error(`Plugin sandbox is not initialized: ${pluginId}`);
    }

    const contextPlugin = activePlugin;

    return {
      h: createSerializedPluginElement,
      components: Object.fromEntries(
        Object.keys(COMPONENT_PLUGIN_PROPS)
          .filter((name) => !ALLOWED_HTML_ELEMENTS.has(name))
          .map((name) => [name, name]),
      ),
      actions: {
        invoke: async (id: string, input?: unknown) => {
          const action = actions[id];

          if (!action) {
            throw new Error(`Missing action: ${id}`);
          }

          return action(input);
        },
      },
      plugin: {
        id: contextPlugin.id,
        version: contextPlugin.version,
        apiVersion: contextPlugin.apiVersion ?? "0.1.0",
      },
      i18n: createPluginI18nApi(contextPlugin),
      api: {
        version: contextPlugin.apiVersion ?? "0.1.0",
      },
      math: mathApi,
      files: {
        readText: async (nextSourcePath: string) => {
          const targetGroupSnapshot =
            getPluginFileReadScope(contextPlugin) === "target-group"
              ? await getActiveTargetGroupSnapshot()
              : undefined;
          const capabilityContext = currentCapabilityContext ?? {
            token: "test",
            activeTabSourcePath: sourcePath,
            targetGroupId: targetGroupSnapshot?.id ?? null,
            targetGroupPaths: targetGroupSnapshot?.paths ?? [],
          };

          return readPluginTextFile(contextPlugin, nextSourcePath, {
            token: "test",
            ...capabilityContext,
          });
        },
        readBinary: async (nextSourcePath: string) => {
          const targetGroupSnapshot =
            getPluginFileReadScope(contextPlugin) === "target-group"
              ? await getActiveTargetGroupSnapshot()
              : undefined;
          const capabilityContext = currentCapabilityContext ?? {
            token: "test",
            activeTabSourcePath: sourcePath,
            targetGroupId: targetGroupSnapshot?.id ?? null,
            targetGroupPaths: targetGroupSnapshot?.paths ?? [],
          };

          return readPluginBinaryFile(contextPlugin, nextSourcePath, {
            token: "test",
            ...capabilityContext,
          });
        },
        getMetadata: async (nextSourcePath: string) => {
          const targetGroupSnapshot =
            getPluginFileReadScope(contextPlugin) === "target-group"
              ? await getActiveTargetGroupSnapshot()
              : undefined;
          const capabilityContext = currentCapabilityContext ?? {
            token: "test",
            activeTabSourcePath: sourcePath,
            targetGroupId: targetGroupSnapshot?.id ?? null,
            targetGroupPaths: targetGroupSnapshot?.paths ?? [],
          };

          return readPluginFileMetadata(contextPlugin, nextSourcePath, {
            token: "test",
            ...capabilityContext,
          });
        },
        toAssetUrl: (nextSourcePath: string) =>
          `glimpse-plugin-asset:${encodeURIComponent(nextSourcePath)}`,
      },
      log: {
        info: (...values: unknown[]) =>
          appendRuntimeLog(pluginId, "info", stringifyLogValues(values)),
        warn: (...values: unknown[]) =>
          appendRuntimeLog(pluginId, "warn", stringifyLogValues(values)),
        error: (...values: unknown[]) =>
          appendRuntimeLog(pluginId, "error", stringifyLogValues(values)),
      },
      sourcePath,
      registerAction: (id: string, registration: unknown) => {
        assertPluginRegistrationId(id, "action");
        actions[id] = normalizeInProcessAction(registration);
        appendRuntimeLog(pluginId, "info", `registered action: ${id}`);
      },
      registerPage: (id: string, render: (context: unknown) => unknown) => {
        assertPluginPageId(pluginId, id);
        pages.set(id, render);
        appendRuntimeLog(pluginId, "info", `registered page: ${id}`);
      },
      registerViewer: (id: string, render: (context: unknown) => unknown) => {
        assertPluginRegistrationId(id, "viewer");
        viewers.set(id, render);
        appendRuntimeLog(pluginId, "info", `registered viewer: ${id}`);
      },
    };
  };

  return {
    init: async ({ plugin: nextPlugin, mainSource, pageSource }) => {
      activePlugin = nextPlugin;
      mathApi = await import("mathjs");

      const mainExports = evaluateInProcessPluginModule(
        mainSource,
        pluginId,
        "main",
      );
      const pageExports = pageSource
        ? evaluateInProcessPluginModule(pageSource, pluginId, "page")
        : undefined;
      const context = createContext({});
      const activateMain =
        typeof mainExports.default === "function"
          ? mainExports.default
          : mainExports.activate;
      const activatePage =
        pageExports && typeof pageExports.default === "function"
          ? pageExports.default
          : pageExports?.activate;

      if (typeof activateMain === "function") {
        await activateMain(context);
      }

      if (typeof activatePage === "function") {
        await activatePage(context);
      }

      for (const candidate of [
        pageExports?.deactivate,
        mainExports.deactivate,
      ]) {
        if (typeof candidate === "function") {
          deactivates.push(candidate as (context: unknown) => unknown);
        }
      }

      return {
        actions: Object.keys(actions),
        pages: [...pages.keys()],
        viewers: [...viewers.keys()],
      };
    },
    invokeAction: async (actionId, input) => {
      const action = actions[actionId];

      if (!action) {
        throw new Error(`Missing action: ${actionId}`);
      }

      currentCapabilityContext = {
        activeTabSourcePath: null,
        targetGroupId:
          getPluginFileReadScope(plugin) === "target-group"
            ? ((await getActiveTargetGroupSnapshot())?.id ?? null)
            : null,
        targetGroupPaths: [],
      };

      try {
        return await action(input);
      } finally {
        currentCapabilityContext = undefined;
      }
    },
    renderPage: async (pageId) => {
      const page = pages.get(pageId);

      if (!page) {
        throw new Error(`Missing page: ${pageId}`);
      }

      currentCapabilityContext = {
        activeTabSourcePath: null,
        targetGroupId:
          getPluginFileReadScope(plugin) === "target-group"
            ? ((await getActiveTargetGroupSnapshot())?.id ?? null)
            : null,
        targetGroupPaths: [],
      };

      try {
        return serializeInProcessNode(await page(createContext({})));
      } finally {
        currentCapabilityContext = undefined;
      }
    },
    renderViewer: async (viewerId, sourcePath) => {
      const viewer = viewers.get(viewerId);

      if (!viewer) {
        throw new Error(`Missing viewer: ${viewerId}`);
      }

      currentCapabilityContext = {
        activeTabSourcePath: sourcePath,
        targetGroupId:
          getPluginFileReadScope(plugin) === "target-group"
            ? ((await getActiveTargetGroupSnapshot())?.id ?? null)
            : null,
        targetGroupPaths: [],
      };

      try {
        return serializeInProcessNode(
          await viewer(createContext({ sourcePath })),
        );
      } finally {
        currentCapabilityContext = undefined;
      }
    },
    deactivate: async () => {
      const context = createContext({});

      for (const deactivate of deactivates) {
        await deactivate(context);
      }
    },
    terminate: () => {},
  };
};

const handleSandboxHostRequest = async (
  plugin: GlimpsePlugin,
  worker: Worker,
  capabilityContexts: Map<string, PluginCapabilityContext>,
  message: Extract<SandboxWorkerResponse, { type: "hostRequest" }>,
) => {
  try {
    const result = await routeSandboxHostRequest(
      plugin,
      capabilityContexts,
      message.request,
    );

    worker.postMessage({
      type: "hostResponse",
      requestId: message.requestId,
      ok: true,
      result,
    });
  } catch (error) {
    worker.postMessage({
      type: "hostResponse",
      requestId: message.requestId,
      ok: false,
      error: stringifyError(error),
    });
  }
};

const routeSandboxHostRequest = async (
  plugin: GlimpsePlugin,
  capabilityContexts: Map<string, PluginCapabilityContext>,
  request: Extract<SandboxWorkerResponse, { type: "hostRequest" }>["request"],
): Promise<unknown> => {
  switch (request.kind) {
    case "readText":
      return readPluginTextFile(
        plugin,
        request.sourcePath,
        request.capabilityToken
          ? capabilityContexts.get(request.capabilityToken)
          : undefined,
      );

    case "readBinary":
      return readPluginBinaryFile(
        plugin,
        request.sourcePath,
        request.capabilityToken
          ? capabilityContexts.get(request.capabilityToken)
          : undefined,
      );

    case "getMetadata":
      return readPluginFileMetadata(
        plugin,
        request.sourcePath,
        request.capabilityToken
          ? capabilityContexts.get(request.capabilityToken)
          : undefined,
      );

    case "log":
      appendRuntimeLog(
        plugin.id,
        request.level,
        stringifyLogValues(request.values),
      );
      return null;
  }
};

const createPluginContext = (
  plugin: GlimpsePlugin,
  actions: PluginActions,
  components: PluginComponents,
): PluginContext => {
  const invokeAction: PluginActionInvoker = (id, input) =>
    invokePluginAction(actions, id, input);
  const pluginApiVersion = plugin.apiVersion ?? "0.1.0";

  return {
    registerAction: undefined as never,
    registerPage: undefined as never,
    registerViewer: undefined as never,
    h: createElement,
    components,
    actions: {
      invoke: invokeAction,
    },
    plugin: {
      id: plugin.id,
      version: plugin.version,
      apiVersion: pluginApiVersion,
    },
    i18n: createPluginI18nApi(plugin),
    api: {
      version: pluginApiVersion,
    },
    files: {
      readText: async (sourcePath: string) =>
        readPluginTextFile(plugin, sourcePath),
      readBinary: async (sourcePath: string) =>
        readPluginBinaryFile(plugin, sourcePath),
      getMetadata: async (sourcePath: string) =>
        readPluginFileMetadata(plugin, sourcePath),
      toAssetUrl: (sourcePath: string) =>
        `glimpse-plugin-asset:${encodeURIComponent(sourcePath)}`,
    },
    log: {
      info: (...values) => {
        console.info(`[plugin:${plugin.id}]`, ...values);
        appendRuntimeLog(plugin.id, "info", stringifyLogValues(values));
      },
      warn: (...values) => {
        console.warn(`[plugin:${plugin.id}]`, ...values);
        appendRuntimeLog(plugin.id, "warn", stringifyLogValues(values));
      },
      error: (...values) => {
        console.error(`[plugin:${plugin.id}]`, ...values);
        appendRuntimeLog(plugin.id, "error", stringifyLogValues(values));
      },
    },
  };
};

const loadPluginStyles = async (
  pluginId: string,
): Promise<HTMLStyleElement | undefined> => {
  if (typeof document === "undefined") {
    return undefined;
  }

  try {
    const asset = await pluginsApi.getAssetSource(pluginId, "styles");
    const styleElement = document.createElement("style");
    styleElement.dataset.glimpsePluginStyle = pluginId;
    styleElement.textContent = asset.source;
    document.head.appendChild(styleElement);

    return styleElement;
  } catch (error) {
    if (!String(error).includes("not found")) {
      console.warn(`[plugin:${pluginId}] failed to load styles.css`, error);
      appendRuntimeLog(
        pluginId,
        "warn",
        `failed to load styles.css: ${stringifyError(error)}`,
      );
    }

    return undefined;
  }
};

const SandboxedPluginRender = ({
  runtime,
  renderKind,
  renderId,
  sourcePath,
}: {
  runtime: Omit<LoadedPluginRuntime, "deactivate">;
  renderKind: "page" | "viewer";
  renderId: string;
  sourcePath?: string | null;
}) => {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; node: ReactNode }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading" });

    const render =
      renderKind === "page"
        ? runtime.sandbox.renderPage(renderId)
        : runtime.sandbox.renderViewer(renderId, sourcePath);
    const targetGroupSnapshot =
      runtime.fileReadScope === "target-group"
        ? getActiveTargetGroupSnapshot()
        : Promise.resolve(undefined);

    Promise.all([render, targetGroupSnapshot])
      .then(([node, invocationTargetGroupSnapshot]) => {
        if (!cancelled) {
          setState({
            status: "ready",
            node: deserializePluginNode(node, runtime, {
              activeTabSourcePath:
                renderKind === "viewer" ? sourcePath : undefined,
              targetGroupId: invocationTargetGroupSnapshot?.id ?? null,
              targetGroupPaths: invocationTargetGroupSnapshot?.paths ?? [],
            }),
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ status: "error", message: stringifyError(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [renderId, renderKind, runtime, sourcePath]);

  if (state.status === "loading") {
    return createElement(
      "div",
      { className: "py-3 text-text-muted" },
      "Loading plugin content",
    );
  }

  if (state.status === "error") {
    return createElement(
      "div",
      { className: "py-3 text-red-400" },
      state.message,
    );
  }

  return state.node;
};

const deserializePluginNode = (
  node: SerializedPluginNode,
  runtime: Omit<LoadedPluginRuntime, "deactivate">,
  capabilityContext: Omit<PluginCapabilityContext, "token">,
): ReactNode => {
  if (Array.isArray(node)) {
    return node.map((child, index) =>
      createElement(
        "span",
        { key: index },
        deserializePluginNode(child, runtime, capabilityContext),
      ),
    );
  }

  if (
    node === null ||
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "boolean"
  ) {
    return node;
  }

  if (!isSerializedPluginElement(node)) {
    return null;
  }

  const children = (node.children ?? []).map((child) =>
    deserializePluginNode(child, runtime, capabilityContext),
  );
  const props = deserializePluginProps(
    node.type,
    node.props ?? {},
    runtime,
    capabilityContext,
  );
  const Component = getPluginElementType(node.type, runtime.components);

  if (!Component) {
    return null;
  }

  return createElement(Component, props, ...children);
};

const deserializePluginProps = (
  type: string,
  props: Record<string, unknown>,
  runtime: Omit<LoadedPluginRuntime, "deactivate">,
  capabilityContext: Omit<PluginCapabilityContext, "token">,
): Record<string, unknown> => {
  const allowedProps = getAllowedPluginProps(type);
  const nextProps: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (!allowedProps.has(key)) {
      continue;
    }

    nextProps[key] = deserializePluginPropValue(
      value,
      runtime,
      capabilityContext,
    );
  }

  if (type === "FileOpenButton" && typeof nextProps.sourcePath === "string") {
    if (runtime.fileReadScope !== "active-tab") {
      throw new Error(
        `FileOpenButton requires active-tab file read capability: ${runtime.pluginId}`,
      );
    }

    assertPluginFileAccess(
      {
        id: runtime.pluginId,
        name: runtime.pluginId,
        version: runtime.version,
        capabilities: {
          files: {
            read: runtime.fileReadScope,
          },
        },
      },
      nextProps.sourcePath,
      {
        token: "file-open-button",
        activeTabSourcePath: capabilityContext.activeTabSourcePath,
        targetGroupId: capabilityContext.targetGroupId,
        targetGroupPaths: capabilityContext.targetGroupPaths,
      },
    );
  }

  if (
    (type === "iframe" || type === "DeferredFrame") &&
    typeof nextProps.src === "string"
  ) {
    nextProps.src = deserializePluginAssetUrl(
      nextProps.src,
      runtime,
      capabilityContext,
    );
  }

  if (
    type === "iframe" &&
    typeof nextProps.srcDoc === "string" &&
    typeof nextProps.srcDocBasePath === "string"
  ) {
    const baseHref = deserializePluginAssetBaseHref(
      nextProps.srcDocBasePath,
      runtime,
      capabilityContext,
    );

    if (baseHref) {
      nextProps.srcDoc = injectHtmlBaseHref(nextProps.srcDoc, baseHref);
    }
  }

  delete nextProps.srcDocBasePath;

  return nextProps;
};

const deserializePluginPropValue = (
  value: unknown,
  runtime: Omit<LoadedPluginRuntime, "deactivate">,
  capabilityContext: Omit<PluginCapabilityContext, "token">,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      deserializePluginPropValue(entry, runtime, capabilityContext),
    );
  }

  if (isSerializedPluginElement(value)) {
    return deserializePluginNode(value, runtime, capabilityContext);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        deserializePluginPropValue(entryValue, runtime, capabilityContext),
      ]),
    );
  }

  return value;
};

const deserializePluginAssetUrl = (
  value: string,
  runtime: Omit<LoadedPluginRuntime, "deactivate">,
  capabilityContext: Omit<PluginCapabilityContext, "token">,
): string | undefined => {
  const prefix = "glimpse-plugin-asset:";

  if (!value.startsWith(prefix)) {
    return undefined;
  }

  const sourcePath = decodeURIComponent(value.slice(prefix.length));

  if (runtime.fileReadScope !== "active-tab") {
    return undefined;
  }

  assertPluginFileAccess(
    {
      id: runtime.pluginId,
      name: runtime.pluginId,
      version: runtime.version,
      capabilities: {
        files: {
          read: runtime.fileReadScope,
        },
      },
    },
    sourcePath,
    {
      token: "asset",
      activeTabSourcePath: capabilityContext.activeTabSourcePath,
      targetGroupId: capabilityContext.targetGroupId,
      targetGroupPaths: capabilityContext.targetGroupPaths,
    },
  );

  return convertFileSrc(sourcePath);
};

const deserializePluginAssetBaseHref = (
  value: string,
  runtime: Omit<LoadedPluginRuntime, "deactivate">,
  capabilityContext: Omit<PluginCapabilityContext, "token">,
): string | undefined => {
  const prefix = "glimpse-plugin-asset:";

  if (!value.startsWith(prefix)) {
    return undefined;
  }

  const sourcePath = decodeURIComponent(value.slice(prefix.length));

  if (runtime.fileReadScope !== "active-tab") {
    return undefined;
  }

  assertPluginFileAccess(
    {
      id: runtime.pluginId,
      name: runtime.pluginId,
      version: runtime.version,
      capabilities: {
        files: {
          read: runtime.fileReadScope,
        },
      },
    },
    sourcePath,
    {
      token: "asset-base",
      activeTabSourcePath: capabilityContext.activeTabSourcePath,
      targetGroupId: capabilityContext.targetGroupId,
      targetGroupPaths: capabilityContext.targetGroupPaths,
    },
  );

  const parentPath = getParentFilePath(sourcePath);

  if (!parentPath) {
    return undefined;
  }

  return ensureTrailingSlash(convertFileSrc(parentPath));
};

const getParentFilePath = (sourcePath: string): string | undefined => {
  const normalized = sourcePath
    .trim()
    .replace(/^\\\\\?\\/, "")
    .replace(/^\/\/\?\//, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");
  const lastSlashIndex = normalized.lastIndexOf("/");

  if (lastSlashIndex < 0) {
    return undefined;
  }

  if (lastSlashIndex === 0) {
    return "/";
  }

  return normalized.slice(0, lastSlashIndex);
};

const ensureTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value : `${value}/`;

const injectHtmlBaseHref = (html: string, baseHref: string): string => {
  const base = `<base href="${escapeHtmlAttribute(baseHref)}">`;

  if (/<base\b/i.test(html)) {
    return html;
  }

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (head) => `${head}\n${base}`);
  }

  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(
      /<html\b[^>]*>/i,
      (tag) => `${tag}\n<head>${base}</head>`,
    );
  }

  return `<head>${base}</head>\n${html}`;
};

const escapeHtmlAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const getPluginElementType = (
  type: string,
  components: PluginComponents,
): ComponentType<any> | keyof HTMLElementTagNameMap | undefined => {
  if (Object.prototype.hasOwnProperty.call(components, type)) {
    return components[type as keyof PluginComponents] as ComponentType<any>;
  }

  if (ALLOWED_HTML_ELEMENTS.has(type)) {
    return type as keyof HTMLElementTagNameMap;
  }

  return undefined;
};

const ALLOWED_HTML_ELEMENTS = new Set([
  "div",
  "iframe",
  "span",
  "p",
  "code",
  "pre",
]);
const COMMON_PLUGIN_PROPS = new Set(["key", "className", "title"]);
const COMPONENT_PLUGIN_PROPS: Record<string, string[]> = {
  Stack: ["gap"],
  Text: ["variant"],
  Section: ["title"],
  KeyValueList: ["rows"],
  Button: ["action", "input", "variant", "disabled"],
  Input: [
    "action",
    "defaultValue",
    "placeholder",
    "submitLabel",
    "clearOnSubmit",
  ],
  Table: ["columns", "rows", "empty"],
  Tabs: ["items"],
  List: ["items", "ordered", "empty"],
  Details: ["title", "defaultOpen"],
  Markdown: ["content"],
  DeferredFrame: [
    "src",
    "title",
    "className",
    "label",
    "description",
    "buttonLabel",
  ],
  FileOpenButton: ["sourcePath", "label", "variant"],
  FileDropConverter: [
    "action",
    "accept",
    "maxBytes",
    "outputDirectoryPreference",
    "title",
    "description",
    "chooseFileLabel",
    "emptyLabel",
    "successLabel",
  ],
  OutputDirectorySettings: [
    "preference",
    "label",
    "placeholder",
    "chooseDirectoryLabel",
    "description",
  ],
  ActionPlayground: ["action", "placeholder", "examples", "submitLabel"],
  ActionSettings: ["action", "copySearchResultLabel"],
  CalculationPanel: ["action", "examples", "input", "result"],
  iframe: ["src", "srcDoc", "srcDocBasePath", "sandbox", "title", "className"],
};

const getAllowedPluginProps = (type: string): Set<string> =>
  new Set([...(COMPONENT_PLUGIN_PROPS[type] ?? []), ...COMMON_PLUGIN_PROPS]);

const isSerializedPluginElement = (
  value: unknown,
): value is SerializedPluginElement =>
  Boolean(value) &&
  typeof value === "object" &&
  (value as { __glimpsePluginNode?: unknown }).__glimpsePluginNode === true;

const createSerializedPluginElement = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
): SerializedPluginElement => {
  if (typeof type !== "string") {
    throw new Error(
      "Plugin elements must use Core components or allowed HTML tags",
    );
  }

  if (
    !Object.prototype.hasOwnProperty.call(COMPONENT_PLUGIN_PROPS, type) &&
    !ALLOWED_HTML_ELEMENTS.has(type)
  ) {
    throw new Error(`Plugin element is not allowed: ${type}`);
  }

  return {
    __glimpsePluginNode: true,
    type,
    props: serializeInProcessProps(props ?? {}),
    children: children.flatMap((child) => normalizeInProcessChild(child)),
  };
};

const normalizeInProcessAction = (
  registration: unknown,
): ((input?: unknown) => unknown | Promise<unknown>) => {
  if (typeof registration === "function") {
    return registration as (input?: unknown) => unknown | Promise<unknown>;
  }

  if (
    registration &&
    typeof registration === "object" &&
    typeof (registration as { handler?: unknown }).handler === "function"
  ) {
    return (
      registration as {
        handler: (input?: unknown) => unknown | Promise<unknown>;
      }
    ).handler;
  }

  throw new Error(
    "plugin action registration must be a function or handler object",
  );
};

const normalizeInProcessChild = (value: unknown): SerializedPluginNode[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeInProcessChild(entry));
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    isSerializedPluginElement(value)
  ) {
    return [value ?? null];
  }

  return [String(value)];
};

const serializeInProcessProps = (
  props: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(props)
      .filter(
        ([, value]) => typeof value !== "function" && typeof value !== "symbol",
      )
      .map(([key, value]) => [key, serializeInProcessValue(value)]),
  );

const serializeInProcessValue = (value: unknown): unknown => {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    isSerializedPluginElement(value)
  ) {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return value.map(serializeInProcessValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([, entryValue]) =>
            typeof entryValue !== "function" && typeof entryValue !== "symbol",
        )
        .map(([key, entryValue]) => [key, serializeInProcessValue(entryValue)]),
    );
  }

  return String(value);
};

const serializeInProcessNode = (value: unknown): SerializedPluginNode => {
  if (Array.isArray(value)) {
    return value.map(serializeInProcessNode);
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    isSerializedPluginElement(value)
  ) {
    return (value ?? null) as SerializedPluginNode;
  }

  return String(value);
};

const evaluateInProcessPluginModule = (
  source: string,
  pluginId: string,
  entrypoint: "main" | "page",
) => {
  assertSupportedInProcessPluginModuleSource(source);

  const exports: Record<string, unknown> = {};
  const transformed = transformInProcessPluginModuleSource(source);
  const runModule = new Function(
    "exports",
    "console",
    "globalThis",
    "window",
    "document",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "fetch",
    "WebSocket",
    "Worker",
    "importScripts",
    "require",
    "process",
    "Function",
    `"use strict";\n${transformed}\n//# sourceURL=glimpse-plugin-test://${pluginId}/${entrypoint}.js`,
  );

  runModule(
    exports,
    console,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  return exports as {
    default?: unknown;
    activate?: unknown;
    deactivate?: unknown;
  };
};

const transformInProcessPluginModuleSource = (source: string): string =>
  source
    .replace(/^\s*import\s+\{[^}]*\}\s+from\s+["']mathjs["'];?\s*$/gm, "")
    .replace(
      /export\s+default\s+(async\s+)?function\s*([A-Za-z_$][\w$]*)?\s*\(/g,
      (_match, asyncKeyword: string | undefined, name: string | undefined) =>
        `exports.default = ${asyncKeyword ?? ""}function${name ? ` ${name}` : ""}(`,
    )
    .replace(/export\s+default\s+/g, "exports.default = ")
    .replace(
      /export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
      (_match, asyncKeyword: string | undefined, name: string) =>
        `exports.${name} = ${asyncKeyword ?? ""}function ${name}(`,
    )
    .replace(
      /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
      (_match, name: string) => `exports.${name} =`,
    )
    .replace(/export\s+\{\s*([^}]+)\s*\};?/g, (_match, names: string) =>
      names
        .split(",")
        .map((rawName) => {
          const [localName, exportedName] = rawName.trim().split(/\s+as\s+/);

          return `exports.${exportedName ?? localName} = ${localName};`;
        })
        .join("\n"),
    );

const assertSupportedInProcessPluginModuleSource = (source: string) => {
  if (containsBareInProcessCall(source, "import")) {
    throw new Error("dynamic import is not available in plugin main.js");
  }

  if (containsBareInProcessCall(source, "require")) {
    throw new Error("require is not available in plugin main.js");
  }

  if (containsInProcessIdentifier(source, "eval")) {
    throw new Error("eval is not available in plugin main.js");
  }

  if (containsInProcessFunctionConstructorAccess(source)) {
    throw new Error(
      "function constructors are not available in plugin main.js",
    );
  }
};

const containsBareInProcessCall = (source: string, name: string): boolean => {
  const pattern = new RegExp(`(^|[^\\w$.])${name}\\s*\\(`);

  return pattern.test(source);
};

const containsInProcessIdentifier = (source: string, name: string): boolean => {
  const pattern = new RegExp(`(^|[^\\w$])${name}($|[^\\w$])`);

  return pattern.test(source);
};

const containsInProcessFunctionConstructorAccess = (source: string): boolean =>
  /(?:\.\s*constructor\b|\[\s*["']constructor["']\s*\]|["']constructor["'])/.test(
    source,
  );

const assertPluginRegistrationId = (id: string, label: string) => {
  if (!id || !/^[A-Za-z0-9_.:-]+$/.test(id) || id.includes("..")) {
    throw new Error(`invalid plugin ${label} id: ${id}`);
  }
};

const assertPluginPageId = (pluginId: string, pageId: string) => {
  assertPluginRegistrationId(pageId, "page");

  const expectedPrefix = `plugin:${pluginId}`;

  if (!pageId.startsWith(expectedPrefix)) {
    throw new Error(
      `plugin page id must start with ${expectedPrefix}: ${pageId}`,
    );
  }
};

const getSnapshot = (pluginId: string): PluginRuntimeSnapshot =>
  runtimeSnapshots.get(pluginId) ?? {
    pluginId,
    status: "inactive",
    logs: [],
    updatedAt: new Date(0).toISOString(),
  };

const setRuntimeSnapshot = (
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

const appendRuntimeLog = (
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

const stringifyLogValues = (values: unknown[]): string =>
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

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
