import type { GlimpsePlugin } from "@/types";
import { createPluginI18nApi } from "../registry/i18n";
import {
  getActiveTargetGroupSnapshot,
  getPluginFileReadScope,
  readPluginBinaryFile,
  readPluginFileMetadata,
  readPluginTextFile,
} from "./capabilities";
import { evaluateInProcessPluginModule } from "./moduleEvaluator";
import {
  assertPluginPageId,
  assertPluginRegistrationId,
} from "./registrationIds";
import type { PluginCapabilityContext, PluginSandbox } from "./sandboxProtocol";
import {
  ALLOWED_HTML_ELEMENTS,
  COMPONENT_PLUGIN_PROPS,
  createSerializedPluginElement,
  normalizeInProcessAction,
  serializeInProcessNode,
} from "./serializedNodes";
import { appendRuntimeLog, stringifyLogValues } from "./runtimeState";

export const createInProcessPluginSandbox = (
  plugin: GlimpsePlugin,
): PluginSandbox => {
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
