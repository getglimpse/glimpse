import { createElement } from "react";

import { pluginsApi } from "@/api/plugins";
import {
  activatePluginRuntime,
  deactivatePluginRuntime,
  getPluginRuntime,
  reloadPluginRuntime,
  subscribeToPluginRuntimeChanges,
  syncPluginRuntimes,
} from "@/features/plugins/pluginRuntime";
import { invokePluginAction } from "@/features/plugins/pluginComponents";
import {
  localizeAction,
  localizeInternalPage,
  localizePlugin,
  localizeViewer,
  setCurrentPluginLocale,
} from "@/features/plugins/pluginI18n";
import type {
  GlimpsePlugin,
  IndexItem,
  InternalPageContribution,
  PluginActionManifest,
  PluginDiscoveryError,
  PluginInternalPageManifest,
  PluginInternalPage,
  PluginRegistryItem,
  PluginTrustStatus,
  PluginViewerManifest,
} from "@/types";

import { PluginInternalPageView } from "./PluginInternalPageView";

let plugins: GlimpsePlugin[] = [];
let discoveryErrors: PluginDiscoveryError[] = [];
let pluginTrustStatuses: Record<string, PluginTrustStatus> = {};
let loadPluginsPromise: Promise<GlimpsePlugin[]> | null = null;

const PLUGIN_STATE_STORAGE_KEY = "glimpse:plugins:enabled";
const PLUGIN_STATE_CHANGED_EVENT = "glimpse:plugins-changed";

type PluginEnabledState = Record<string, boolean>;

const getStoredEnabledState = (): PluginEnabledState => {
  if (typeof window === "undefined") {
    return {};
  }

  const rawState = window.localStorage.getItem(PLUGIN_STATE_STORAGE_KEY);

  if (!rawState) {
    return {};
  }

  try {
    return JSON.parse(rawState) as PluginEnabledState;
  } catch {
    return {};
  }
};

const saveEnabledState = (state: PluginEnabledState) => {
  window.localStorage.setItem(
    PLUGIN_STATE_STORAGE_KEY,
    JSON.stringify(state),
  );
};

export const isPluginEnabled = (plugin: GlimpsePlugin): boolean => {
  const state = getStoredEnabledState();

  return isPluginTrusted(plugin) && (state[plugin.id] ?? plugin.enabledByDefault ?? true);
};

export const isPluginTrusted = (plugin: GlimpsePlugin): boolean =>
  pluginTrustStatuses[plugin.id]?.trusted ?? false;

export const getPluginTrustStatus = (
  pluginId: string,
): PluginTrustStatus | undefined => pluginTrustStatuses[pluginId];

export const getPlugins = (): PluginRegistryItem[] =>
  plugins.map((plugin) => ({
    ...localizePlugin(plugin),
    enabled: isPluginEnabled(plugin),
    trusted: isPluginTrusted(plugin),
    trustStatus: getPluginTrustStatus(plugin.id),
  }));

export const getPluginDiscoveryErrors = (): PluginDiscoveryError[] =>
  discoveryErrors;

export const loadPlugins = async (): Promise<GlimpsePlugin[]> => {
  loadPluginsPromise ??= pluginsApi
    .getDiscoveryReport()
    .then(async (report) => {
      plugins = report.manifests;
      discoveryErrors = report.errors;
      pluginTrustStatuses = await loadPluginTrustStatuses(report.manifests);
      await syncPluginRuntimes(getPlugins());
      dispatchPluginStateChanged();

      return report.manifests;
    })
    .finally(() => {
      loadPluginsPromise = null;
    });

  return loadPluginsPromise;
};

export const setPluginEnabled = (
  pluginId: string,
  enabled: boolean,
) => {
  const state = getStoredEnabledState();
  const plugin = plugins.find((candidate) => candidate.id === pluginId);

  state[pluginId] = Boolean(enabled && plugin && isPluginTrusted(plugin));
  saveEnabledState(state);

  void syncPluginRuntimes(getPlugins()).finally(() => {
    dispatchPluginStateChanged();
  });
};

export const setPluginTrusted = async (
  pluginId: string,
  trusted: boolean,
) => {
  const status = await pluginsApi.setTrust(pluginId, trusted);
  pluginTrustStatuses = {
    ...pluginTrustStatuses,
    [pluginId]: status,
  };

  if (!status.trusted) {
    const state = getStoredEnabledState();
    state[pluginId] = false;
    saveEnabledState(state);
  }

  await syncPluginRuntimes(getPlugins());
  dispatchPluginStateChanged();

  return status;
};

export const installPluginFromPath = async (
  sourcePath: string,
  replace = false,
) => {
  const result = await pluginsApi.installFromPath(sourcePath, replace);
  await reloadPlugins();

  return result;
};

export const uninstallPlugin = async (pluginId: string) => {
  await deactivatePluginRuntime(pluginId);

  const result = await pluginsApi.uninstall(pluginId);
  const state = getStoredEnabledState();
  state[pluginId] = false;
  saveEnabledState(state);

  pluginTrustStatuses = { ...pluginTrustStatuses };
  delete pluginTrustStatuses[pluginId];

  await reloadPlugins();

  return result;
};

export const reloadPlugin = async (pluginId: string) => {
  const plugin = plugins.find((candidate) => candidate.id === pluginId);

  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  if (!isPluginTrusted(plugin)) {
    throw new Error(`Plugin is not trusted: ${pluginId}`);
  }

  await reloadPluginRuntime(plugin);
  dispatchPluginStateChanged();
};

export const reloadPlugins = async (): Promise<GlimpsePlugin[]> => {
  loadPluginsPromise = null;
  const report = await pluginsApi.getDiscoveryReport();
  plugins = report.manifests;
  discoveryErrors = report.errors;
  pluginTrustStatuses = await loadPluginTrustStatuses(report.manifests);
  await syncPluginRuntimes(getPlugins());
  await Promise.allSettled(
    getPlugins().map((plugin) =>
      plugin.enabled ? reloadPluginRuntime(plugin) : Promise.resolve(),
    ),
  );
  dispatchPluginStateChanged();

  return plugins;
};

const loadPluginTrustStatuses = async (
  manifests: GlimpsePlugin[],
): Promise<Record<string, PluginTrustStatus>> => {
  const entries = await Promise.allSettled(
    manifests.map(async (plugin) => [
      plugin.id,
      await pluginsApi.getTrustStatus(plugin.id),
    ] as const),
  );

  return Object.fromEntries(
    entries.flatMap((entry) =>
      entry.status === "fulfilled" ? [entry.value] : [],
    ),
  );
};

export const subscribeToPluginChanges = (
  listener: () => void,
) => {
  window.addEventListener(PLUGIN_STATE_CHANGED_EVENT, listener);
  const unsubscribeRuntime = subscribeToPluginRuntimeChanges(listener);

  return () => {
    window.removeEventListener(PLUGIN_STATE_CHANGED_EVENT, listener);
    unsubscribeRuntime();
  };
};

export const setPluginLocale = (locale: string) => {
  if (setCurrentPluginLocale(locale)) {
    dispatchPluginStateChanged();
  }
};

const dispatchPluginStateChanged = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(PLUGIN_STATE_CHANGED_EVENT));
};

const getEnabledPlugins = (): GlimpsePlugin[] =>
  plugins.filter((plugin) => isPluginTrusted(plugin) && isPluginEnabled(plugin));

const toInternalPageContribution = (
  plugin: GlimpsePlugin,
  page: PluginInternalPageManifest,
): InternalPageContribution => {
  const localizedPlugin = localizePlugin(plugin);
  const localizedPage = localizeInternalPage(plugin, page);

  return {
    ...localizedPage,
    pluginId: plugin.id,
    render: () => createElement(PluginInternalPageView, {
      page: localizedPage,
      plugin: localizedPlugin,
      pluginId: plugin.id,
    }),
  };
};

export const getInternalPageContributions = (): InternalPageContribution[] =>
  getEnabledPlugins().flatMap((plugin) =>
    (plugin.internalPages ?? []).map((page) =>
      toInternalPageContribution(plugin, page),
    ),
  );

export const getInternalPageContribution = (
  page: string,
): InternalPageContribution | undefined =>
  getInternalPageContributions().find(
    (contribution) => contribution.id === page,
  );

export const isPluginInternalPage = (
  page: string,
): page is PluginInternalPage => page.startsWith("plugin:");

const toPluginInternalItem = (
  contribution: InternalPageContribution,
): IndexItem => ({
  id: `internal://${contribution.id}`,
  title: contribution.title,
  sourcePath: null,
  updatedAt: new Date(0).toISOString(),
  metadata: {
    tags: contribution.tags ?? ["internal", "plugin"],
    aliases: contribution.aliases ?? [],
    star: false,
    boost: contribution.boost ?? 1,
  },
  preview: {
    type: "internal",
    page: contribution.id,
  },
});

export const getPluginInternalItems = (): IndexItem[] =>
  getInternalPageContributions().map(toPluginInternalItem);

export const getPluginInternalItem = (
  page: PluginInternalPage,
): IndexItem | undefined =>
  getInternalPageContributions()
    .filter((contribution) => contribution.id === page)
    .map(toPluginInternalItem)[0];

export const getPluginPlaygroundInternalItems = (): IndexItem[] =>
  getInternalPageContributions()
    .filter((contribution) => contribution.pageAction)
    .map(toPluginInternalItem);

export const getPluginActionItems = (): IndexItem[] =>
  getEnabledPlugins().flatMap((plugin) =>
    (plugin.contributes?.actions ?? []).map((action) => {
      const localizedPlugin = localizePlugin(plugin);
      const localizedAction = localizeAction(plugin, action);

      return {
        id: `plugin-action://${plugin.id}/${action.id}`,
        title: localizedAction.title,
        sourcePath: null,
        updatedAt: new Date(0).toISOString(),
        metadata: {
          tags: ["plugin", "action", "command", plugin.id],
          aliases: [
            localizedPlugin.name,
            plugin.id,
            action.id,
            ...(localizedAction.aliases ?? []),
          ],
          star: false,
          boost: 1,
        },
        preview: {
          type: "markdown" as const,
          content: createPluginActionPreview(localizedPlugin, localizedAction),
        },
        open: {
          type: "pluginAction" as const,
          pluginId: plugin.id,
          actionId: action.id,
        },
      };
    }),
  );

export const getPluginViewerContribution = (
  pluginId: string,
  viewerId: string,
):
  | {
      plugin: GlimpsePlugin;
      viewer: PluginViewerManifest;
    }
  | undefined => {
  const plugin = getEnabledPlugins().find(
    (candidate) => candidate.id === pluginId,
  );

  if (!plugin) {
    return undefined;
  }

  const viewer = plugin.contributes?.viewers?.find(
    (candidate) => candidate.id === viewerId,
  );

  if (!viewer) {
    return undefined;
  }

  return {
    plugin,
    viewer: localizeViewer(plugin, viewer),
  };
};

export const getPluginViewerContributionForSourcePath = (
  sourcePath?: string | null,
):
  | {
      plugin: GlimpsePlugin;
      viewer: PluginViewerManifest;
    }
  | undefined => {
  const extension = getSourcePathExtension(sourcePath);

  if (!extension) {
    return undefined;
  }

  for (const plugin of getEnabledPlugins()) {
    const viewer = plugin.contributes?.viewers?.find((candidate) =>
      candidate.extensions?.some(
        (candidateExtension) =>
          normalizeExtension(candidateExtension) === extension,
      ),
    );

    if (viewer) {
      return {
        plugin,
        viewer: localizeViewer(plugin, viewer),
      };
    }
  }

  return undefined;
};

export const executePluginAction = async ({
  pluginId,
  actionId,
  input,
}: {
  pluginId: string;
  actionId: string;
  input?: unknown;
}): Promise<unknown> => {
  const plugin = plugins.find((candidate) => candidate.id === pluginId);

  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  if (!isPluginEnabled(plugin)) {
    throw new Error(`Plugin is disabled: ${pluginId}`);
  }

  if (!isPluginTrusted(plugin)) {
    throw new Error(`Plugin is not trusted: ${pluginId}`);
  }

  const runtime =
    getPluginRuntime(pluginId) ?? (await activatePluginRuntime(plugin));

  return invokePluginAction(runtime.actions, actionId, input);
};

const createPluginActionPreview = (
  plugin: GlimpsePlugin,
  action: PluginActionManifest,
) => [
  `# ${action.title}`,
  "",
  action.description ?? `Plugin action from ${plugin.name}.`,
  "",
  "```text",
  `: ${action.id} > input`,
  "```",
  "",
  `Plugin: \`${plugin.id}\``,
  `Action: \`${action.id}\``,
].join("\n");

const getSourcePathExtension = (sourcePath?: string | null): string | null => {
  if (!sourcePath) {
    return null;
  }

  const fileName = sourcePath.split(/[\\/]/).pop() ?? "";
  const lastDotIndex = fileName.lastIndexOf(".");

  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return null;
  }

  return normalizeExtension(fileName.slice(lastDotIndex + 1));
};

const normalizeExtension = (extension: string): string =>
  extension.trim().replace(/^\./, "").toLowerCase();
