import type { ComponentType } from "react";

import type { PluginComponents } from "./pluginComponents";
import type {
  SerializedPluginElement,
  SerializedPluginNode,
} from "./pluginSandboxProtocol";

export const ALLOWED_HTML_ELEMENTS = new Set([
  "div",
  "iframe",
  "span",
  "p",
  "code",
  "pre",
]);

const COMMON_PLUGIN_PROPS = new Set(["key", "className", "title"]);

export const COMPONENT_PLUGIN_PROPS: Record<string, string[]> = {
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
    "multiple",
    "maxBytes",
    "maxFiles",
    "outputDirectoryPreference",
    "title",
    "description",
    "chooseFileLabel",
    "emptyLabel",
    "successLabel",
    "convertingLabel",
    "resultsLabel",
    "revealLabel",
    "clearLabel",
    "fileColumnLabel",
    "sizeColumnLabel",
    "pathColumnLabel",
    "emptyResultsLabel",
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

export const getPluginElementType = (
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

export const getAllowedPluginProps = (type: string): Set<string> =>
  new Set([...(COMPONENT_PLUGIN_PROPS[type] ?? []), ...COMMON_PLUGIN_PROPS]);

export const isSerializedPluginElement = (
  value: unknown,
): value is SerializedPluginElement =>
  Boolean(value) &&
  typeof value === "object" &&
  (value as { __glimpsePluginNode?: unknown }).__glimpsePluginNode === true;

export const createSerializedPluginElement = (
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

export const normalizeInProcessAction = (
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

  if (Array.isArray(value)) return value.map(serializeInProcessValue);

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

export const serializeInProcessNode = (
  value: unknown,
): SerializedPluginNode => {
  if (Array.isArray(value)) return value.map(serializeInProcessNode);

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
