import { createElement, useEffect, useState, type ReactNode } from "react";
import {
  assertPluginFileAccess,
  getActiveTargetGroupSnapshot,
} from "./capabilities";
import type {
  PluginCapabilityContext,
  SerializedPluginNode,
} from "./sandboxProtocol";
import {
  getAllowedPluginProps,
  getPluginElementType,
  isSerializedPluginElement,
} from "./serializedNodes";
import { stringifyError } from "./runtimeState";
import type { LoadedPluginRuntime } from "./runtimeTypes";

export const SandboxedPluginRender = ({
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

  if (type === "iframe") {
    if (typeof nextProps.sandbox !== "string") {
      nextProps.sandbox = "allow-same-origin allow-scripts";
    }

    nextProps.referrerPolicy = "no-referrer";
  }

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

  return undefined;
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

  return undefined;
};

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
