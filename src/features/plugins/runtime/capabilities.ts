import { fileApi, type FileMetadata } from "@/api/file";
import { settingsApi } from "@/api/settings";
import type { GlimpsePlugin, PluginFileReadScope } from "@/types";
import type {
  PluginCapabilityContext,
  SandboxWorkerRequest,
} from "./sandboxProtocol";

export const createPluginCapabilityContext = async ({
  plugin,
  requestType,
  sourcePath,
  nextToken,
}: {
  plugin: GlimpsePlugin;
  requestType: SandboxWorkerRequest["type"];
  sourcePath?: string | null;
  nextToken: () => string;
}): Promise<PluginCapabilityContext | undefined> => {
  const readScope = getPluginFileReadScope(plugin);

  if (
    readScope === "none" ||
    requestType === "init" ||
    requestType === "deactivate"
  ) {
    return undefined;
  }

  const targetGroupSnapshot =
    readScope === "target-group"
      ? await getActiveTargetGroupSnapshot()
      : undefined;

  return {
    token: nextToken(),
    activeTabSourcePath: requestType === "renderViewer" ? sourcePath : null,
    targetGroupId: targetGroupSnapshot?.id ?? null,
    targetGroupPaths: targetGroupSnapshot?.paths ?? [],
  };
};

export const getActiveTargetGroupSnapshot = async (): Promise<
  { id: string; paths: string[] } | undefined
> => {
  try {
    const settings = await settingsApi.get();
    const currentGroup = settings.targetGroups.find(
      (group) => group.id === settings.currentTargetGroupId,
    );

    return currentGroup
      ? {
          id: currentGroup.id,
          paths: currentGroup.paths,
        }
      : undefined;
  } catch {
    return undefined;
  }
};

export const getPluginFileReadScope = (
  plugin: GlimpsePlugin,
): PluginFileReadScope => plugin.capabilities?.files?.read ?? "none";

export const assertPluginFileAccess = (
  plugin: GlimpsePlugin,
  requestedPath: string,
  context?: PluginCapabilityContext,
) => {
  const readScope = getPluginFileReadScope(plugin);

  if (!context) {
    throw new Error(`plugin file read is not available: ${plugin.id}`);
  }

  if (readScope === "none") {
    throw new Error(
      `plugin does not declare file read capability: ${plugin.id}`,
    );
  }

  if (
    readScope === "active-tab" &&
    pathsEqual(requestedPath, context.activeTabSourcePath)
  ) {
    return;
  }

  if (readScope === "target-group" && context.targetGroupId) {
    return;
  }

  throw new Error(
    `plugin file read denied by ${readScope} capability: ${plugin.id}`,
  );
};

export const readPluginTextFile = async (
  plugin: GlimpsePlugin,
  sourcePath: string,
  context?: PluginCapabilityContext,
): Promise<string> => {
  assertPluginFileAccess(plugin, sourcePath, context);

  if (getPluginFileReadScope(plugin) === "target-group") {
    return fileApi.readTextFileInTargetGroup(
      sourcePath,
      context?.targetGroupId ?? "",
    );
  }

  return fileApi.readTextFile(sourcePath);
};

export const readPluginBinaryFile = async (
  plugin: GlimpsePlugin,
  sourcePath: string,
  context?: PluginCapabilityContext,
): Promise<string> => {
  assertPluginFileAccess(plugin, sourcePath, context);

  if (getPluginFileReadScope(plugin) === "target-group") {
    return fileApi.readBinaryFileInTargetGroup(
      sourcePath,
      context?.targetGroupId ?? "",
    );
  }

  return fileApi.readBinaryFile(sourcePath);
};

export const readPluginFileMetadata = async (
  plugin: GlimpsePlugin,
  sourcePath: string,
  context?: PluginCapabilityContext,
): Promise<FileMetadata> => {
  assertPluginFileAccess(plugin, sourcePath, context);

  if (getPluginFileReadScope(plugin) === "target-group") {
    return fileApi.getFileMetadataInTargetGroup(
      sourcePath,
      context?.targetGroupId ?? "",
    );
  }

  return fileApi.getFileMetadata(sourcePath);
};

const pathsEqual = (left?: string | null, right?: string | null): boolean => {
  if (!left || !right) {
    return false;
  }

  return normalizePathForComparison(left) === normalizePathForComparison(right);
};

const normalizePathForComparison = (value: string): string => {
  let normalized = value
    .trim()
    .replace(/^\\\\\?\\/, "")
    .replace(/^\/\/\?\//, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");

  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
};
