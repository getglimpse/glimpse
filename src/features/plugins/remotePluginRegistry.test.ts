import { describe, expect, it } from "vitest";

import type { GlimpsePlugin, PluginRegistry } from "@/types";

import {
  OFFICIAL_PLUGIN_REGISTRY_URL,
  checkRegistryEntryMatchesManifest,
  getRemotePluginInstallErrorMessage,
  isRegistryEntryApiSupported,
  validatePluginRegistry,
} from "./remotePluginRegistry";

const digest =
  "f8e403e2374041ab56e8c44469fb639c45643237c7c543fd9efedab9b69c41b7";

const validRegistry = (): PluginRegistry => ({
  schemaVersion: 1,
  plugins: [
    {
      id: "numeric-calculator-plugin",
      name: "Numeric Calculator",
      version: "0.2.0",
      apiVersion: "0.2.0",
      description: "Calculator plugin for Glimpse.",
      downloadUrl:
        "https://github.com/getglimpse/plugins/releases/download/numeric-calculator-plugin-v0.2.0/numeric-calculator-plugin-0.2.0.glimpse-plugin.zip",
      sha256: digest.toUpperCase(),
      sourceUrl:
        "https://github.com/getglimpse/plugins/tree/main/numeric-calculator-plugin",
      repositoryUrl: "https://github.com/getglimpse/plugins",
      homepageUrl:
        "https://github.com/getglimpse/plugins/tree/main/numeric-calculator-plugin",
      supportUrl: "https://github.com/getglimpse/plugins/issues",
      releaseDate: "2026-09-05",
      fileName: "numeric-calculator-plugin-0.2.0.glimpse-plugin.zip",
    },
  ],
});

describe("remotePluginRegistry", () => {
  it("defines the official registry URL", () => {
    expect(OFFICIAL_PLUGIN_REGISTRY_URL).toBe(
      "https://raw.githubusercontent.com/getglimpse/plugins/main/registry.json",
    );
  });

  it("validates and normalizes a registry", () => {
    const result = validatePluginRegistry(validRegistry());

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.errors.join("\n"));
    }

    expect(result.registry.plugins[0].sha256).toBe(digest);
  });

  it("rejects insecure download URLs and invalid checksums", () => {
    const registry = validRegistry();

    registry.plugins[0].downloadUrl =
      "http://example.com/plugin.glimpse-plugin.zip";
    registry.plugins[0].sha256 = "not-a-digest";

    const result = validatePluginRegistry(registry);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("plugins[0].downloadUrl must use https");
    expect(result.errors).toContain(
      "plugins[0].sha256 must be a 64 character hex SHA-256 digest",
    );
  });

  it("rejects duplicate plugin ids", () => {
    const registry = validRegistry();

    registry.plugins.push({ ...registry.plugins[0] });

    const result = validatePluginRegistry(registry);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "plugins[1].id is duplicated: numeric-calculator-plugin",
    );
  });

  it("checks registry entries against installed manifests", () => {
    const entry = validRegistry().plugins[0];
    const manifest: GlimpsePlugin = {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      apiVersion: entry.apiVersion,
    };

    expect(checkRegistryEntryMatchesManifest(entry, manifest)).toEqual({
      ok: true,
      errors: [],
    });

    expect(
      checkRegistryEntryMatchesManifest(entry, {
        ...manifest,
        version: "0.2.1",
      }),
    ).toEqual({
      ok: false,
      errors: ["registry version mismatch: expected 0.2.0, got 0.2.1"],
    });
  });

  it("reports whether a registry entry targets the supported plugin API", () => {
    const entry = validRegistry().plugins[0];

    expect(isRegistryEntryApiSupported(entry)).toBe(true);
    expect(
      isRegistryEntryApiSupported({
        ...entry,
        apiVersion: "0.3.0",
      }),
    ).toBe(false);
  });

  it("maps backend install failures to plugin page messages", () => {
    expect(
      getRemotePluginInstallErrorMessage(
        "plugin archive checksum mismatch: expected a, got b",
      ),
    ).toBe("The plugin download did not match the registry checksum.");
    expect(
      getRemotePluginInstallErrorMessage(
        "plugin archive contains executable file: plugin.dll",
      ),
    ).toBe("The plugin archive contains files that are not allowed.");
    expect(
      getRemotePluginInstallErrorMessage(
        new Error("failed to download plugin archive: timeout"),
      ),
    ).toBe("The plugin archive could not be downloaded.");
  });
});
