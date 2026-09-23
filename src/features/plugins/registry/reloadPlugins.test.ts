// @vitest-environment jsdom

import { beforeEach, expect, it, vi } from "vitest";

import { reloadPlugins } from "./index";

const pluginMocks = vi.hoisted(() => ({
  getDiscoveryReport: vi.fn(),
  getTrustStatus: vi.fn(),
}));
const runtimeMocks = vi.hoisted(() => ({
  getPluginRuntime: vi.fn(),
  syncPluginRuntimes: vi.fn(async () => undefined),
  reloadPluginRuntime: vi.fn(async () => undefined),
  activatePluginRuntime: vi.fn(async () => undefined),
  deactivatePluginRuntime: vi.fn(async () => undefined),
  subscribeToPluginRuntimeChanges: vi.fn(() => () => undefined),
}));

vi.mock("@/api/plugins", () => ({ pluginsApi: pluginMocks }));
vi.mock("@/features/plugins/runtime", () => runtimeMocks);

beforeEach(() => {
  window.localStorage.clear();
  pluginMocks.getDiscoveryReport.mockReset();
  pluginMocks.getTrustStatus.mockReset();
  runtimeMocks.getPluginRuntime.mockReset();
  runtimeMocks.syncPluginRuntimes.mockClear();
  runtimeMocks.reloadPluginRuntime.mockClear();
});

it("starts a new plugin once and reloads a changed active plugin once", async () => {
  pluginMocks.getDiscoveryReport.mockResolvedValue({
    manifests: [{ id: "new-plugin", name: "New", version: "1.0.0" }],
    errors: [],
  });
  pluginMocks.getTrustStatus
    .mockResolvedValueOnce({
      pluginId: "new-plugin",
      trusted: true,
      manifestFingerprint: "first",
      version: "1.0.0",
    })
    .mockResolvedValueOnce({
      pluginId: "new-plugin",
      trusted: true,
      manifestFingerprint: "second",
      version: "1.0.0",
    });
  runtimeMocks.getPluginRuntime.mockReturnValue(undefined);

  await reloadPlugins();

  expect(runtimeMocks.syncPluginRuntimes).toHaveBeenCalledTimes(1);
  expect(runtimeMocks.syncPluginRuntimes).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ enabled: true })]),
  );
  expect(runtimeMocks.reloadPluginRuntime).not.toHaveBeenCalled();

  runtimeMocks.getPluginRuntime.mockReturnValue({});
  await reloadPlugins();
  expect(runtimeMocks.reloadPluginRuntime).toHaveBeenCalledTimes(1);
});

it("does not restart an active plugin when its fingerprint is unchanged", async () => {
  pluginMocks.getDiscoveryReport.mockResolvedValue({
    manifests: [{ id: "stable-plugin", name: "Stable", version: "1.0.0" }],
    errors: [],
  });
  pluginMocks.getTrustStatus.mockResolvedValue({
    pluginId: "stable-plugin",
    trusted: true,
    manifestFingerprint: "unchanged",
    version: "1.0.0",
  });
  runtimeMocks.getPluginRuntime.mockReturnValue({});

  await reloadPlugins();
  await reloadPlugins();

  expect(runtimeMocks.syncPluginRuntimes).toHaveBeenCalledTimes(2);
  expect(runtimeMocks.reloadPluginRuntime).not.toHaveBeenCalled();
});
