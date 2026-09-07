// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GlimpsePlugin } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

const mockedInvoke = vi.mocked(invoke);

const testPlugin = (id = "runtime-plugin"): GlimpsePlugin => ({
  id,
  name: "Runtime Plugin",
  version: "0.1.0",
  apiVersion: "0.1.0",
});

const loadRuntimeModule = async () => {
  vi.resetModules();

  return import("./pluginRuntime");
};

const mockPluginApi = (
  mainSource: string,
  stylesSource = ".plugin {}",
  pageSource?: string,
) => {
  mockedInvoke.mockImplementation((command, args) => {
    if (command === "get_plugin_entrypoint_source") {
      const entrypoint = (args as { entrypoint: "main" | "page" }).entrypoint;

      if (entrypoint === "page") {
        if (!pageSource) {
          return Promise.reject(new Error("page entrypoint not found"));
        }

        return Promise.resolve({
          pluginId: (args as { pluginId: string }).pluginId,
          entrypoint: "page",
          path: "page.js",
          source: pageSource,
        });
      }

      return Promise.resolve({
        pluginId: (args as { pluginId: string }).pluginId,
        entrypoint: "main",
        path: "main.js",
        source: mainSource,
      });
    }

    if (command === "get_plugin_asset_source") {
      return Promise.resolve({
        pluginId: (args as { pluginId: string }).pluginId,
        asset: "styles",
        path: "styles.css",
        source: stylesSource,
      });
    }

    if (command === "get_settings") {
      return Promise.resolve({
        theme: "dark",
        commands: {
          policyMode: "none",
          whitelist: [],
          blacklist: [],
        },
        plugins: {},
        targetGroups: [
          {
            id: "active",
            name: "Active",
            paths: ["C:/docs"],
            active: true,
          },
          {
            id: "other",
            name: "Other",
            paths: ["C:/other"],
            active: true,
          },
        ],
        currentTargetGroupId: "active",
        ui: {
          compactListItems: false,
          language: "en",
        },
        keybindings: {},
      });
    }

    if (command === "get_file_metadata") {
      return Promise.resolve({
        sizeBytes: 1024,
      });
    }

    if (command === "get_file_metadata_in_target_group") {
      return Promise.resolve({
        sizeBytes: 1024,
      });
    }

    if (command === "read_text_file") {
      return Promise.resolve(`file:${(args as { filePath: string }).filePath}`);
    }

    if (command === "read_binary_file") {
      return Promise.resolve(
        `binary:${(args as { filePath: string }).filePath}`,
      );
    }

    if (command === "read_text_file_in_target_group") {
      const { filePath, targetGroupId } = args as {
        filePath: string;
        targetGroupId: string;
      };
      const targetGroupRoots: Record<string, string[]> = {
        active: ["C:/docs"],
        other: ["C:/other"],
      };
      const configuredRoots = targetGroupRoots[targetGroupId] ?? [];
      const normalizeMockPath = (value: string) => {
        const segments: string[] = [];

        for (const segment of value.replace(/\\/g, "/").split("/")) {
          if (!segment || segment === ".") {
            continue;
          }

          if (segment === "..") {
            segments.pop();
            continue;
          }

          segments.push(segment);
        }

        return segments.join("/");
      };
      const normalizedPath = normalizeMockPath(filePath);
      const isAllowed = configuredRoots.some((root) => {
        const normalizedRoot = normalizeMockPath(root);

        return (
          normalizedPath === normalizedRoot ||
          normalizedPath.startsWith(`${normalizedRoot}/`)
        );
      });

      if (!isAllowed) {
        return Promise.reject(
          new Error("path is outside target group directories"),
        );
      }

      return Promise.resolve(`scoped-file:${filePath}`);
    }

    if (command === "read_binary_file_in_target_group") {
      const { filePath } = args as {
        filePath: string;
        targetGroupId: string;
      };

      return Promise.resolve(`binary:${filePath}`);
    }

    return Promise.reject(new Error(`unexpected command: ${command}`));
  });
};

beforeEach(() => {
  mockedInvoke.mockReset();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pluginRuntime", () => {
  it("activates main.js, registers actions, pages, viewers, and injects styles", async () => {
    const runtimeModule = await loadRuntimeModule();
    const i18nModule = await import("./pluginI18n");
    const plugin: GlimpsePlugin = {
      ...testPlugin(),
      i18n: {
        ja: {
          "actions.echo.result": "echo-ja:{input}",
          "pages.main.title": "Hello ja runtime-plugin",
        },
      },
    };

    i18nModule.setCurrentPluginLocale("ja");

    mockPluginApi(`
export default function activate(ctx) {
  ctx.registerAction("echo", (input) =>
    ctx.i18n.t("actions.echo.result", "echo:{input}").replace("{input}", input)
  );
  ctx.registerPage("plugin:runtime-plugin", ({ h, components, i18n }) =>
    h(components.Text, { variant: "strong" }, i18n.t("pages.main.title", "Hello " + ctx.plugin.id))
  );
  ctx.registerViewer("pdf", ({ h, components, sourcePath }) =>
    h(components.Text, { variant: "code" }, "viewer:" + sourcePath)
  );
  ctx.log.info("ready");
}
`);

    const runtime = await runtimeModule.activatePluginRuntime(plugin);

    await expect(
      Promise.resolve(runtime.actions.echo.handler("ok")),
    ).resolves.toBe("echo-ja:ok");
    expect(runtime.pages.has("plugin:runtime-plugin")).toBe(true);
    expect(runtime.viewers.has("pdf")).toBe(true);
    expect(runtime.context.i18n.locale).toBe("ja");

    render(
      <>{runtime.pages.get("plugin:runtime-plugin")?.(runtime.context)}</>,
    );

    await waitFor(() => {
      expect(screen.getByText("Hello ja runtime-plugin")).toBeTruthy();
    });

    expect(
      document.head.querySelector(
        "[data-glimpse-plugin-style='runtime-plugin']",
      )?.textContent,
    ).toBe(".plugin {}");

    render(
      <>
        {runtime.viewers.get("pdf")?.({
          ...runtime.context,
          sourcePath: "C:/docs/a.pdf",
        })}
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText("viewer:C:/docs/a.pdf")).toBeTruthy();
    });

    const snapshot = runtimeModule.getPluginRuntimeSnapshot(plugin.id);
    expect(snapshot.status).toBe("active");
    expect(snapshot.logs.some((log) => log.message.includes("ready"))).toBe(
      true,
    );

    await runtimeModule.deactivatePluginRuntime(plugin.id);

    expect(runtimeModule.getPluginRuntimeSnapshot(plugin.id).status).toBe(
      "inactive",
    );
    expect(
      document.head.querySelector(
        "[data-glimpse-plugin-style='runtime-plugin']",
      ),
    ).toBeNull();

    i18nModule.setCurrentPluginLocale("en");
  });

  it("loads page.js when the page entrypoint is declared", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin: GlimpsePlugin = {
      ...testPlugin("split-runtime-plugin"),
      entrypoints: {
        main: "./main.js",
        page: "./page.js",
      },
    };

    mockPluginApi(
      `
export default function activate(ctx) {
  ctx.registerAction("echo", (input) => "main:" + input);
}
`,
      ".plugin {}",
      `
export default function activate(ctx) {
  ctx.registerPage("plugin:split-runtime-plugin", ({ h, components }) =>
    h(components.Text, { variant: "strong" }, "page.js layout")
  );
}
`,
    );

    const runtime = await runtimeModule.activatePluginRuntime(plugin);

    await expect(
      Promise.resolve(runtime.actions.echo.handler("ok")),
    ).resolves.toBe("main:ok");
    expect(runtime.pages.has("plugin:split-runtime-plugin")).toBe(true);

    render(
      <>
        {runtime.pages.get("plugin:split-runtime-plugin")?.(runtime.context)}
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText("page.js layout")).toBeTruthy();
    });
  });

  it("blocks unsupported module APIs before plugin code runs", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin = testPlugin("blocked-runtime-plugin");

    mockPluginApi(`
export default function activate() {
  return import("outside");
}
`);

    await expect(runtimeModule.activatePluginRuntime(plugin)).rejects.toThrow(
      "dynamic import is not available",
    );

    const snapshot = runtimeModule.getPluginRuntimeSnapshot(plugin.id);
    expect(snapshot.status).toBe("error");
    expect(snapshot.error).toContain("dynamic import is not available");
  });

  it("blocks function constructor escape patterns before plugin code runs", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin = testPlugin("constructor-escape-plugin");

    mockPluginApi(`
export default function activate() {
  return (() => {}).constructor("return globalThis")();
}
`);

    await expect(runtimeModule.activatePluginRuntime(plugin)).rejects.toThrow(
      "function constructors are not available",
    );

    expect(runtimeModule.getPluginRuntimeSnapshot(plugin.id).error).toContain(
      "function constructors are not available",
    );
  });

  it("blocks reflected constructor escape patterns before plugin code runs", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin = testPlugin("reflected-constructor-escape-plugin");

    mockPluginApi(`
export default function activate() {
  const FunctionConstructor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(async function () {}),
    "constructor"
  ).value;

  return FunctionConstructor("return globalThis")();
}
`);

    await expect(runtimeModule.activatePluginRuntime(plugin)).rejects.toThrow(
      "function constructors are not available",
    );
  });

  it("uses a worker sandbox instead of evaluating plugin source in the app realm", async () => {
    const plugin = testPlugin("worker-runtime-plugin");

    class MockWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      constructor(_url: URL, _options?: WorkerOptions) {}

      postMessage(message: unknown) {
        const request = message as {
          id: number;
          type: string;
          actionId?: string;
          pageId?: string;
        };

        queueMicrotask(() => {
          if (request.type === "init") {
            this.onmessage?.({
              data: {
                id: request.id,
                ok: true,
                result: {
                  actions: ["echo"],
                  pages: ["plugin:worker-runtime-plugin"],
                  viewers: [],
                },
              },
            } as MessageEvent<unknown>);
            return;
          }

          if (request.type === "invokeAction") {
            this.onmessage?.({
              data: {
                id: request.id,
                ok: true,
                result: `worker:${request.actionId}`,
              },
            } as MessageEvent<unknown>);
            return;
          }

          if (request.type === "renderPage") {
            this.onmessage?.({
              data: {
                id: request.id,
                ok: true,
                result: {
                  __glimpsePluginNode: true,
                  type: "Text",
                  props: { variant: "strong" },
                  children: ["worker page"],
                },
              },
            } as MessageEvent<unknown>);
            return;
          }

          this.onmessage?.({
            data: { id: request.id, ok: true, result: null },
          } as MessageEvent<unknown>);
        });
      }

      terminate() {}
    }

    vi.stubGlobal("Worker", MockWorker);
    const runtimeModule = await loadRuntimeModule();

    mockPluginApi(`
export default function activate(ctx) {
  document.body.dataset.pluginEscape = "yes";
  ctx.registerAction("echo", () => "main-realm");
}
`);

    const runtime = await runtimeModule.activatePluginRuntime(plugin);

    expect(document.body.dataset.pluginEscape).toBeUndefined();
    await expect(runtime.actions.echo.handler()).resolves.toBe("worker:echo");

    render(
      <>
        {runtime.pages.get("plugin:worker-runtime-plugin")?.(runtime.context)}
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText("worker page")).toBeTruthy();
    });
  });

  it("terminates the worker when sandbox init times out", async () => {
    vi.useFakeTimers();

    const plugin = testPlugin("init-timeout-plugin");
    let terminated = false;

    class HangingWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      constructor(_url: URL, _options?: WorkerOptions) {}

      postMessage(_message: unknown) {}

      terminate() {
        terminated = true;
      }
    }

    vi.stubGlobal("Worker", HangingWorker);
    const runtimeModule = await loadRuntimeModule();

    mockPluginApi(`
export default function activate(ctx) {
  ctx.registerAction("echo", () => "late");
}
`);

    const activation = runtimeModule.activatePluginRuntime(plugin);
    const assertion = expect(activation).rejects.toThrow(
      "Plugin sandbox init timed out",
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;

    const snapshot = runtimeModule.getPluginRuntimeSnapshot(plugin.id);

    expect(terminated).toBe(true);
    expect(runtimeModule.getPluginRuntime(plugin.id)).toBeUndefined();
    expect(snapshot.status).toBe("error");
    expect(snapshot.error).toContain("Plugin sandbox init timed out");
  });

  it("terminates an active worker when sandbox action execution times out", async () => {
    vi.useFakeTimers();

    const plugin = testPlugin("action-timeout-plugin");
    let terminated = false;

    class ActionTimeoutWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      constructor(_url: URL, _options?: WorkerOptions) {}

      postMessage(message: unknown) {
        const request = message as {
          id: number;
          type: string;
          actionId?: string;
        };

        if (request.type === "init") {
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                id: request.id,
                ok: true,
                result: {
                  actions: ["echo"],
                  pages: [],
                  viewers: [],
                },
              },
            } as MessageEvent<unknown>);
          });
        }
      }

      terminate() {
        terminated = true;
      }
    }

    vi.stubGlobal("Worker", ActionTimeoutWorker);
    const runtimeModule = await loadRuntimeModule();

    mockPluginApi(`
export default function activate(ctx) {
  ctx.registerAction("echo", () => "late");
}
`);

    const runtime = await runtimeModule.activatePluginRuntime(plugin);
    const action = runtime.actions.echo.handler();
    const assertion = expect(action).rejects.toThrow(
      "Plugin sandbox invokeAction timed out",
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    const snapshot = runtimeModule.getPluginRuntimeSnapshot(plugin.id);

    expect(terminated).toBe(true);
    expect(runtimeModule.getPluginRuntime(plugin.id)).toBeUndefined();
    expect(snapshot.status).toBe("error");
    expect(snapshot.error).toContain("Plugin sandbox invokeAction timed out");
  });

  it("deserializes plugin UI through an allowlist and tokenized asset URLs", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin = testPlugin("ui-schema-plugin");

    mockPluginApi(`
export default function activate(ctx) {
  ctx.registerPage("plugin:ui-schema-plugin", ({ h }) =>
    h("iframe", {
      src: "https://example.invalid/escape",
      title: "schema frame",
      onLoad: () => {
        document.body.dataset.pluginEscape = "yes";
      },
    })
  );
}
`);

    const runtime = await runtimeModule.activatePluginRuntime(plugin);

    render(
      <>{runtime.pages.get("plugin:ui-schema-plugin")?.(runtime.context)}</>,
    );

    await waitFor(() => {
      expect(screen.getByTitle("schema frame")).toBeTruthy();
    });

    const iframe = screen.getByTitle("schema frame");

    expect(iframe.getAttribute("src")).toBeNull();
    expect(iframe.getAttribute("sandbox")).toBe(
      "allow-same-origin allow-scripts",
    );
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(document.body.dataset.pluginEscape).toBeUndefined();
  });

  it("denies file reads when the plugin does not declare file capability", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin = testPlugin("no-file-plugin");

    mockPluginApi(`
export default function activate(ctx) {
  ctx.registerViewer("txt", async ({ h, components, sourcePath }) =>
    h(components.Text, {}, await ctx.files.readText(sourcePath))
  );
}
`);

    const runtime = await runtimeModule.activatePluginRuntime(plugin);

    render(
      <>
        {runtime.viewers.get("txt")?.({
          ...runtime.context,
          sourcePath: "C:/docs/a.txt",
        })}
      </>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/plugin does not declare file read capability/),
      ).toBeTruthy();
    });
  });

  it("allows active-tab file reads only for the invocation source path", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin: GlimpsePlugin = {
      ...testPlugin("active-tab-file-plugin"),
      capabilities: {
        files: {
          read: "active-tab",
        },
      },
    };

    mockPluginApi(`
export default function activate(ctx) {
  ctx.registerViewer("txt", async ({ h, components, sourcePath }) =>
    h(components.Text, {}, await ctx.files.readText(sourcePath))
  );
  ctx.registerViewer("escape", async ({ h, components }) =>
    h(components.Text, {}, await ctx.files.readText("C:/docs/other.txt"))
  );
}
`);

    const runtime = await runtimeModule.activatePluginRuntime(plugin);

    render(
      <>
        {runtime.viewers.get("txt")?.({
          ...runtime.context,
          sourcePath: "C:/docs/a.txt",
        })}
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText("file:C:/docs/a.txt")).toBeTruthy();
    });

    document.body.innerHTML = "";

    render(
      <>
        {runtime.viewers.get("escape")?.({
          ...runtime.context,
          sourcePath: "C:/docs/a.txt",
        })}
      </>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/plugin file read denied by active-tab capability/),
      ).toBeTruthy();
    });
  });

  it("allows active-tab binary file reads for the invocation source path", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin: GlimpsePlugin = {
      ...testPlugin("binary-file-plugin"),
      capabilities: {
        files: {
          read: "active-tab",
        },
      },
    };

    mockPluginApi(`
export default function activate(ctx) {
  ctx.registerViewer("bin", async ({ h, components, sourcePath }) =>
    h(components.Text, {}, await ctx.files.readBinary(sourcePath))
  );
}
`);

    const runtime = await runtimeModule.activatePluginRuntime(plugin);

    render(
      <>
        {runtime.viewers.get("bin")?.({
          ...runtime.context,
          sourcePath: "C:/docs/a.docx",
        })}
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText("binary:C:/docs/a.docx")).toBeTruthy();
    });
  });

  it("does not expose active-tab files as raw asset protocol URLs", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin: GlimpsePlugin = {
      ...testPlugin("deferred-frame-plugin"),
      capabilities: {
        files: {
          read: "active-tab",
        },
      },
    };

    mockPluginApi(`
export default function activate(ctx) {
  ctx.registerViewer("pdf", async ({ h, components, sourcePath }) => {
    const metadata = await ctx.files.getMetadata(sourcePath);

    if (metadata.sizeBytes > 100) {
      return h(components.DeferredFrame, {
        src: ctx.files.toAssetUrl(sourcePath),
        title: "PDF preview",
        label: "Large PDF",
        buttonLabel: "Load Preview",
      });
    }

    return h("iframe", {
      src: ctx.files.toAssetUrl(sourcePath),
      title: "PDF preview",
    });
  });
}
`);

    const runtime = await runtimeModule.activatePluginRuntime(plugin);

    render(
      <>
        {runtime.viewers.get("pdf")?.({
          ...runtime.context,
          sourcePath: "C:/docs/a.pdf",
        })}
      </>,
    );

    await screen.findByText("Large PDF");
    expect(screen.queryByTitle("PDF preview")).toBeNull();

    expect(
      (
        screen.getByRole("button", {
          name: "Load Preview",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    expect(mockedInvoke).toHaveBeenCalledWith("get_file_metadata", {
      filePath: "C:/docs/a.pdf",
    });
  });

  it("does not inject raw local asset base URLs into plugin iframe srcDoc previews", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin: GlimpsePlugin = {
      ...testPlugin("html-frame-plugin"),
      capabilities: {
        files: {
          read: "active-tab",
        },
      },
    };

    mockPluginApi(`
export default function activate(ctx) {
  ctx.registerViewer("html", async ({ h, sourcePath }) => {
    const html = await ctx.files.readText(sourcePath);

    return h("iframe", {
      srcDoc: html,
      srcDocBasePath: ctx.files.toAssetUrl(sourcePath),
      sandbox: "allow-scripts",
      title: "HTML preview",
    });
  });
}
`);

    const runtime = await runtimeModule.activatePluginRuntime(plugin);

    render(
      <>
        {runtime.viewers.get("html")?.({
          ...runtime.context,
          sourcePath: "C:/docs/demo/index.html",
        })}
      </>,
    );

    const frame = await screen.findByTitle("HTML preview");

    expect(frame.getAttribute("srcdoc")).not.toContain("<base ");
    expect(frame.getAttribute("srcdoc")).toContain(
      "file:C:/docs/demo/index.html",
    );
    expect(frame.getAttribute("srcdocbasepath")).toBeNull();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("allows target-group file reads inside the current target group snapshot", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin: GlimpsePlugin = {
      ...testPlugin("target-group-file-plugin"),
      capabilities: {
        files: {
          read: "target-group",
        },
      },
    };

    mockPluginApi(`
export default function activate(ctx) {
  ctx.registerAction("read", (sourcePath) => ctx.files.readText(sourcePath));
}
`);

    const runtime = await runtimeModule.activatePluginRuntime(plugin);

    await expect(runtime.actions.read.handler("C:/docs/a.txt")).resolves.toBe(
      "scoped-file:C:/docs/a.txt",
    );
    await expect(
      runtime.actions.read.handler("C:/other/a.txt"),
    ).rejects.toThrow("path is outside target group directories");
    await expect(
      runtime.actions.read.handler("C:/docs/../other/a.txt"),
    ).rejects.toThrow("path is outside target group directories");
    expect(mockedInvoke).toHaveBeenCalledWith(
      "read_text_file_in_target_group",
      {
        filePath: "C:/docs/a.txt",
        targetGroupId: "active",
      },
    );
  });

  it("does not activate a plugin disabled while its runtime is loading", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin = testPlugin("cancelled-runtime-plugin");
    let resolveMainSource: (value: unknown) => void = () => {};
    const mainSourcePromise = new Promise((resolve) => {
      resolveMainSource = resolve;
    });

    mockedInvoke.mockImplementation((command, args) => {
      if (command === "get_plugin_entrypoint_source") {
        return mainSourcePromise;
      }

      if (command === "get_plugin_asset_source") {
        return Promise.resolve({
          pluginId: (args as { pluginId: string }).pluginId,
          asset: "styles",
          path: "styles.css",
          source: ".cancelled {}",
        });
      }

      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    const activation = runtimeModule.activatePluginRuntime(plugin);
    const sync = runtimeModule.syncPluginRuntimes([]);

    resolveMainSource({
      pluginId: plugin.id,
      entrypoint: "main",
      path: "main.js",
      source: `
export default function activate(ctx) {
  ctx.registerAction("echo", () => "still active");
}
`,
    });

    await expect(activation).rejects.toThrow("Plugin activation was cancelled");
    await sync;

    expect(runtimeModule.getPluginRuntime(plugin.id)).toBeUndefined();
    expect(runtimeModule.getPluginRuntimeSnapshot(plugin.id).status).toBe(
      "inactive",
    );
    expect(
      document.head.querySelector(
        "[data-glimpse-plugin-style='cancelled-runtime-plugin']",
      ),
    ).toBeNull();
  });

  it("rejects plugin pages outside the plugin id namespace", async () => {
    const runtimeModule = await loadRuntimeModule();
    const plugin = testPlugin("page-prefix-plugin");

    mockPluginApi(`
export default function activate(ctx) {
  ctx.registerPage("plugin:other-plugin", () => null);
}
`);

    await expect(runtimeModule.activatePluginRuntime(plugin)).rejects.toThrow(
      "plugin page id must start with plugin:page-prefix-plugin",
    );
  });
});
