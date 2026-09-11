import { invoke } from "@tauri-apps/api/core";

import type {
  PluginAssetSource,
  GlimpsePlugin,
  PluginDiscoveryReport,
  PluginEntrypointSource,
  PluginInstallResult,
  PluginReadmeSource,
  RemotePluginInstallResult,
  PluginTrustStatus,
  PluginUninstallResult,
} from "@/types";

export const pluginsApi = {
  getManifests: () => invoke<GlimpsePlugin[]>("get_plugin_manifests"),
  getDiscoveryReport: () =>
    invoke<PluginDiscoveryReport>("get_plugin_discovery_report"),
  openFolder: () => invoke<void>("open_plugins_folder"),
  installFromPath: (sourcePath: string, replace = false) =>
    invoke<PluginInstallResult>("install_plugin_from_path", {
      sourcePath,
      replace,
    }),
  installFromArchive: (archivePath: string, replace = false) =>
    invoke<PluginInstallResult>("install_plugin_from_archive", {
      archivePath,
      replace,
    }),
  installFromUrl: (
    downloadUrl: string,
    sha256: string,
    replace = false,
    registryUrl?: string,
  ) =>
    invoke<PluginInstallResult>("install_plugin_from_url", {
      downloadUrl,
      sha256,
      registryUrl,
      replace,
    }).then(
      (result): RemotePluginInstallResult => ({
        ...result,
        source: "remote",
      }),
    ),
  uninstall: (pluginId: string) =>
    invoke<PluginUninstallResult>("uninstall_plugin", {
      pluginId,
    }),
  getTrustStatus: (pluginId: string) =>
    invoke<PluginTrustStatus>("get_plugin_trust_status", {
      pluginId,
    }),
  setTrust: (pluginId: string, trusted: boolean) =>
    invoke<PluginTrustStatus>("set_plugin_trust", {
      pluginId,
      trusted,
    }),
  getEntrypointSource: (pluginId: string, entrypoint: "main" | "page") =>
    invoke<PluginEntrypointSource>("get_plugin_entrypoint_source", {
      pluginId,
      entrypoint,
    }),
  getAssetSource: (pluginId: string, asset: "styles") =>
    invoke<PluginAssetSource>("get_plugin_asset_source", {
      pluginId,
      asset,
    }),
  getReadmeSource: (pluginId: string) =>
    invoke<PluginReadmeSource>("get_plugin_readme_source", {
      pluginId,
    }),
};
