import type { GlimpsePlugin } from "@/types";
import { getCurrentPluginLocale } from "../registry/i18n";
import {
  createPluginCapabilityContext,
  readPluginBinaryFile,
  readPluginFileMetadata,
  readPluginTextFile,
} from "./capabilities";
import { createInProcessPluginSandbox } from "./inProcessSandbox";
import type {
  PluginCapabilityContext,
  PluginSandbox,
  PluginSandboxInitResult,
  SandboxWorkerRequest,
  SandboxWorkerRequestInput,
  SandboxWorkerResponse,
} from "./sandboxProtocol";
import {
  appendRuntimeLog,
  stringifyError,
  stringifyLogValues,
} from "./runtimeState";

class PluginSandboxTimeoutError extends Error {
  constructor(pluginId: string, requestType: SandboxWorkerRequest["type"]) {
    super(`Plugin sandbox ${requestType} timed out: ${pluginId}`);
    this.name = "PluginSandboxTimeoutError";
  }
}

const PLUGIN_SANDBOX_REQUEST_TIMEOUT_MS = {
  init: 5_000,
  invokeAction: 10_000,
  renderPage: 5_000,
  renderViewer: 5_000,
  deactivate: 2_000,
} satisfies Record<SandboxWorkerRequest["type"], number>;

export const createPluginSandbox = (
  plugin: GlimpsePlugin,
  onFailure: (pluginId: string, error: Error) => void,
): PluginSandbox => {
  const pluginId = plugin.id;

  if (typeof Worker === "undefined") {
    if (import.meta.env.MODE === "test") {
      return createInProcessPluginSandbox(plugin);
    }

    throw new Error("Plugin sandbox worker is not available in this runtime");
  }

  const worker = new Worker(new URL("./sandboxWorker.ts", import.meta.url), {
    type: "module",
    name: `glimpse-plugin:${pluginId}`,
  });
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
      onFailure(pluginId, pendingError);
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
