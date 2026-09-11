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

export type PluginPageDefinition = {
  id: PluginInternalPage;
  tabs: PluginPageTab[];
};

export type PluginPageTab =
  | PluginPlaygroundTab
  | PluginConverterTab
  | PluginFormTab;

export type PluginPageTabBase = {
  id: string;
  title?: string;
  titleKey?: string;
  titleFallback?: string;
};

export type PluginPlaygroundTab = PluginPageTabBase & {
  type: "playground";
  action: string;
  inputPlaceholder?: string;
  inputPlaceholderKey?: string;
  inputPlaceholderFallback?: string;
  examples?: string[];
  submitLabel?: string;
};

export type PluginConverterTab = PluginPageTabBase & {
  type: "converter";
  action: string;
  accept?: string | string[];
  multiple?: boolean;
  maxBytes?: number;
  maxFiles?: number;
  outputDirectorySetting?: string;
  description?: string;
  descriptionKey?: string;
  descriptionFallback?: string;
  chooseFileLabel?: string;
  chooseFileLabelKey?: string;
  chooseFileLabelFallback?: string;
  emptyLabel?: string;
  emptyLabelKey?: string;
  emptyLabelFallback?: string;
  convertingLabel?: string;
  convertingLabelKey?: string;
  convertingLabelFallback?: string;
  resultsLabel?: string;
  resultsLabelKey?: string;
  resultsLabelFallback?: string;
  revealLabel?: string;
  revealLabelKey?: string;
  revealLabelFallback?: string;
  clearLabel?: string;
  clearLabelKey?: string;
  clearLabelFallback?: string;
  fileColumnLabel?: string;
  fileColumnLabelKey?: string;
  fileColumnLabelFallback?: string;
  sizeColumnLabel?: string;
  sizeColumnLabelKey?: string;
  sizeColumnLabelFallback?: string;
  pathColumnLabel?: string;
  pathColumnLabelKey?: string;
  pathColumnLabelFallback?: string;
  emptyResultsLabel?: string;
  emptyResultsLabelKey?: string;
  emptyResultsLabelFallback?: string;
};

export type PluginFormTab = PluginPageTabBase & {
  type: "form";
  action: string;
  submitLabel?: string;
  submitLabelKey?: string;
  submitLabelFallback?: string;
  fields?: PluginFormField[];
  result?: Record<string, unknown>;
};

export type PluginFormField = {
  id: string;
  type?: "string" | "number" | "boolean" | "enum";
  label?: string;
  labelKey?: string;
  labelFallback?: string;
  description?: string;
  descriptionKey?: string;
  descriptionFallback?: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  control?: "text" | "number" | "slider" | "checkbox" | "select" | "segmented";
  options?: PluginFormFieldOption[];
};

export type PluginFormFieldOption = {
  value: string | number | boolean;
  label?: string;
  labelKey?: string;
  labelFallback?: string;
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

export type PluginReadmeSource = {
  pluginId: string;
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
  provenance?: PluginInstallProvenance | null;
};

export type PluginInstallProvenance = {
  installSource: "local" | "remote";
  registryUrl?: string | null;
  downloadUrl?: string | null;
  registrySha256?: string | null;
  installedPackageSha256?: string | null;
  installedAt?: string | null;
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
  titleKey?: string;
  titleFallback?: string;
  tags?: string[];
  aliases?: string[];
  boost?: number;
  pageAction?: PluginPageActionManifest;
  help?: PluginPageHelpContent;
  staticPage?: PluginStaticPageContent;
  pageDefinition?: PluginPageDefinition;
};

export type PluginActionManifest = {
  id: string;
  title: string;
  titleKey?: string;
  titleFallback?: string;
  description?: string;
  descriptionKey?: string;
  descriptionFallback?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  aliases?: string[];
};

export type PluginViewerManifest = {
  id: string;
  title: string;
  titleKey?: string;
  titleFallback?: string;
  description?: string;
  descriptionKey?: string;
  descriptionFallback?: string;
  extensions?: string[];
};

export type PluginContributions = {
  internalPage?: PluginInternalPageManifest;
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
export type PluginFileWriteScope =
  | "none"
  | "declared-output-directory"
  | "target-group";

export type PluginCapabilities = {
  files?: {
    read?: PluginFileReadScope;
    write?: PluginFileWriteScope;
  };
};

export type PluginRegistry = {
  schemaVersion: 1;
  plugins: PluginRegistryEntry[];
};

export type PluginRegistryEntry = {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  downloadUrl: string;
  sha256: string;
  /** Derived from repositoryUrl during registry validation. Raw registry author metadata is ignored. */
  author?: string;
  category?: string;
  description?: string;
  downloadCount?: number;
  releaseDate?: string;
  fileName?: string;
  readmeUrl?: string;
  sourceUrl?: string;
  repositoryUrl?: string;
  homepageUrl?: string;
  supportUrl?: string;
};

export type RemotePluginInstallResult = PluginInstallResult & {
  source: "remote";
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
  author?: string;
  releaseDate?: string;
  repositoryUrl?: string;
  homepageUrl?: string;
  supportUrl?: string;
  description?: string;
  defaultLocale?: string;
  i18n?: PluginI18nManifest;
  i18nPath?: string;
  page?: string;
  pageDefinition?: PluginPageDefinition;
  enabledByDefault?: boolean;
  entrypoints?: PluginEntrypoints;
  contributes?: PluginContributions;
  dependencies?: PluginDependencies;
  capabilities?: PluginCapabilities;
  settings?: Record<string, unknown>;
  internalPages?: PluginInternalPageManifest[];
  warnings?: string[];
};

export type PluginRegistryItem = GlimpsePlugin & {
  enabled: boolean;
  trusted: boolean;
  trustStatus?: PluginTrustStatus;
};
