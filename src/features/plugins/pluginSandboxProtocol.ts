import type { GlimpsePlugin } from "@/types";

export type PluginRuntimeLogLevel = "info" | "warn" | "error";

export type SerializedPluginNode =
  | null
  | string
  | number
  | boolean
  | SerializedPluginElement
  | SerializedPluginNode[];

export type SerializedPluginElement = {
  __glimpsePluginNode: true;
  type: string;
  props?: Record<string, unknown>;
  children?: SerializedPluginNode[];
};

export type PluginSandboxInitResult = {
  actions?: string[];
  pages?: string[];
  viewers?: string[];
};

export type PluginSandbox = {
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

export type SandboxWorkerRequest =
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

export type SandboxWorkerRequestInput<T> = T extends unknown
  ? Omit<T, "id" | "locale">
  : never;

export type SandboxWorkerResponse =
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

export type PluginCapabilityContext = {
  token: string;
  activeTabSourcePath?: string | null;
  targetGroupId?: string | null;
  targetGroupPaths: string[];
};
