import {
  isRegistryEntryApiSupported,
  OFFICIAL_PLUGIN_REGISTRY_URL,
} from "./registry";
import type { PluginRegistryEntry, PluginRegistryItem } from "@/types";

export type RemotePluginInstallState = "downloading" | "installing" | "failed";
export type RemotePluginInstallKind =
  | "not-installed"
  | "installed"
  | "update-available"
  | "unsupported";
export type RemotePluginManagementState =
  | "enabling"
  | "disabling"
  | "uninstalling";

export type RemotePluginView = {
  entry: PluginRegistryEntry;
  installedPlugin?: PluginRegistryItem;
  conflictingInstalledPlugin?: PluginRegistryItem;
  installKind: RemotePluginInstallKind;
};

export const remotePluginMatchesSearch = (
  plugin: PluginRegistryEntry,
  normalizedQuery: string,
) =>
  [
    plugin.name,
    plugin.id,
    plugin.version,
    `v${plugin.version}`,
    plugin.description ?? "",
    plugin.author ?? "",
    plugin.category ?? "",
    plugin.releaseDate ?? "",
    plugin.readmeUrl ?? "",
    plugin.sourceUrl ?? "",
    plugin.repositoryUrl ?? "",
    plugin.homepageUrl ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);

const compareVersionTriplets = (left: string, right: string): number => {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));

  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }

  return 0;
};

export const getRemotePluginInstallKind = (
  entry: PluginRegistryEntry,
  installedPlugin: PluginRegistryItem | undefined,
): RemotePluginInstallKind => {
  if (!isRegistryEntryApiSupported(entry)) return "unsupported";
  if (!installedPlugin) return "not-installed";

  return compareVersionTriplets(entry.version, installedPlugin.version) > 0
    ? "update-available"
    : "installed";
};

const sha256DigestPattern = /^[a-f0-9]{64}$/i;

const isRemoteManagedInstalledPlugin = (
  entry: PluginRegistryEntry,
  installedPlugin: PluginRegistryItem,
) => {
  const provenance = installedPlugin.trustStatus?.provenance;

  if (
    !provenance ||
    provenance.installSource !== "remote" ||
    provenance.registryUrl !== OFFICIAL_PLUGIN_REGISTRY_URL
  ) {
    return false;
  }

  const registrySha256 = provenance.registrySha256?.toLowerCase();
  const installedPackageSha256 =
    provenance.installedPackageSha256?.toLowerCase();

  if (
    !registrySha256 ||
    !installedPackageSha256 ||
    !sha256DigestPattern.test(registrySha256) ||
    registrySha256 !== installedPackageSha256 ||
    !isOfficialPluginDownloadUrlForVersion(
      provenance.downloadUrl,
      entry.id,
      installedPlugin.version,
    )
  ) {
    return false;
  }

  return installedPlugin.version !== entry.version
    ? true
    : provenance.downloadUrl === entry.downloadUrl &&
        registrySha256 === entry.sha256.toLowerCase();
};

const isOfficialPluginDownloadUrlForVersion = (
  downloadUrl: string | null | undefined,
  pluginId: string,
  version: string,
) => {
  if (!downloadUrl) return false;

  try {
    const url = new URL(downloadUrl);
    if (!isGitHubUrl(url)) return false;

    const [owner, repo, releases, download, tag, fileName] = url.pathname
      .split("/")
      .filter(Boolean);

    return (
      owner === "getglimpse" &&
      repo === "plugins" &&
      releases === "releases" &&
      download === "download" &&
      tag === `${pluginId}-v${version}` &&
      fileName === `${pluginId}-${version}.glimpse-plugin.zip`
    );
  } catch {
    return false;
  }
};

export const createRemotePluginViews = (
  entries: PluginRegistryEntry[],
  installedPlugins: PluginRegistryItem[],
): RemotePluginView[] => {
  const installedPluginsById = new Map(
    installedPlugins.map((plugin) => [plugin.id, plugin]),
  );

  return entries.map((entry) => {
    const installedPlugin = installedPluginsById.get(entry.id);
    const remoteManagedInstalledPlugin =
      installedPlugin && isRemoteManagedInstalledPlugin(entry, installedPlugin)
        ? installedPlugin
        : undefined;

    return {
      entry,
      installedPlugin: remoteManagedInstalledPlugin,
      conflictingInstalledPlugin:
        installedPlugin && !remoteManagedInstalledPlugin
          ? installedPlugin
          : undefined,
      installKind: getRemotePluginInstallKind(entry, installedPlugin),
    };
  });
};

export const getRemotePluginReadmeUrl = (entry: PluginRegistryEntry) =>
  entry.readmeUrl ??
  getRemotePluginReadmeUrlFromRepositoryUrl(entry.repositoryUrl, entry.id);

const getRemotePluginReadmeUrlFromRepositoryUrl = (
  repositoryUrl: string | undefined,
  pluginId: string,
) => {
  if (!repositoryUrl) return undefined;

  try {
    const url = new URL(repositoryUrl);
    const [owner, repo] = getGitHubRepositoryPath(url);

    return owner === "getglimpse" && repo === "plugins"
      ? `https://raw.githubusercontent.com/getglimpse/plugins/main/${pluginId}/README.md`
      : undefined;
  } catch {
    return undefined;
  }
};

const getGitHubRepositoryPath = (url: URL) =>
  isGitHubUrl(url) ? url.pathname.split("/").filter(Boolean) : [];

const isGitHubUrl = (url: URL) => {
  const host = url.hostname.toLowerCase();

  return (
    url.protocol === "https:" &&
    (host === "github.com" || host === "www.github.com")
  );
};

export const formatRemoteDownloadCount = (
  downloadCount: number,
  locale: string,
) =>
  new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(downloadCount);

export const formatRemoteRelativeDate = (date: string, locale: string) => {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return date;

  const diffInSeconds = Math.round((timestamp - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  for (const [unit, seconds] of units) {
    if (Math.abs(diffInSeconds) >= seconds || unit === "minute") {
      return formatter.format(Math.round(diffInSeconds / seconds), unit);
    }
  }

  return formatter.format(0, "minute");
};

export const resolvePluginReadmeLink = (
  href: string | undefined,
  baseUrl: string | undefined,
) => {
  if (!href) return null;

  try {
    const url = baseUrl ? new URL(href, baseUrl) : new URL(href);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};
