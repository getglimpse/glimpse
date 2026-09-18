export const evaluateInProcessPluginModule = (
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
