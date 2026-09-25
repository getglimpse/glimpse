import { createElement } from "react";
import type { FileMetadata } from "@/api/file";
import type { PluginFileReadScope } from "@/types";
import type {
  PluginActionInvoker,
  PluginActions,
  PluginComponents,
  PluginPageRenderer,
  PluginViewerRenderer,
} from "../components";
import type { PluginI18nApi } from "../registry/i18n";
import type { PluginRuntimeLogLevel, PluginSandbox } from "./sandboxProtocol";

type PluginRuntimeStatus = "inactive" | "loading" | "active" | "error";

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

export type PluginContext = {
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
