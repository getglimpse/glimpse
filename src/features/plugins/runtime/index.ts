import { createElement } from "react";
import { pluginsApi } from "@/api/plugins";
import type { GlimpsePlugin, PluginRegistryItem } from "@/types";
import {
  createPluginComponents,
  type PluginActions,
  type PluginPageRenderer,
  type PluginViewerRenderer,
} from "../components";
import { getPluginFileReadScope } from "./capabilities";
import { createPluginContext, loadPluginStyles } from "./pluginContext";
import {
  assertPluginPageId,
  assertPluginRegistrationId,
} from "./registrationIds";
import type { PluginSandbox } from "./sandboxProtocol";
import { SandboxedPluginRender } from "./SandboxedPluginRender";
import {
  appendRuntimeLog,
  setRuntimeSnapshot,
  stringifyError,
} from "./runtimeState";
import type { LoadedPluginRuntime } from "./runtimeTypes";
import { createPluginSandbox } from "./workerSandbox";

export type { PluginRuntimeLogLevel } from "./sandboxProtocol";
export type {
  LoadedPluginRuntime,
  PluginRuntimeLogEntry,
  PluginRuntimeSnapshot,
} from "./runtimeTypes";
export {
  getPluginRuntimeSnapshot,
  getPluginRuntimeSnapshots,
  subscribeToPluginRuntimeChanges,
} from "./runtimeState";

const loadedRuntimes = new Map<string, LoadedPluginRuntime>();
const loadingRuntimes = new Map<string, Promise<LoadedPluginRuntime>>();
const runtimeActivationVersions = new Map<string, number>();

export const getPluginRuntime = (
  pluginId: string,
): LoadedPluginRuntime | undefined => loadedRuntimes.get(pluginId);

export const activatePluginRuntime = async (
  plugin: GlimpsePlugin,
): Promise<LoadedPluginRuntime> => {
  const loaded = loadedRuntimes.get(plugin.id);

  if (loaded) {
    return loaded;
  }

  const loading = loadingRuntimes.get(plugin.id);

  if (loading) {
    return loading;
  }

  const activationVersion = bumpRuntimeActivationVersion(plugin.id);
  const nextLoading = loadPluginRuntime(plugin, activationVersion).finally(
    () => {
      loadingRuntimes.delete(plugin.id);
    },
  );

  loadingRuntimes.set(plugin.id, nextLoading);

  return nextLoading;
};

export const deactivatePluginRuntime = async (pluginId: string) => {
  bumpRuntimeActivationVersion(pluginId);

  const loading = loadingRuntimes.get(pluginId);

  if (loading) {
    await loading.catch(() => undefined);
  }

  const runtime = loadedRuntimes.get(pluginId);

  if (!runtime) {
    setRuntimeSnapshot(pluginId, {
      status: "inactive",
      error: undefined,
      activatedAt: undefined,
    });
    return;
  }

  loadedRuntimes.delete(pluginId);

  try {
    if (runtime.deactivate) {
      await runtime.deactivate(runtime.context);
    }
  } catch (error) {
    appendRuntimeLog(pluginId, "error", stringifyError(error));
  }

  runtime.styleElement?.remove();
  runtime.sandbox.terminate();

  setRuntimeSnapshot(pluginId, {
    status: "inactive",
    error: undefined,
    activatedAt: undefined,
  });
};

export const reloadPluginRuntime = async (
  plugin: GlimpsePlugin,
): Promise<LoadedPluginRuntime> => {
  await deactivatePluginRuntime(plugin.id);

  return activatePluginRuntime(plugin);
};

export const syncPluginRuntimes = async (plugins: PluginRegistryItem[]) => {
  const enabledPluginIds = new Set(
    plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.id),
  );
  const activePluginIds = new Set([
    ...loadedRuntimes.keys(),
    ...loadingRuntimes.keys(),
  ]);

  await Promise.all(
    [...activePluginIds]
      .filter((pluginId) => !enabledPluginIds.has(pluginId))
      .map(deactivatePluginRuntime),
  );

  await Promise.allSettled(
    plugins
      .filter((plugin) => plugin.enabled)
      .map((plugin) => activatePluginRuntime(plugin)),
  );
};

const loadPluginRuntime = async (
  plugin: GlimpsePlugin,
  activationVersion: number,
): Promise<LoadedPluginRuntime> => {
  setRuntimeSnapshot(plugin.id, {
    status: "loading",
    error: undefined,
    activatedAt: undefined,
  });

  let styleElement: HTMLStyleElement | undefined;
  let sandbox: PluginSandbox | undefined;

  try {
    const mainSource = await pluginsApi.getEntrypointSource(plugin.id, "main");
    assertRuntimeActivationCurrent(plugin.id, activationVersion);

    const pageSource = plugin.entrypoints?.page
      ? await pluginsApi.getEntrypointSource(plugin.id, "page")
      : undefined;
    assertRuntimeActivationCurrent(plugin.id, activationVersion);

    const actions: PluginActions = {};
    const pages = new Map<string, PluginPageRenderer>();
    const viewers = new Map<string, PluginViewerRenderer>();
    const components = createPluginComponents(actions, plugin.id);
    const fileReadScope = getPluginFileReadScope(plugin);
    const activeSandbox = createPluginSandbox(plugin, failLoadedPluginRuntime);
    sandbox = activeSandbox;
    const context = createPluginContext(plugin, actions, components);

    styleElement = await loadPluginStyles(plugin.id);
    assertRuntimeActivationCurrent(plugin.id, activationVersion);

    const registrations = await activeSandbox.init({
      plugin,
      mainSource: mainSource.source,
      pageSource: pageSource?.source,
    });
    assertRuntimeActivationCurrent(plugin.id, activationVersion);

    for (const actionId of registrations.actions ?? []) {
      assertPluginRegistrationId(actionId, "action");
      actions[actionId] = {
        handler: (input) => activeSandbox.invokeAction(actionId, input),
      };
    }

    const runtimeShell = {
      pluginId: plugin.id,
      version: plugin.version,
      fileReadScope,
      actions,
      pages,
      viewers,
      components,
      styleElement,
      context,
      sandbox: activeSandbox,
    } satisfies Omit<LoadedPluginRuntime, "deactivate">;

    for (const pageId of registrations.pages ?? []) {
      assertPluginPageId(plugin.id, pageId);
      pages.set(pageId, () =>
        createElement(SandboxedPluginRender, {
          runtime: runtimeShell,
          renderKind: "page",
          renderId: pageId,
        }),
      );
    }

    for (const viewerId of registrations.viewers ?? []) {
      assertPluginRegistrationId(viewerId, "viewer");
      viewers.set(viewerId, ({ sourcePath }) =>
        createElement(SandboxedPluginRender, {
          runtime: runtimeShell,
          renderKind: "viewer",
          renderId: viewerId,
          sourcePath,
        }),
      );
    }

    const runtime: LoadedPluginRuntime = {
      pluginId: plugin.id,
      version: plugin.version,
      fileReadScope,
      actions,
      pages,
      viewers,
      components,
      styleElement,
      deactivate: () => activeSandbox.deactivate(),
      context,
      sandbox: activeSandbox,
    };

    if (!isRuntimeActivationCurrent(plugin.id, activationVersion)) {
      await cleanupCancelledRuntime(runtime);
      throw new PluginRuntimeActivationCancelled(plugin.id);
    }

    loadedRuntimes.set(plugin.id, runtime);

    setRuntimeSnapshot(plugin.id, {
      status: "active",
      error: undefined,
      activatedAt: new Date().toISOString(),
    });

    return runtime;
  } catch (error) {
    styleElement?.remove();
    sandbox?.terminate();

    if (error instanceof PluginRuntimeActivationCancelled) {
      throw error;
    }

    const message = stringifyError(error);
    appendRuntimeLog(plugin.id, "error", message);
    setRuntimeSnapshot(plugin.id, {
      status: "error",
      error: message,
      activatedAt: undefined,
    });

    throw error;
  }
};

class PluginRuntimeActivationCancelled extends Error {
  constructor(pluginId: string) {
    super(`Plugin activation was cancelled: ${pluginId}`);
    this.name = "PluginRuntimeActivationCancelled";
  }
}

const bumpRuntimeActivationVersion = (pluginId: string): number => {
  const nextVersion = (runtimeActivationVersions.get(pluginId) ?? 0) + 1;
  runtimeActivationVersions.set(pluginId, nextVersion);

  return nextVersion;
};

const isRuntimeActivationCurrent = (
  pluginId: string,
  activationVersion: number,
): boolean => runtimeActivationVersions.get(pluginId) === activationVersion;

const assertRuntimeActivationCurrent = (
  pluginId: string,
  activationVersion: number,
) => {
  if (!isRuntimeActivationCurrent(pluginId, activationVersion)) {
    throw new PluginRuntimeActivationCancelled(pluginId);
  }
};

const cleanupCancelledRuntime = async (runtime: LoadedPluginRuntime) => {
  try {
    if (runtime.deactivate) {
      await runtime.deactivate(runtime.context);
    }
  } catch (error) {
    appendRuntimeLog(runtime.pluginId, "error", stringifyError(error));
  }

  runtime.styleElement?.remove();
  runtime.sandbox.terminate();
};

const failLoadedPluginRuntime = (pluginId: string, error: Error) => {
  const runtime = loadedRuntimes.get(pluginId);

  if (runtime) {
    loadedRuntimes.delete(pluginId);
    runtime.styleElement?.remove();
  }

  const message = stringifyError(error);
  appendRuntimeLog(pluginId, "error", message);
  setRuntimeSnapshot(pluginId, {
    status: "error",
    error: message,
    activatedAt: undefined,
  });
};
