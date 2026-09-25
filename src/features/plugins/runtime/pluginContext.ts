import { createElement } from "react";
import { pluginsApi } from "@/api/plugins";
import type { GlimpsePlugin } from "@/types";
import {
  invokePluginAction,
  type PluginActionInvoker,
  type PluginActions,
  type PluginComponents,
} from "../components";
import { createPluginI18nApi } from "../registry/i18n";
import {
  readPluginBinaryFile,
  readPluginFileMetadata,
  readPluginTextFile,
} from "./capabilities";
import {
  appendRuntimeLog,
  stringifyError,
  stringifyLogValues,
} from "./runtimeState";
import type { PluginContext } from "./runtimeTypes";

export const createPluginContext = (
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

export const loadPluginStyles = async (
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
