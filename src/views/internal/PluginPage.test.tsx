// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n/I18nProvider";
import type {
  GlimpsePlugin,
  PluginInstallResult,
  PluginRegistry,
  PluginRegistryEntry,
  PluginRegistryItem,
} from "@/types";

import { PluginPage } from "./PluginPage";

const digest =
  "f8e403e2374041ab56e8c44469fb639c45643237c7c543fd9efedab9b69c41b7";

const pluginRegistryMocks = vi.hoisted(() => {
  let plugins: unknown[] = [];

  return {
    setPlugins: (nextPlugins: unknown[]) => {
      plugins = nextPlugins;
    },
    getPlugins: vi.fn(() => plugins),
    getPluginDiscoveryErrors: vi.fn(() => []),
    loadPlugins: vi.fn(async () => plugins),
    reloadPlugins: vi.fn(async () => plugins),
    installPluginFromArchive: vi.fn(),
    installPluginFromPath: vi.fn(),
    installPluginFromUrl: vi.fn(),
    setPluginEnabled: vi.fn(),
    setPluginTrusted: vi.fn(),
    subscribeToPluginChanges: vi.fn(() => () => undefined),
  };
});

const windowMocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(() => ({
    onDragDropEvent: vi.fn(async () => () => undefined),
  })),
}));

const openerMocks = vi.hoisted(() => ({
  openUrl: vi.fn(async () => undefined),
}));

vi.mock("@/features/plugins/pluginRegistry", () => ({
  getPluginDiscoveryErrors: pluginRegistryMocks.getPluginDiscoveryErrors,
  getPlugins: pluginRegistryMocks.getPlugins,
  installPluginFromArchive: pluginRegistryMocks.installPluginFromArchive,
  installPluginFromPath: pluginRegistryMocks.installPluginFromPath,
  installPluginFromUrl: pluginRegistryMocks.installPluginFromUrl,
  loadPlugins: pluginRegistryMocks.loadPlugins,
  reloadPlugins: pluginRegistryMocks.reloadPlugins,
  setPluginEnabled: pluginRegistryMocks.setPluginEnabled,
  setPluginTrusted: pluginRegistryMocks.setPluginTrusted,
  subscribeToPluginChanges: pluginRegistryMocks.subscribeToPluginChanges,
}));

vi.mock("@/api/plugins", () => ({
  pluginsApi: {
    openFolder: vi.fn(async () => undefined),
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: windowMocks.getCurrentWindow,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openerMocks.openUrl,
}));

const registryEntry = (
  id: string,
  name: string,
  overrides: Partial<PluginRegistryEntry> = {},
): PluginRegistryEntry => ({
  id,
  name,
  version: "0.2.0",
  apiVersion: "0.2.0",
  description: `${name} description`,
  releaseDate: "2026-09-06",
  sourceUrl: `https://github.com/getglimpse/plugins/tree/main/${id}`,
  downloadUrl: `https://github.com/getglimpse/plugins/releases/download/${id}-v0.2.0/${id}-0.2.0.glimpse-plugin.zip`,
  sha256: digest,
  ...overrides,
});

const installedPlugin = (
  id: string,
  version: string,
): PluginRegistryItem => ({
  id,
  name: id,
  version,
  apiVersion: "0.2.0",
  enabled: false,
  trusted: false,
});

const installResult = (entry: PluginRegistryEntry): PluginInstallResult => ({
  pluginId: entry.id,
  installedPath: `C:/Users/j/AppData/Roaming/glimpse/plugins/${entry.id}`,
  replaced: false,
  manifest: {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    apiVersion: entry.apiVersion,
  } satisfies GlimpsePlugin,
});

const stubRegistryFetch = (plugins: PluginRegistryEntry[]) => {
  const registry: PluginRegistry = {
    schemaVersion: 1,
    plugins,
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => registry,
    })),
  );
};

const renderPluginPage = () =>
  render(
    <I18nProvider locale="en">
      <PluginPage />
    </I18nProvider>,
  );

const cardFor = async (name: string) => {
  const title = await screen.findByText(name);
  const card = title.closest("article");

  if (!card) {
    throw new Error(`card not found: ${name}`);
  }

  return within(card);
};

beforeEach(() => {
  pluginRegistryMocks.setPlugins([]);
  pluginRegistryMocks.getPlugins.mockClear();
  pluginRegistryMocks.getPluginDiscoveryErrors.mockClear();
  pluginRegistryMocks.loadPlugins.mockClear();
  pluginRegistryMocks.reloadPlugins.mockClear();
  pluginRegistryMocks.installPluginFromArchive.mockReset();
  pluginRegistryMocks.installPluginFromPath.mockReset();
  pluginRegistryMocks.installPluginFromUrl.mockReset();
  pluginRegistryMocks.setPluginEnabled.mockClear();
  pluginRegistryMocks.setPluginTrusted.mockClear();
  pluginRegistryMocks.subscribeToPluginChanges.mockClear();
  windowMocks.getCurrentWindow.mockClear();
  openerMocks.openUrl.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PluginPage remote plugins", () => {
  it("renders remote plugin install states from registry and installed plugins", async () => {
    const entries = [
      registryEntry("new-plugin", "New Plugin"),
      registryEntry("update-plugin", "Update Plugin"),
      registryEntry("installed-plugin", "Installed Plugin"),
      registryEntry("future-plugin", "Future Plugin", {
        apiVersion: "999.0.0",
      }),
    ];

    pluginRegistryMocks.setPlugins([
      installedPlugin("update-plugin", "0.1.0"),
      installedPlugin("installed-plugin", "0.2.0"),
    ]);
    stubRegistryFetch(entries);

    renderPluginPage();

    const newCard = await cardFor("New Plugin");
    expect(newCard.getByText("Not installed")).toBeTruthy();
    expect(
      (newCard.getByRole("button", { name: "Install" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(newCard.getByText("Released 2026-09-06")).toBeTruthy();
    expect(newCard.getByRole("button", { name: "Source" })).toBeTruthy();

    const updateCard = await cardFor("Update Plugin");
    expect(updateCard.getByText("Update available")).toBeTruthy();
    expect(updateCard.getByText("Installed v0.1.0")).toBeTruthy();
    expect(
      (updateCard.getByRole("button", { name: "Update" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    const installedCard = await cardFor("Installed Plugin");
    expect(installedCard.getAllByText("Installed").length).toBeGreaterThan(0);
    expect(
      (installedCard.getByRole("button", {
        name: "Installed",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

    const unsupportedCard = await cardFor("Future Plugin");
    expect(unsupportedCard.getByText("Unsupported API")).toBeTruthy();
    expect(
      (unsupportedCard.getByRole("button", {
        name: "Unsupported",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("installs remote plugins, refreshes installed state, and does not trust them", async () => {
    const entry = registryEntry("new-plugin", "New Plugin");

    stubRegistryFetch([entry]);
    pluginRegistryMocks.installPluginFromUrl.mockImplementation(async () => {
      pluginRegistryMocks.setPlugins([installedPlugin(entry.id, entry.version)]);

      return {
        ...installResult(entry),
        source: "remote",
      };
    });

    renderPluginPage();

    fireEvent.click(
      (await cardFor("New Plugin")).getByRole("button", { name: "Install" }),
    );

    await waitFor(() => {
      expect(pluginRegistryMocks.installPluginFromUrl).toHaveBeenCalledWith(
        entry.downloadUrl,
        entry.sha256,
        false,
      );
    });
    expect(
      await screen.findByText("Installed new-plugin. Trust it before enabling."),
    ).toBeTruthy();
    expect(pluginRegistryMocks.setPluginTrusted).not.toHaveBeenCalled();
  });

  it("shows readable remote install failures", async () => {
    const entry = registryEntry("broken-plugin", "Broken Plugin");

    stubRegistryFetch([entry]);
    pluginRegistryMocks.installPluginFromUrl.mockRejectedValue(
      "plugin archive checksum mismatch: expected a, got b",
    );

    renderPluginPage();

    fireEvent.click(
      (await cardFor("Broken Plugin")).getByRole("button", {
        name: "Install",
      }),
    );

    expect(
      await screen.findByText(
        "The plugin download did not match the registry checksum.",
      ),
    ).toBeTruthy();
  });
});
