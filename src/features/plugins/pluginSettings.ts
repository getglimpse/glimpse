import { settingsApi } from "@/api/settings";
import type { AppSettings, PluginSettings } from "@/types";

export const readPluginCopySuccessfulSearchResultEnabled = async (
  pluginId: string,
  action: string,
): Promise<boolean> => {
  const settings = await settingsApi.get();

  return (
    getPluginCopySuccessfulSearchResults(settings, pluginId)[action] === true
  );
};

export const writePluginCopySuccessfulSearchResultEnabled = async (
  pluginId: string,
  action: string,
  enabled: boolean,
) => {
  const settings = await settingsApi.get();
  const actionSettings = {
    ...getPluginCopySuccessfulSearchResults(settings, pluginId),
  };

  if (enabled) {
    actionSettings[action] = true;
  } else {
    delete actionSettings[action];
  }

  const nextPluginSettings = {
    ...(settings.plugins[pluginId] ?? {}),
  };

  if (Object.keys(actionSettings).length > 0) {
    nextPluginSettings.copySuccessfulSearchResults = actionSettings;
  } else {
    delete nextPluginSettings.copySuccessfulSearchResults;
  }

  const nextPlugins = {
    ...settings.plugins,
    [pluginId]: nextPluginSettings,
  };

  if (!hasPluginSettings(nextPluginSettings)) {
    delete nextPlugins[pluginId];
  }

  await settingsApi.set({
    plugins: nextPlugins,
  });
};

const getPluginCopySuccessfulSearchResults = (
  settings: AppSettings,
  pluginId: string,
): Record<string, boolean> =>
  settings.plugins[pluginId]?.copySuccessfulSearchResults ?? {};

const hasPluginSettings = (pluginSettings: PluginSettings): boolean =>
  pluginSettings.trust != null ||
  Object.keys(pluginSettings.copySuccessfulSearchResults ?? {}).length > 0;
