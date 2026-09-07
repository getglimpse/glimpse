// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { GlimpsePlugin, PluginTrustStatus } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

const mockedInvoke = vi.mocked(invoke);

const trustedStatus = (
  pluginId: string,
  trusted: boolean,
): PluginTrustStatus => ({
  pluginId,
  trusted,
  trustRequired: true,
  reason: trusted ? null : "plugin has not been trusted yet",
  trustedAt: trusted ? "2026-07-27T00:00:00Z" : null,
  manifestFingerprint: `${pluginId}:fingerprint`,
  trustedFingerprint: trusted ? `${pluginId}:fingerprint` : null,
  version: "0.1.0",
  trustedVersion: trusted ? "0.1.0" : null,
});

const registryPlugin = (
  id: string,
  enabledByDefault = true,
): GlimpsePlugin => ({
  id,
  name: id,
  version: "0.1.0",
  apiVersion: "0.1.0",
  description: `${id} description`,
  enabledByDefault,
  i18n: {
    ja: {
      name: `${id} 日本語`,
      description: `${id} の説明`,
      [`pages.plugin:${id}.title`]: `${id} 日本語ページ`,
      "actions.echo.title": `${id} 日本語 echo`,
      "actions.echo.description": `${id} の echo action`,
      "actions.echo.aliases": ["日本語echo"],
    },
  },
  contributes: {
    internalPages: [
      {
        id: `plugin:${id}`,
        title: `${id} page`,
      },
    ],
    actions: [
      {
        id: "echo",
        title: `${id} echo`,
        aliases: ["say"],
      },
    ],
    viewers: [
      {
        id: "pdf",
        title: `${id} PDF`,
        description: `${id} PDF description`,
        extensions: ["pdf"],
      },
    ],
  },
  internalPages: [
    {
      id: `plugin:${id}`,
      title: `${id} page`,
    },
  ],
});

const loadRegistryModule = async () => {
  vi.resetModules();

  return import("./pluginRegistry");
};

beforeEach(() => {
  mockedInvoke.mockReset();
  window.localStorage.clear();
});

describe("pluginRegistry", () => {
  it("loads discovery reports, applies trust, exposes pages, and executes actions", async () => {
    const trustedPlugin = registryPlugin("trusted-plugin");
    const untrustedPlugin = registryPlugin("untrusted-plugin");
    const statuses = {
      [trustedPlugin.id]: trustedStatus(trustedPlugin.id, true),
      [untrustedPlugin.id]: trustedStatus(untrustedPlugin.id, false),
    };

    mockedInvoke.mockImplementation((command, args) => {
      if (command === "get_plugin_discovery_report") {
        return Promise.resolve({
          manifests: [trustedPlugin, untrustedPlugin],
          errors: [
            {
              path: "plugins/broken/manifest.json",
              error: "invalid plugin",
            },
          ],
        });
      }

      if (command === "get_plugin_trust_status") {
        return Promise.resolve(
          statuses[(args as { pluginId: keyof typeof statuses }).pluginId],
        );
      }

      if (command === "get_plugin_entrypoint_source") {
        return Promise.resolve({
          pluginId: (args as { pluginId: string }).pluginId,
          entrypoint: "main",
          path: "main.js",
          source: `
export default function activate(ctx) {
  ctx.registerAction("echo", (input) => ctx.plugin.id + ":" + input);
}
`,
        });
      }

      if (command === "get_plugin_asset_source") {
        return Promise.reject(new Error("not found"));
      }

      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    const registry = await loadRegistryModule();
    await registry.loadPlugins();

    const plugins = registry.getPlugins();

    expect(
      plugins.find((plugin) => plugin.id === trustedPlugin.id),
    ).toMatchObject({
      enabled: true,
      trusted: true,
    });
    expect(
      plugins.find((plugin) => plugin.id === untrustedPlugin.id),
    ).toMatchObject({
      enabled: false,
      trusted: false,
    });
    expect(registry.getPluginDiscoveryErrors()).toHaveLength(1);
    expect(registry.getInternalPageContributions()).toHaveLength(1);
    expect(
      registry.getPluginViewerContribution(trustedPlugin.id, "pdf"),
    ).toMatchObject({
      plugin: {
        id: trustedPlugin.id,
      },
      viewer: {
        id: "pdf",
        title: "trusted-plugin PDF",
      },
    });
    expect(
      registry.getPluginViewerContribution(untrustedPlugin.id, "pdf"),
    ).toBeUndefined();
    expect(registry.getPluginActionItems()[0]).toMatchObject({
      title: "trusted-plugin echo",
      open: {
        type: "pluginAction",
        pluginId: trustedPlugin.id,
        actionId: "echo",
      },
    });

    registry.setPluginLocale("ja");

    expect(
      registry.getPlugins().find((plugin) => plugin.id === trustedPlugin.id),
    ).toMatchObject({
      name: "trusted-plugin 日本語",
      description: "trusted-plugin の説明",
    });
    expect(registry.getInternalPageContributions()[0].title).toBe(
      "trusted-plugin 日本語ページ",
    );
    expect(registry.getPluginActionItems()[0]).toMatchObject({
      title: "trusted-plugin 日本語 echo",
      metadata: {
        aliases: expect.arrayContaining(["日本語echo"]),
      },
    });

    registry.setPluginLocale("en");

    await expect(
      registry.executePluginAction({
        pluginId: trustedPlugin.id,
        actionId: "echo",
        input: "ok",
      }),
    ).resolves.toBe("trusted-plugin:ok");

    await expect(
      registry.executePluginAction({
        pluginId: untrustedPlugin.id,
        actionId: "echo",
        input: "ok",
      }),
    ).rejects.toThrow("Plugin is disabled");
  });

  it("does not enable a trusted plugin when the stored enabled state is false", async () => {
    const plugin = registryPlugin("disabled-plugin");

    window.localStorage.setItem(
      "glimpse:plugins:enabled",
      JSON.stringify({ [plugin.id]: false }),
    );

    mockedInvoke.mockImplementation((command, args) => {
      if (command === "get_plugin_discovery_report") {
        return Promise.resolve({
          manifests: [plugin],
          errors: [],
        });
      }

      if (command === "get_plugin_trust_status") {
        return Promise.resolve(
          trustedStatus((args as { pluginId: string }).pluginId, true),
        );
      }

      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    const registry = await loadRegistryModule();
    await registry.loadPlugins();

    expect(registry.getPlugins()[0]).toMatchObject({
      enabled: false,
      trusted: true,
    });
    expect(registry.getInternalPageContributions()).toHaveLength(0);
    expect(registry.getPluginActionItems()).toHaveLength(0);
  });

  it("exposes only page-action plugin pages as playground internal items", async () => {
    const playgroundPlugin: GlimpsePlugin = {
      id: "playground-plugin",
      name: "Playground Plugin",
      version: "0.1.0",
      internalPages: [
        {
          id: "plugin:playground-plugin",
          title: "Playground Plugin",
          pageAction: {
            actionId: "run",
            examples: ["example"],
          },
        },
      ],
    };
    const staticPlugin: GlimpsePlugin = {
      id: "static-plugin",
      name: "Static Plugin",
      version: "0.1.0",
      internalPages: [
        {
          id: "plugin:static-plugin",
          title: "Static Plugin",
        },
      ],
    };
    const manifests = [playgroundPlugin, staticPlugin];

    mockedInvoke.mockImplementation((command, args) => {
      if (command === "get_plugin_discovery_report") {
        return Promise.resolve({
          manifests,
          errors: [],
        });
      }

      if (command === "get_plugin_trust_status") {
        return Promise.resolve(
          trustedStatus((args as { pluginId: string }).pluginId, true),
        );
      }

      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    const registry = await loadRegistryModule();
    await registry.loadPlugins();

    expect(
      registry.getPluginPlaygroundInternalItems().map((item) => item.id),
    ).toEqual(["internal://plugin:playground-plugin"]);
  });

  it("reloads plugins after archive and remote installs", async () => {
    const plugin = registryPlugin("remote-plugin");

    mockedInvoke.mockImplementation((command, args) => {
      if (
        command === "install_plugin_from_archive" ||
        command === "install_plugin_from_url"
      ) {
        return Promise.resolve({
          pluginId: plugin.id,
          installedPath: `plugins/${plugin.id}`,
          replaced: Boolean((args as { replace?: boolean }).replace),
          manifest: plugin,
        });
      }

      if (command === "get_plugin_discovery_report") {
        return Promise.resolve({
          manifests: [plugin],
          errors: [],
        });
      }

      if (command === "get_plugin_trust_status") {
        return Promise.resolve(
          trustedStatus((args as { pluginId: string }).pluginId, false),
        );
      }

      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    const registry = await loadRegistryModule();

    await expect(
      registry.installPluginFromArchive(
        "C:/plugins/remote-plugin.glimpse-plugin.zip",
      ),
    ).resolves.toMatchObject({
      pluginId: plugin.id,
      replaced: false,
    });
    await expect(
      registry.installPluginFromUrl(
        "https://example.com/remote-plugin.glimpse-plugin.zip",
        "f8e403e2374041ab56e8c44469fb639c45643237c7c543fd9efedab9b69c41b7",
        true,
      ),
    ).resolves.toMatchObject({
      pluginId: plugin.id,
      replaced: true,
      source: "remote",
    });

    expect(mockedInvoke).toHaveBeenCalledWith("install_plugin_from_archive", {
      archivePath: "C:/plugins/remote-plugin.glimpse-plugin.zip",
      replace: false,
    });
    expect(mockedInvoke).toHaveBeenCalledWith("install_plugin_from_url", {
      downloadUrl: "https://example.com/remote-plugin.glimpse-plugin.zip",
      sha256:
        "f8e403e2374041ab56e8c44469fb639c45643237c7c543fd9efedab9b69c41b7",
      replace: true,
    });
    expect(registry.getPlugins()).toHaveLength(1);
    expect(registry.getPlugins()[0]).toMatchObject({
      enabled: false,
      trusted: false,
    });
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      "set_plugin_trust",
      expect.anything(),
    );
  });
});
