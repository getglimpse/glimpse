import { all, create } from "mathjs";

type PluginRequest =
  | {
      id: number;
      type: "init";
      plugin: {
        id: string;
        version: string;
        apiVersion: string;
        i18n?: unknown;
      };
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

type HostRequest =
  | { kind: "readText"; sourcePath: string; capabilityToken?: string }
  | { kind: "readBinary"; sourcePath: string; capabilityToken?: string }
  | { kind: "getMetadata"; sourcePath: string; capabilityToken?: string }
  | { kind: "log"; level: "info" | "warn" | "error"; values: unknown[] };

type HostResponse =
  | { type: "hostResponse"; requestId: number; ok: true; result: unknown }
  | { type: "hostResponse"; requestId: number; ok: false; error: string };

type PluginModuleExports = Record<string, unknown> & {
  default?: unknown;
  activate?: unknown;
  deactivate?: unknown;
};

type SerializedNode =
  | null
  | string
  | number
  | boolean
  | SerializedElement
  | SerializedNode[];

type SerializedElement = {
  __glimpsePluginNode: true;
  type: string;
  props: Record<string, unknown>;
  children: SerializedNode[];
};

type PluginActionHandler = (input?: unknown) => unknown | Promise<unknown>;
type PluginPageRenderer = (context: unknown) => unknown;
type PluginViewerRenderer = (context: unknown) => unknown;

const COMPONENT_NAMES = [
  "Stack",
  "Text",
  "Section",
  "KeyValueList",
  "Button",
  "Input",
  "Table",
  "Tabs",
  "List",
  "Details",
  "Markdown",
  "DeferredFrame",
  "FileOpenButton",
  "FileDropConverter",
  "OutputDirectorySettings",
  "ActionPlayground",
  "ActionSettings",
  "CalculationPanel",
] as const;

const HTML_ELEMENT_NAMES = new Set([
  "div",
  "iframe",
  "span",
  "p",
  "code",
  "pre",
]);
const FALLBACK_LOCALES = ["en"];
const actions: Record<string, PluginActionHandler> = {};
const pages = new Map<string, PluginPageRenderer>();
const viewers = new Map<string, PluginViewerRenderer>();
const deactivates: Array<(context: unknown) => unknown> = [];
const pendingHostRequests = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

let pluginMeta: {
  id: string;
  version: string;
  apiVersion: string;
  i18n?: unknown;
} = {
  id: "",
  version: "",
  apiVersion: "0.1.0",
};
let currentLocale = "en";
let currentCapabilityToken: string | undefined;
let hostRequestId = 0;
const workerScope = self;
const postToHost = workerScope.postMessage.bind(workerScope);
let requestQueue = Promise.resolve();
const UnsafeFunction = Function;
const UnsafeAsyncFunction = Object.getPrototypeOf(async function () {})
  .constructor as FunctionConstructor;
const UnsafeGeneratorFunction = Object.getPrototypeOf(function* () {})
  .constructor as FunctionConstructor;
const UnsafeAsyncGeneratorFunction = Object.getPrototypeOf(
  async function* () {},
).constructor as FunctionConstructor;
const DisabledFunctionConstructor = function DisabledFunctionConstructor() {
  throw new Error("function constructors are not available in plugin main.js");
};

workerScope.addEventListener(
  "message",
  (event: MessageEvent<PluginRequest | HostResponse>) => {
    const message = event.data;

    if (message.type === "hostResponse") {
      const pending = pendingHostRequests.get(message.requestId);
      pendingHostRequests.delete(message.requestId);

      if (!pending) {
        return;
      }

      if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error(message.error));
      }

      return;
    }

    requestQueue = requestQueue
      .then(() => handleRequest(message))
      .catch((error) => {
        postToHost({
          id: message.id,
          ok: false,
          error: stringifyError(error),
        });
      });
  },
);

for (const name of [
  "self",
  "postMessage",
  "onmessage",
  "onmessageerror",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "close",
  "location",
  "navigator",
  "fetch",
  "WebSocket",
  "Worker",
  "SharedWorker",
  "XMLHttpRequest",
  "EventSource",
  "importScripts",
  "MessageChannel",
  "MessagePort",
  "BroadcastChannel",
  "caches",
  "indexedDB",
  "localStorage",
  "sessionStorage",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "queueMicrotask",
  "WebAssembly",
  "crypto",
  "eval",
  // Keep the real Function global for bundled dependencies such as mathjs,
  // while plugin modules receive a shadowed undefined Function parameter.
  "globalThis",
]) {
  try {
    Object.defineProperty(globalThis, name, {
      value: undefined,
      configurable: false,
      writable: false,
    });
  } catch {
    // Some worker globals are not configurable in every runtime.
  }
}

for (const constructor of [
  UnsafeFunction,
  UnsafeAsyncFunction,
  UnsafeGeneratorFunction,
  UnsafeAsyncGeneratorFunction,
]) {
  try {
    Object.defineProperty(constructor.prototype, "constructor", {
      value: DisabledFunctionConstructor,
      configurable: false,
      writable: false,
    });
  } catch {
    // Best-effort hardening; source validation still rejects constructor access.
  }
}

const handleRequest = async (message: PluginRequest) => {
  try {
    const result = await routeRequest(message);

    postToHost({
      id: message.id,
      ok: true,
      result,
    });
  } catch (error) {
    postToHost({
      id: message.id,
      ok: false,
      error: stringifyError(error),
    });
  }
};

const routeRequest = async (message: PluginRequest): Promise<unknown> => {
  currentLocale = message.locale;
  currentCapabilityToken =
    "capabilityToken" in message ? message.capabilityToken : undefined;

  try {
    switch (message.type) {
      case "init": {
        pluginMeta = message.plugin;

        const mainExports = evaluatePluginModule(message.mainSource, "main");
        const pageExports = message.pageSource
          ? evaluatePluginModule(message.pageSource, "page")
          : undefined;
        const context = createPluginContext();
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
      }

      case "invokeAction":
        return invokeAction(message.actionId, message.input);

      case "renderPage": {
        const renderer = pages.get(message.pageId);

        if (!renderer) {
          throw new Error(`Missing page: ${message.pageId}`);
        }

        return serializeNode(
          await renderer(createPluginRenderContext({ sourcePath: undefined })),
        );
      }

      case "renderViewer": {
        const renderer = viewers.get(message.viewerId);

        if (!renderer) {
          throw new Error(`Missing viewer: ${message.viewerId}`);
        }

        return serializeNode(
          await renderer(
            createPluginRenderContext({ sourcePath: message.sourcePath }),
          ),
        );
      }

      case "deactivate": {
        const context = createPluginContext();

        for (const deactivate of deactivates) {
          await deactivate(context);
        }

        return null;
      }
    }
  } finally {
    currentCapabilityToken = undefined;
  }
};

const createPluginContext = () => ({
  ...createPluginRenderContext({ sourcePath: undefined }),
  registerAction: (id: string, action: unknown) => {
    assertRegistrationId(id, "action");
    actions[id] = normalizeAction(action);
    void hostCall({
      kind: "log",
      level: "info",
      values: [`registered action: ${id}`],
    });
  },
  registerPage: (id: string, render: PluginPageRenderer) => {
    assertRegistrationId(id, "page");
    pages.set(id, render);
    void hostCall({
      kind: "log",
      level: "info",
      values: [`registered page: ${id}`],
    });
  },
  registerViewer: (id: string, render: PluginViewerRenderer) => {
    assertRegistrationId(id, "viewer");
    viewers.set(id, render);
    void hostCall({
      kind: "log",
      level: "info",
      values: [`registered viewer: ${id}`],
    });
  },
});

const createPluginRenderContext = ({
  sourcePath,
}: {
  sourcePath?: string | null;
}) => ({
  h,
  components: Object.fromEntries(COMPONENT_NAMES.map((name) => [name, name])),
  actions: {
    invoke: invokeAction,
  },
  plugin: {
    id: pluginMeta.id,
    version: pluginMeta.version,
    apiVersion: pluginMeta.apiVersion,
  },
  i18n: {
    get language() {
      return currentLocale;
    },
    get locale() {
      return currentLocale;
    },
    t: translate,
    has: (key: string) => translateValue(pluginMeta.i18n, key) !== undefined,
  },
  api: {
    version: pluginMeta.apiVersion,
  },
  math: {
    all,
    create,
  },
  files: {
    readText: (nextSourcePath: string) =>
      hostCall({
        kind: "readText",
        sourcePath: nextSourcePath,
        capabilityToken: currentCapabilityToken,
      }),
    readBinary: (nextSourcePath: string) =>
      hostCall({
        kind: "readBinary",
        sourcePath: nextSourcePath,
        capabilityToken: currentCapabilityToken,
      }),
    getMetadata: (nextSourcePath: string) =>
      hostCall({
        kind: "getMetadata",
        sourcePath: nextSourcePath,
        capabilityToken: currentCapabilityToken,
      }),
    toAssetUrl: (nextSourcePath: string) =>
      `glimpse-plugin-asset:${encodeURIComponent(nextSourcePath)}`,
  },
  log: {
    info: (...values: unknown[]) =>
      hostCall({ kind: "log", level: "info", values }),
    warn: (...values: unknown[]) =>
      hostCall({ kind: "log", level: "warn", values }),
    error: (...values: unknown[]) =>
      hostCall({ kind: "log", level: "error", values }),
  },
  sourcePath,
});

const h = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
): SerializedElement => {
  if (typeof type !== "string") {
    throw new Error(
      "Plugin elements must use Core components or allowed HTML tags",
    );
  }

  if (
    !COMPONENT_NAMES.includes(type as (typeof COMPONENT_NAMES)[number]) &&
    !HTML_ELEMENT_NAMES.has(type)
  ) {
    throw new Error(`Plugin element is not allowed: ${type}`);
  }

  return {
    __glimpsePluginNode: true,
    type,
    props: sanitizeProps(props ?? {}),
    children: children.flatMap((child) => normalizeChild(child)),
  };
};

const normalizeChild = (value: unknown): SerializedNode[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeChild(entry));
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    isSerializedElement(value)
  ) {
    return [value ?? null];
  }

  return [String(value)];
};

const sanitizeProps = (
  props: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(props)
      .filter(
        ([, value]) => typeof value !== "function" && typeof value !== "symbol",
      )
      .map(([key, value]) => [key, serializePropValue(value)]),
  );

const serializePropValue = (value: unknown): unknown => {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    isSerializedElement(value)
  ) {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return value.map(serializePropValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([, entryValue]) =>
            typeof entryValue !== "function" && typeof entryValue !== "symbol",
        )
        .map(([key, entryValue]) => [key, serializePropValue(entryValue)]),
    );
  }

  return String(value);
};

const serializeNode = (value: unknown): SerializedNode => {
  if (Array.isArray(value)) {
    return value.map(serializeNode);
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    isSerializedElement(value)
  ) {
    return (value ?? null) as SerializedNode;
  }

  return String(value);
};

const isSerializedElement = (value: unknown): value is SerializedElement =>
  Boolean(value) &&
  typeof value === "object" &&
  (value as { __glimpsePluginNode?: unknown }).__glimpsePluginNode === true;

const normalizeAction = (registration: unknown): PluginActionHandler => {
  if (typeof registration === "function") {
    return registration as PluginActionHandler;
  }

  if (
    registration &&
    typeof registration === "object" &&
    typeof (registration as { handler?: unknown }).handler === "function"
  ) {
    return (registration as { handler: PluginActionHandler }).handler;
  }

  throw new Error(
    "plugin action registration must be a function or handler object",
  );
};

const invokeAction = async (id: string, input?: unknown): Promise<unknown> => {
  const action = actions[id];

  if (!action) {
    throw new Error(`Missing action: ${id}`);
  }

  return action(input);
};

const hostCall = (request: HostRequest): Promise<unknown> => {
  const requestId = ++hostRequestId;

  postToHost({
    type: "hostRequest",
    requestId,
    request,
  });

  return new Promise((resolve, reject) => {
    pendingHostRequests.set(requestId, { resolve, reject });
  });
};

const evaluatePluginModule = (
  source: string,
  entrypoint: "main" | "page",
): PluginModuleExports => {
  assertSupportedPluginModuleSource(source);

  const exports: PluginModuleExports = {};
  const transformed = transformPluginModuleSource(source);
  const runModule = new UnsafeFunction(
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
    `"use strict";\n${transformed}\n//# sourceURL=glimpse-plugin-worker://${pluginMeta.id}/${entrypoint}.js`,
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

  return exports;
};

const transformPluginModuleSource = (source: string): string =>
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

const assertSupportedPluginModuleSource = (source: string) => {
  if (containsBareCall(source, "import")) {
    throw new Error("dynamic import is not available in plugin main.js");
  }

  if (containsBareCall(source, "require")) {
    throw new Error("require is not available in plugin main.js");
  }

  if (containsIdentifier(source, "eval")) {
    throw new Error("eval is not available in plugin main.js");
  }

  if (containsFunctionConstructorAccess(source)) {
    throw new Error(
      "function constructors are not available in plugin main.js",
    );
  }
};

const containsBareCall = (source: string, name: string): boolean => {
  const pattern = new RegExp(`(^|[^\\w$.])${name}\\s*\\(`);

  return pattern.test(source);
};

const containsIdentifier = (source: string, name: string): boolean => {
  const pattern = new RegExp(`(^|[^\\w$])${name}($|[^\\w$])`);

  return pattern.test(source);
};

const containsFunctionConstructorAccess = (source: string): boolean =>
  /(?:\.\s*constructor\b|\[\s*["']constructor["']\s*\]|["']constructor["'])/.test(
    source,
  );

const assertRegistrationId = (id: string, label: string) => {
  if (!id || !/^[A-Za-z0-9_.:-]+$/.test(id) || id.includes("..")) {
    throw new Error(`invalid plugin ${label} id: ${id}`);
  }
};

const translate = (key: string, fallback = key): string => {
  const value = translateValue(pluginMeta.i18n, key);

  return typeof value === "string" ? value : fallback;
};

const translateValue = (i18n: unknown, key: string): unknown => {
  for (const dictionary of getLocaleDictionaries(i18n)) {
    const value = readDictionaryValue(dictionary, key);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

const getLocaleDictionaries = (i18n: unknown): Record<string, unknown>[] => {
  if (!i18n || typeof i18n !== "object" || Array.isArray(i18n)) {
    return [];
  }

  const configured = i18n as {
    defaultLocale?: unknown;
    translations?: unknown;
  };
  const source = isLocaleMap(configured.translations)
    ? configured.translations
    : (i18n as Record<string, Record<string, unknown>>);
  const defaultLocale =
    typeof configured.defaultLocale === "string"
      ? configured.defaultLocale
      : undefined;
  const localeCandidates = [
    currentLocale,
    currentLocale.split("-")[0],
    defaultLocale,
    ...FALLBACK_LOCALES,
  ].filter((locale): locale is string => Boolean(locale));

  return [...new Set(localeCandidates)].flatMap((locale) => {
    const dictionary = source[locale];

    return isDictionary(dictionary) ? [dictionary] : [];
  });
};

const readDictionaryValue = (
  dictionary: Record<string, unknown>,
  key: string,
): unknown => {
  if (Object.prototype.hasOwnProperty.call(dictionary, key)) {
    return dictionary[key];
  }

  return key.split(".").reduce<unknown>((current, part) => {
    if (!isDictionary(current)) {
      return undefined;
    }

    return current[part];
  }, dictionary);
};

const isDictionary = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isLocaleMap = (
  value: unknown,
): value is Record<string, Record<string, unknown>> =>
  isDictionary(value) && Object.values(value).every(isDictionary);

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
