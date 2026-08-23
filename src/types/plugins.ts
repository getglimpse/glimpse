import type { ReactNode } from "react";

import type { PluginInternalPage } from "./item";

export type PluginStaticPageRow = {
  label: string;
  value: string;
};

export type PluginStaticPageSection = {
  title: string;
  rows?: PluginStaticPageRow[];
  paragraphs?: string[];
};

export type PluginStaticPageContent = {
  subtitle?: string;
  sections?: PluginStaticPageSection[];
};

export type PluginPageHelpCommand = {
  command: string;
  description: string;
};

export type PluginPageHelpContent = {
  description?: string;
  examples?: string[];
  commands?: PluginPageHelpCommand[];
};

export type PluginPageActionManifest = {
  actionId: string;
  inputPlaceholder?: string;
  examples?: string[];
};

export type PluginI18nDictionary = Record<string, unknown>;

export type PluginI18nManifest =
  | Record<string, PluginI18nDictionary>
  | {
      defaultLocale?: string;
      translations?: Record<string, PluginI18nDictionary>;
    };

export type PluginDiscoveryReport = {
  manifests: GlimpsePlugin[];
  errors: PluginDiscoveryError[];
};

export type PluginDiscoveryError = {
  path: string;
  error: string;
};

export type PluginEntrypoints = {
  main?: string;
  page?: string;
};

export type PluginEntrypointSource = {
  pluginId: string;
  entrypoint: "main" | "page" | string;
  path: string;
  source: string;
};

export type PluginAssetSource = {
  pluginId: string;
  asset: "styles" | string;
  path: string;
  source: string;
};

export type PluginTrustStatus = {
  pluginId: string;
  trusted: boolean;
  trustRequired: boolean;
  reason?: string | null;
  trustedAt?: string | null;
  manifestFingerprint: string;
  trustedFingerprint?: string | null;
  version: string;
  trustedVersion?: string | null;
};

export type PluginInstallResult = {
  pluginId: string;
  installedPath: string;
  replaced: boolean;
  manifest: GlimpsePlugin;
};

export type PluginUninstallResult = {
  pluginId: string;
  removedPath: string;
  removed: boolean;
};

export type PluginInternalPageManifest = {
  id: PluginInternalPage;
  title: string;
  tags?: string[];
  aliases?: string[];
  boost?: number;
  pageAction?: PluginPageActionManifest;
  help?: PluginPageHelpContent;
  staticPage?: PluginStaticPageContent;
};

export type PluginActionManifest = {
  id: string;
  title: string;
  description?: string;
  aliases?: string[];
};

export type PluginViewerManifest = {
  id: string;
  title: string;
  description?: string;
  extensions?: string[];
};

export type PluginContributions = {
  internalPages?: PluginInternalPageManifest[];
  actions?: PluginActionManifest[];
  viewers?: PluginViewerManifest[];
};

export type PluginDependencyManifest = {
  id: string;
  version?: string;
  optional?: boolean;
};

export type PluginDependencies = {
  plugins?: PluginDependencyManifest[];
  npm?: string[];
};

export type PluginFileReadScope = "none" | "active-tab" | "target-group";

export type PluginCapabilities = {
  files?: {
    read?: PluginFileReadScope;
  };
};

export type InternalPageContribution = PluginInternalPageManifest & {
  pluginId: string;
  render: () => ReactNode;
};

export type GlimpsePlugin = {
  id: string;
  name: string;
  version: string;
  apiVersion?: string;
  description?: string;
  i18n?: PluginI18nManifest;
  enabledByDefault?: boolean;
  entrypoints?: PluginEntrypoints;
  contributes?: PluginContributions;
  dependencies?: PluginDependencies;
  capabilities?: PluginCapabilities;
  internalPages?: PluginInternalPageManifest[];
  warnings?: string[];
};

export type PluginRegistryItem = GlimpsePlugin & {
  enabled: boolean;
  trusted: boolean;
  trustStatus?: PluginTrustStatus;
};
