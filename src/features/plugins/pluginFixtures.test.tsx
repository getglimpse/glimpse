// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { i18nObject } from "@/i18n/i18n-util";
import { loadLocaleAsync } from "@/i18n/i18n-util.async";
import type { GlimpsePlugin, PluginTrustStatus } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (filePath: string) => `asset://${filePath}`,
  isTauri: () => true,
}));

const mockedInvoke = vi.mocked(invoke);

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/plugins",
);
const validFixtureIds = [
  "valid-basic-plugin",
  "numeric-calculator-plugin",
] as const;

const loadRegistryModule = async () => {
  vi.resetModules();

  return import("./pluginRegistry");
};

const readFixtureFile = (pluginId: string, fileName: string): string =>
  readFileSync(path.join(fixturesRoot, pluginId, fileName), "utf8");

const readFixtureManifest = (pluginId: string): GlimpsePlugin => {
  const manifest = JSON.parse(
    readFixtureFile(pluginId, "manifest.json"),
  ) as GlimpsePlugin;

  return {
    ...manifest,
    internalPages:
      manifest.internalPages ?? manifest.contributes?.internalPages ?? [],
  };
};

const trustedStatus = (plugin: GlimpsePlugin): PluginTrustStatus => ({
  pluginId: plugin.id,
  trusted: true,
  trustRequired: true,
  reason: null,
  trustedAt: "2026-07-27T00:00:00Z",
  manifestFingerprint: `${plugin.id}:fixture-fingerprint`,
  trustedFingerprint: `${plugin.id}:fixture-fingerprint`,
  version: plugin.version,
  trustedVersion: plugin.version,
});

beforeEach(() => {
  mockedInvoke.mockReset();
  window.localStorage.clear();
  document.head.innerHTML = "";
});

describe("plugin fixture contracts", () => {
  it("loads valid fixture bundles and executes their registered actions", async () => {
    const manifests = validFixtureIds.map(readFixtureManifest);

    mockedInvoke.mockImplementation((command, args) => {
      const pluginId = (args as { pluginId?: string } | undefined)?.pluginId;

      if (command === "get_plugin_discovery_report") {
        return Promise.resolve({
          manifests,
          errors: [
            {
              path: path.join(
                fixturesRoot,
                "invalid-manifest-plugin",
                "manifest.json",
              ),
              error:
                "entrypoints.main must not contain parent directory segments",
            },
          ],
        });
      }

      if (command === "get_plugin_trust_status" && pluginId) {
        const plugin = manifests.find((candidate) => candidate.id === pluginId);

        if (!plugin) {
          return Promise.reject(
            new Error(`unknown fixture plugin: ${pluginId}`),
          );
        }

        return Promise.resolve(trustedStatus(plugin));
      }

      if (command === "get_plugin_entrypoint_source" && pluginId) {
        return Promise.resolve({
          pluginId,
          entrypoint: "main",
          path: path.join(fixturesRoot, pluginId, "main.js"),
          source: readFixtureFile(pluginId, "main.js"),
        });
      }

      if (command === "get_plugin_asset_source" && pluginId) {
        return Promise.resolve({
          pluginId,
          asset: "styles",
          path: path.join(fixturesRoot, pluginId, "styles.css"),
          source: readFixtureFile(pluginId, "styles.css"),
        });
      }

      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    const registry = await loadRegistryModule();
    await registry.loadPlugins();
    await loadLocaleAsync("en");
    const { getHelpContent, hasHelpContent } =
      await import("@/utils/helpContent");
    const numericHelp = getHelpContent(
      "plugin:numeric-calculator-plugin",
      i18nObject("en"),
    );

    expect(registry.getPluginDiscoveryErrors()).toHaveLength(1);
    expect(registry.getInternalPageContributions()).toHaveLength(2);
    expect(registry.getPluginActionItems().map((item) => item.title)).toEqual([
      "Say hello",
      "Calculate expression",
    ]);
    expect(hasHelpContent("plugin:numeric-calculator-plugin")).toBe(true);
    expect(numericHelp).toMatchObject({
      title: "Numeric Calculator Plugin",
      examples: ["> 1 + 1", "> sqrt(144)"],
      commands: [
        {
          command: "sqrt(x)",
          description: "Square root",
        },
        {
          command: "pi",
          description: "Pi",
        },
      ],
    });

    registry.setPluginLocale("ja");
    await loadLocaleAsync("ja");
    const numericHelpJa = getHelpContent(
      "plugin:numeric-calculator-plugin",
      i18nObject("ja"),
    );

    expect(registry.getPluginActionItems().map((item) => item.title)).toEqual([
      "挨拶する",
      "式を計算",
    ]);
    expect(numericHelpJa).toMatchObject({
      title: "数値計算",
      commands: [
        {
          command: "sqrt(x)",
          description: "平方根",
        },
        {
          command: "pi",
          description: "円周率",
        },
      ],
    });

    registry.setPluginLocale("en");

    await expect(
      registry.executePluginAction({
        pluginId: "valid-basic-plugin",
        actionId: "hello",
        input: "Contract",
      }),
    ).resolves.toBe("Hello, Contract!");

    await expect(
      registry.executePluginAction({
        pluginId: "numeric-calculator-plugin",
        actionId: "calculate",
        input: "sqrt(144)",
      }),
    ).resolves.toBe("12");

    await expect(
      registry.executePluginAction({
        pluginId: "numeric-calculator-plugin",
        actionId: "calculate",
        input: "a = 1",
      }),
    ).rejects.toThrow("Assignments and function definitions are disabled");

    await expect(
      registry.executePluginAction({
        pluginId: "numeric-calculator-plugin",
        actionId: "calculate",
        input: "1+".repeat(256) + "1",
      }),
    ).rejects.toThrow("Expression must be 512 characters or less");

    expect(
      document.head.querySelector(
        "[data-glimpse-plugin-style='valid-basic-plugin']",
      )?.textContent,
    ).toContain("fixture-basic");
    expect(
      document.head.querySelector(
        "[data-glimpse-plugin-style='numeric-calculator-plugin']",
      )?.textContent,
    ).toContain("fixture-calculator");
  });
});
