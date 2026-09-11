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
import { OPEN_LOCAL_PLUGIN_INSTALL_EVENT } from "@/features/plugins/pluginPageEvents";
import type {
  GlimpsePlugin,
  PluginInstallResult,
  PluginRegistry,
  PluginRegistryEntry,
  PluginRegistryItem,
} from "@/types";

import { PluginManagementPage } from "./PluginManagementPage";
import { RemotePluginPage } from "./RemotePluginPage";

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
    uninstallPlugin: vi.fn(),
  };
});

const windowMocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(() => ({
    onDragDropEvent: vi.fn(async () => () => undefined),
  })),
}));

const openerMocks = vi.hoisted(() => ({
  openerApi: {
    openExternalUrl: vi.fn(async () => undefined),
  },
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
  uninstallPlugin: pluginRegistryMocks.uninstallPlugin,
}));

vi.mock("@/api/plugins", () => ({
  pluginsApi: {
    openFolder: vi.fn(async () => undefined),
    getReadmeSource: vi.fn(async (pluginId: string) => {
      if (pluginId === "installed-plugin-with-readme") {
        return {
          pluginId,
          path: `C:/Users/j/AppData/Roaming/glimpse/plugins/${pluginId}/README.md`,
          source: "# Installed README\n\nLocal plugin documentation.",
        };
      }

      throw new Error(
        `plugin README not found: C:/Users/j/AppData/Roaming/glimpse/plugins/${pluginId}/README.md`,
      );
    }),
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: windowMocks.getCurrentWindow,
}));

vi.mock("@/api/opener", () => ({
  openerApi: openerMocks.openerApi,
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
  author: "Impersonated Publisher",
  category: "Converter",
  description: `${name} description`,
  downloadCount: 1234,
  releaseDate: "2026-09-06",
  readmeUrl: `https://raw.githubusercontent.com/getglimpse/plugins/main/${id}/README.md`,
  sourceUrl: `https://github.com/getglimpse/plugins/tree/main/${id}`,
  repositoryUrl: "https://github.com/getglimpse/plugins",
  downloadUrl: `https://github.com/getglimpse/plugins/releases/download/${id}-v0.2.0/${id}-0.2.0.glimpse-plugin.zip`,
  sha256: digest,
  ...overrides,
});

const installedPlugin = (
  id: string,
  version: string,
  overrides: Partial<PluginRegistryItem> = {},
): PluginRegistryItem => ({
  id,
  name: id,
  version,
  apiVersion: "0.2.0",
  enabled: false,
  trusted: false,
  ...overrides,
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
  const readmesByUrl = new Map(
    plugins.map((plugin) => [
      plugin.readmeUrl ??
        `https://raw.githubusercontent.com/getglimpse/plugins/main/${plugin.id}/README.md`,
      `# ${plugin.name} README\n\nDetailed README content for ${plugin.name}.`,
    ]),
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input.toString() : String(input);

      if (readmesByUrl.has(url)) {
        return {
          ok: true,
          text: async () => readmesByUrl.get(url),
        };
      }

      return {
        ok: true,
        json: async () => registry,
      };
    }),
  );
};

const renderPluginPage = () =>
  render(
    <I18nProvider locale="en">
      <PluginManagementPage />
    </I18nProvider>,
  );

const renderPluginStorePage = () =>
  render(
    <I18nProvider locale="en">
      <RemotePluginPage />
    </I18nProvider>,
  );

const remotePluginRow = async (name: string) =>
  screen.findByRole("button", {
    name: `Show details for ${name}`,
  });

const cardFor = async (name: string) => {
  const row = await remotePluginRow(name);
  return within(row);
};

const remoteDetailDialog = async () =>
  within(await screen.findByRole("dialog"));

const closeRemoteDetailDialog = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
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
  pluginRegistryMocks.uninstallPlugin.mockReset();
  windowMocks.getCurrentWindow.mockClear();
  openerMocks.openerApi.openExternalUrl.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PluginPage installed plugins", () => {
  it("renders installed plugins and opens local install from the header event", async () => {
    pluginRegistryMocks.setPlugins([
      installedPlugin("installed-plugin-with-readme", "0.2.0", {
        name: "Installed Plugin With README",
      }),
      installedPlugin("installed-plugin-without-readme", "0.2.0", {
        name: "Installed Plugin Without README",
      }),
    ]);
    stubRegistryFetch([registryEntry("remote-plugin", "Remote Plugin")]);

    renderPluginPage();

    expect(
      await screen.findByPlaceholderText("Search installed plugins"),
    ).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Remote Plugins" })).toBeNull();
    expect(
      screen.queryByPlaceholderText("Local plugin folder path, one per line"),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Open folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload all" })).toBeTruthy();
    expect(await screen.findByText("README")).toBeTruthy();
    expect(await screen.findByText("Installed README")).toBeTruthy();
    expect(screen.getByText("Local plugin documentation.")).toBeTruthy();
    expect(screen.queryByText("README could not be loaded.")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Install local plugin" }),
    ).toBeNull();
    expect(screen.queryByText("Official plugin registry")).toBeNull();

    window.dispatchEvent(new Event(OPEN_LOCAL_PLUGIN_INSTALL_EVENT));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("Local plugin folder path, one per line"),
    ).toBeTruthy();
  });
});

describe("PluginPage remote plugins", () => {
  it("renders remote plugin install states from registry and installed plugins", async () => {
    const entries = [
      registryEntry("new-plugin", "New Plugin", {
        downloadCount: undefined,
        readmeUrl: undefined,
      }),
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

    renderPluginStorePage();

    expect(
      screen.queryByRole("group", { name: "Remote plugin filters" }),
    ).toBeNull();
    expect(
      await screen.findByRole("button", {
        name: "Show details for Update Plugin",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Show details for New Plugin" }),
    ).toBeTruthy();

    expect(
      screen
        .getByRole("button", { name: "Show details for New Plugin" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
    const newPluginRow = await remotePluginRow("New Plugin");
    const newCard = await cardFor("New Plugin");
    expect(newCard.getByText("Not installed")).toBeTruthy();
    expect(newCard.queryByRole("button", { name: "Install" })).toBeNull();
    fireEvent.click(newPluginRow);
    let detailDialog = await remoteDetailDialog();
    expect(
      (
        detailDialog.getByRole("button", {
          name: "Install",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(detailDialog.getByText("getglimpse")).toBeTruthy();
    expect(detailDialog.getByLabelText("Downloads: -")).toBeTruthy();
    expect(detailDialog.queryByText(/Downloads:/)).toBeNull();
    expect(detailDialog.getByText("Version")).toBeTruthy();
    expect(detailDialog.getByText("0.2.0")).toBeTruthy();
    expect(detailDialog.getByText("Repository")).toBeTruthy();
    expect(
      detailDialog.getByText("https://github.com/getglimpse/plugins"),
    ).toBeTruthy();
    expect(detailDialog.getByText("Last updated")).toBeTruthy();
    expect(detailDialog.queryByText("2026-09-06")).toBeNull();
    expect(detailDialog.getByText("Category")).toBeTruthy();
    expect(detailDialog.getByText("Converter")).toBeTruthy();
    expect(detailDialog.queryByText("API")).toBeNull();
    expect(detailDialog.queryByText("SHA-256")).toBeNull();
    expect(detailDialog.queryByRole("button", { name: "Source" })).toBeNull();
    expect(await detailDialog.findByText("New Plugin README")).toBeTruthy();
    expect(
      detailDialog.getByText("Detailed README content for New Plugin."),
    ).toBeTruthy();
    await closeRemoteDetailDialog();

    const updatePluginRow = await remotePluginRow("Update Plugin");
    const updateCard = within(updatePluginRow);
    fireEvent.click(updatePluginRow);
    detailDialog = await remoteDetailDialog();
    expect(updatePluginRow.getAttribute("aria-pressed")).toBe("true");
    expect(updateCard.getByText("Update available")).toBeTruthy();
    expect(detailDialog.getByLabelText("Downloads: 1.2K")).toBeTruthy();
    expect(detailDialog.getByText("Version")).toBeTruthy();
    expect(detailDialog.getByText("0.2.0")).toBeTruthy();
    expect(
      (
        detailDialog.getByRole("button", {
          name: "Update",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(detailDialog.getByRole("button", { name: "Enable" })).toBeTruthy();
    expect(
      detailDialog.getByRole("button", { name: "Uninstall" }),
    ).toBeTruthy();
    await closeRemoteDetailDialog();

    const installedPluginRow = await remotePluginRow("Installed Plugin");
    const installedCard = within(installedPluginRow);
    fireEvent.click(installedPluginRow);
    detailDialog = await remoteDetailDialog();
    expect(installedCard.getAllByText("Installed").length).toBeGreaterThan(0);
    expect(
      detailDialog.queryByRole("button", { name: "Installed" }),
    ).toBeNull();
    expect(detailDialog.getByRole("button", { name: "Enable" })).toBeTruthy();
    expect(
      detailDialog.getByRole("button", { name: "Uninstall" }),
    ).toBeTruthy();
    await closeRemoteDetailDialog();

    const futurePluginRow = await remotePluginRow("Future Plugin");
    const unsupportedCard = within(futurePluginRow);
    fireEvent.click(futurePluginRow);
    detailDialog = await remoteDetailDialog();
    expect(unsupportedCard.getByText("Unsupported API")).toBeTruthy();
    expect(
      (
        detailDialog.getByRole("button", {
          name: "Unsupported",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("installs remote plugins, refreshes installed state, and does not trust them", async () => {
    const entry = registryEntry("new-plugin", "New Plugin");

    stubRegistryFetch([entry]);
    pluginRegistryMocks.installPluginFromUrl.mockImplementation(async () => {
      pluginRegistryMocks.setPlugins([
        installedPlugin(entry.id, entry.version),
      ]);

      return {
        ...installResult(entry),
        source: "remote",
      };
    });

    renderPluginStorePage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Show details for New Plugin",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(pluginRegistryMocks.installPluginFromUrl).toHaveBeenCalledWith(
        entry.downloadUrl,
        entry.sha256,
        false,
      );
    });
    expect(
      await screen.findByText(
        "Installed new-plugin. Review it before enabling.",
      ),
    ).toBeTruthy();
    expect(pluginRegistryMocks.setPluginTrusted).not.toHaveBeenCalled();
  });

  it("enables untrusted installed plugins from remote detail by trusting first", async () => {
    const entry = registryEntry("installed-plugin", "Installed Plugin");

    pluginRegistryMocks.setPlugins([
      installedPlugin(entry.id, entry.version, {
        enabled: false,
        trusted: false,
      }),
    ]);
    stubRegistryFetch([entry]);

    renderPluginStorePage();

    fireEvent.click(await remotePluginRow("Installed Plugin"));
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(pluginRegistryMocks.setPluginTrusted).toHaveBeenCalledWith(
        entry.id,
        true,
      );
      expect(pluginRegistryMocks.setPluginEnabled).toHaveBeenCalledWith(
        entry.id,
        true,
      );
    });
  });

  it("disables trusted installed plugins from remote detail without revoking trust", async () => {
    const entry = registryEntry("installed-plugin", "Installed Plugin");

    pluginRegistryMocks.setPlugins([
      installedPlugin(entry.id, entry.version, {
        enabled: true,
        trusted: true,
      }),
    ]);
    stubRegistryFetch([entry]);

    renderPluginStorePage();

    fireEvent.click(await remotePluginRow("Installed Plugin"));
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(pluginRegistryMocks.setPluginEnabled).toHaveBeenCalledWith(
        entry.id,
        false,
      );
    });
    expect(pluginRegistryMocks.setPluginTrusted).not.toHaveBeenCalled();
  });

  it("closes the remote plugin detail dialog when clicking outside it", async () => {
    stubRegistryFetch([registryEntry("new-plugin", "New Plugin")]);

    renderPluginStorePage();

    fireEvent.click(await remotePluginRow("New Plugin"));

    expect(await screen.findByRole("dialog")).toBeTruthy();

    fireEvent.mouseDown(screen.getByTestId("remote-plugin-detail-overlay"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("shows readable remote install failures", async () => {
    const entry = registryEntry("broken-plugin", "Broken Plugin");

    stubRegistryFetch([entry]);
    pluginRegistryMocks.installPluginFromUrl.mockRejectedValue(
      "plugin archive checksum mismatch: expected a, got b",
    );

    renderPluginStorePage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Show details for Broken Plugin",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(
      (
        await screen.findAllByText(
          "The plugin download did not match the registry checksum.",
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
