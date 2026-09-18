import { useCallback, useEffect, useState } from "react";

import type { TranslationFunctions } from "@/i18n/i18n-types";
import type { PluginRegistryEntry, PluginRegistryItem } from "@/types";

import {
  getRemotePluginInstallErrorMessage,
  OFFICIAL_PLUGIN_REGISTRY_URL,
  validatePluginRegistry,
} from "./remotePluginRegistry";
import {
  getPluginDiscoveryErrors,
  getPlugins,
  installPluginFromUrl,
  loadPlugins,
  setPluginEnabled,
  setPluginTrusted,
  subscribeToPluginChanges,
  uninstallPlugin,
} from "./pluginRegistry";
import {
  getRemotePluginInstallKind,
  type RemotePluginInstallState,
  type RemotePluginManagementState,
} from "./remotePluginViewModel";

export const useRemotePluginCatalog = (LL: TranslationFunctions) => {
  const [plugins, setPlugins] = useState<PluginRegistryItem[]>(() =>
    getPlugins(),
  );
  const [discoveryErrors, setDiscoveryErrors] = useState(() =>
    getPluginDiscoveryErrors(),
  );
  const [remotePlugins, setRemotePlugins] = useState<PluginRegistryEntry[]>([]);
  const [remoteRegistryLoading, setRemoteRegistryLoading] = useState(false);
  const [remoteRegistryError, setRemoteRegistryError] = useState<string | null>(
    null,
  );
  const [remoteInstallStates, setRemoteInstallStates] = useState<
    Partial<Record<string, RemotePluginInstallState>>
  >({});
  const [remoteInstallErrors, setRemoteInstallErrors] = useState<
    Partial<Record<string, string>>
  >({});
  const [remoteManagementStates, setRemoteManagementStates] = useState<
    Partial<Record<string, RemotePluginManagementState>>
  >({});
  const [remoteManagementMessage, setRemoteManagementMessage] = useState<
    string | null
  >(null);

  const refreshInstalledPlugins = useCallback(() => {
    setPlugins(getPlugins());
    setDiscoveryErrors(getPluginDiscoveryErrors());
  }, []);

  const loadRemoteRegistry = useCallback(async () => {
    setRemoteRegistryLoading(true);
    setRemoteRegistryError(null);

    try {
      const response = await fetch(OFFICIAL_PLUGIN_REGISTRY_URL, {
        cache: "no-store",
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = validatePluginRegistry(await response.json());
      if (!result.ok) throw new Error(result.errors.join("\n"));

      setRemotePlugins(result.registry.plugins);
    } catch (error) {
      setRemotePlugins([]);
      setRemoteRegistryError(String(error));
    } finally {
      setRemoteRegistryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlugins()
      .then(refreshInstalledPlugins)
      .catch((error) => {
        console.warn("Failed to load installed plugins for store:", error);
      });

    return subscribeToPluginChanges(refreshInstalledPlugins);
  }, [refreshInstalledPlugins]);

  useEffect(() => {
    void loadRemoteRegistry();
  }, [loadRemoteRegistry]);

  const installRemotePlugin = useCallback(
    (entry: PluginRegistryEntry) => {
      const installedPlugin = plugins.find((plugin) => plugin.id === entry.id);
      const installKind = getRemotePluginInstallKind(entry, installedPlugin);

      if (installKind === "installed" || installKind === "unsupported") return;

      setRemoteInstallStates((states) => ({
        ...states,
        [entry.id]: "downloading",
      }));
      setRemoteInstallErrors((errors) => {
        const nextErrors = { ...errors };
        delete nextErrors[entry.id];
        return nextErrors;
      });
      setRemoteManagementMessage(null);

      const installPhaseTimer = window.setTimeout(() => {
        setRemoteInstallStates((states) =>
          states[entry.id] === "downloading"
            ? { ...states, [entry.id]: "installing" }
            : states,
        );
      }, 400);

      void installPluginFromUrl(
        entry.downloadUrl,
        entry.sha256,
        installKind === "update-available",
        OFFICIAL_PLUGIN_REGISTRY_URL,
      )
        .then((result) => {
          refreshInstalledPlugins();
          setRemoteManagementMessage(
            LL.pluginPage.remote.installSuccess({ pluginId: result.pluginId }),
          );
        })
        .catch((error) => {
          const message = getRemotePluginInstallErrorMessage(error);
          setRemoteInstallErrors((errors) => ({
            ...errors,
            [entry.id]: message,
          }));
          setRemoteManagementMessage(
            LL.pluginPage.remote.installFailed({ error: message }),
          );
        })
        .finally(() => {
          window.clearTimeout(installPhaseTimer);
          setRemoteInstallStates((states) => {
            const nextStates = { ...states };
            delete nextStates[entry.id];
            return nextStates;
          });
        });
    },
    [LL, plugins, refreshInstalledPlugins],
  );

  const setRemotePluginEnabled = useCallback(
    (plugin: PluginRegistryItem, enabled: boolean) => {
      setRemoteManagementStates((states) => ({
        ...states,
        [plugin.id]: enabled ? "enabling" : "disabling",
      }));
      setRemoteManagementMessage(null);

      const updatePluginState = async () => {
        if (enabled && !plugin.trusted) await setPluginTrusted(plugin.id, true);
        setPluginEnabled(plugin.id, enabled);
      };

      void updatePluginState()
        .then(refreshInstalledPlugins)
        .catch((error) => {
          setRemoteManagementMessage(
            enabled
              ? LL.pluginPage.remote.enableFailed({ error: String(error) })
              : LL.pluginPage.remote.disableFailed({ error: String(error) }),
          );
        })
        .finally(() => {
          setRemoteManagementStates((states) => {
            const nextStates = { ...states };
            delete nextStates[plugin.id];
            return nextStates;
          });
        });
    },
    [LL, refreshInstalledPlugins],
  );

  const uninstallRemotePlugin = useCallback(
    (plugin: PluginRegistryItem) => {
      if (
        !window.confirm(
          LL.pluginPage.pluginRow.uninstallConfirm({ name: plugin.name }),
        )
      ) {
        return;
      }

      setRemoteManagementStates((states) => ({
        ...states,
        [plugin.id]: "uninstalling",
      }));
      setRemoteManagementMessage(null);

      void uninstallPlugin(plugin.id)
        .then(() => {
          refreshInstalledPlugins();
          setRemoteManagementMessage(
            LL.pluginPage.pluginRow.uninstallSuccess({ pluginId: plugin.id }),
          );
        })
        .catch((error) => {
          setRemoteManagementMessage(
            LL.pluginPage.remote.uninstallFailed({ error: String(error) }),
          );
        })
        .finally(() => {
          setRemoteManagementStates((states) => {
            const nextStates = { ...states };
            delete nextStates[plugin.id];
            return nextStates;
          });
        });
    },
    [LL, refreshInstalledPlugins],
  );

  return {
    plugins,
    discoveryErrors,
    remotePlugins,
    remoteRegistryLoading,
    remoteRegistryError,
    remoteInstallStates,
    remoteInstallErrors,
    remoteManagementStates,
    remoteManagementMessage,
    loadRemoteRegistry,
    installRemotePlugin,
    setRemotePluginEnabled,
    uninstallRemotePlugin,
  };
};
