import type {
  GlimpsePlugin,
  PluginRegistry,
  PluginRegistryEntry,
} from "@/types";

export const OFFICIAL_PLUGIN_REGISTRY_URL =
  "https://raw.githubusercontent.com/getglimpse/plugins/main/registry.json";

const semverPattern = /^\d+\.\d+\.\d+$/;
const sha256Pattern = /^[a-f0-9]{64}$/i;
const pluginIdPattern = /^[a-z0-9][a-z0-9._-]*$/;
const supportedPluginApiVersion = "0.2.0";

export type PluginRegistryValidationResult =
  | {
      ok: true;
      registry: PluginRegistry;
      errors: [];
    }
  | {
      ok: false;
      registry?: undefined;
      errors: string[];
    };

export type PluginRegistryEntryInstallCheck =
  | {
      ok: true;
      errors: [];
    }
  | {
      ok: false;
      errors: string[];
    };

export const validatePluginRegistry = (
  value: unknown,
): PluginRegistryValidationResult => {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      errors: ["registry must be a JSON object"],
    };
  }

  if (value.schemaVersion !== 1) {
    errors.push("registry.schemaVersion must be 1");
  }

  const rawPlugins = value.plugins;

  if (!Array.isArray(rawPlugins)) {
    errors.push("registry.plugins must be an array");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const seenPluginIds = new Set<string>();
  const plugins: PluginRegistryEntry[] = [];
  const registryEntries = rawPlugins as unknown[];

  for (const [index, plugin] of registryEntries.entries()) {
    const entryErrors = validateRegistryEntry(plugin, `plugins[${index}]`);

    if (entryErrors.length > 0) {
      errors.push(...entryErrors);
      continue;
    }

    const entry = plugin as PluginRegistryEntry;

    if (seenPluginIds.has(entry.id)) {
      errors.push(`plugins[${index}].id is duplicated: ${entry.id}`);
      continue;
    }

    seenPluginIds.add(entry.id);
    plugins.push(normalizeRegistryEntry(entry));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    registry: {
      schemaVersion: 1,
      plugins,
    },
    errors: [],
  };
};

export const checkRegistryEntryMatchesManifest = (
  entry: PluginRegistryEntry,
  manifest: GlimpsePlugin,
): PluginRegistryEntryInstallCheck => {
  const errors: string[] = [];

  if (entry.id !== manifest.id) {
    errors.push(
      `registry id mismatch: expected ${entry.id}, got ${manifest.id}`,
    );
  }

  if (entry.version !== manifest.version) {
    errors.push(
      `registry version mismatch: expected ${entry.version}, got ${manifest.version}`,
    );
  }

  if (entry.apiVersion !== manifest.apiVersion) {
    errors.push(
      `registry apiVersion mismatch: expected ${entry.apiVersion}, got ${manifest.apiVersion ?? "missing"}`,
    );
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
};

export const isRegistryEntryApiSupported = (entry: PluginRegistryEntry) =>
  entry.apiVersion === supportedPluginApiVersion;

const validateRegistryEntry = (value: unknown, label: string): string[] => {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return [`${label} must be a JSON object`];
  }

  validateRequiredString(value, "id", label, errors);
  validateRequiredString(value, "name", label, errors);
  validateRequiredString(value, "version", label, errors);
  validateRequiredString(value, "apiVersion", label, errors);
  validateRequiredString(value, "downloadUrl", label, errors);
  validateRequiredString(value, "sha256", label, errors);

  if (typeof value.id === "string" && !pluginIdPattern.test(value.id)) {
    errors.push(`${label}.id must be a valid plugin id`);
  }

  if (typeof value.version === "string" && !semverPattern.test(value.version)) {
    errors.push(`${label}.version must be a semantic version triplet`);
  }

  if (
    typeof value.apiVersion === "string" &&
    !semverPattern.test(value.apiVersion)
  ) {
    errors.push(`${label}.apiVersion must be a semantic version triplet`);
  }

  if (typeof value.downloadUrl === "string") {
    validateHttpsUrl(value.downloadUrl, `${label}.downloadUrl`, errors);

    if (!value.downloadUrl.endsWith(".glimpse-plugin.zip")) {
      errors.push(`${label}.downloadUrl must point to a .glimpse-plugin.zip`);
    }
  }

  if (typeof value.sha256 === "string" && !sha256Pattern.test(value.sha256)) {
    errors.push(`${label}.sha256 must be a 64 character hex SHA-256 digest`);
  }

  validateOptionalString(value, "description", label, errors);
  validateOptionalString(value, "releaseDate", label, errors);
  validateOptionalString(value, "fileName", label, errors);
  validateOptionalHttpsUrl(value, "sourceUrl", label, errors);
  validateOptionalHttpsUrl(value, "repositoryUrl", label, errors);
  validateOptionalHttpsUrl(value, "homepageUrl", label, errors);
  validateOptionalHttpsUrl(value, "supportUrl", label, errors);

  if (
    typeof value.releaseDate === "string" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(value.releaseDate)
  ) {
    errors.push(`${label}.releaseDate must use YYYY-MM-DD format`);
  }

  if (
    typeof value.fileName === "string" &&
    !value.fileName.endsWith(".glimpse-plugin.zip")
  ) {
    errors.push(`${label}.fileName must end with .glimpse-plugin.zip`);
  }

  return errors;
};

const normalizeRegistryEntry = (
  entry: PluginRegistryEntry,
): PluginRegistryEntry => ({
  id: entry.id,
  name: entry.name.trim(),
  version: entry.version,
  apiVersion: entry.apiVersion,
  downloadUrl: entry.downloadUrl,
  sha256: entry.sha256.toLowerCase(),
  description: normalizeOptionalString(entry.description),
  releaseDate: normalizeOptionalString(entry.releaseDate),
  fileName: normalizeOptionalString(entry.fileName),
  sourceUrl: normalizeOptionalString(entry.sourceUrl),
  repositoryUrl: normalizeOptionalString(entry.repositoryUrl),
  homepageUrl: normalizeOptionalString(entry.homepageUrl),
  supportUrl: normalizeOptionalString(entry.supportUrl),
});

const validateRequiredString = (
  record: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
) => {
  if (typeof record[key] !== "string" || !record[key].trim()) {
    errors.push(`${label}.${key} is required`);
  }
};

const validateOptionalString = (
  record: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
) => {
  if (
    record[key] !== undefined &&
    (typeof record[key] !== "string" || !record[key].trim())
  ) {
    errors.push(`${label}.${key} must be a non-empty string when present`);
  }
};

const validateOptionalHttpsUrl = (
  record: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
) => {
  if (record[key] === undefined) {
    return;
  }

  if (typeof record[key] !== "string") {
    errors.push(`${label}.${key} must be a string when present`);
    return;
  }

  validateHttpsUrl(record[key], `${label}.${key}`, errors);
};

const validateHttpsUrl = (value: string, label: string, errors: string[]) => {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:") {
      errors.push(`${label} must use https`);
    }
  } catch {
    errors.push(`${label} must be a valid URL`);
  }
};

const normalizeOptionalString = (value: string | undefined) => {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
