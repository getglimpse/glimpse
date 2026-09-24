// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n/I18nProvider";
import { SettingsPage } from "./SettingsPage";

const settingsMocks = vi.hoisted(() => ({
  get: vi.fn(),
  getRecoveryStatus: vi.fn(),
  restoreBackup: vi.fn(),
  set: vi.fn(),
  openFile: vi.fn(async () => undefined),
  onChanged: vi.fn(async (_handler: () => void) => () => undefined),
}));
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/api/settings", () => ({ settingsApi: settingsMocks }));
vi.mock("@/utils/toast", () => ({ toast: toastMocks }));
vi.mock("./settings/AppearanceSettings", () => ({
  AppearanceSettings: () => <button type="button">Settings control</button>,
}));
vi.mock("./settings/TargetGroupSettings", () => ({
  TargetGroupSettings: () => null,
}));
vi.mock("./settings/UiSettings", () => ({
  UiSettings: ({
    closeToTray,
    onCloseToTrayChange,
  }: {
    closeToTray: boolean;
    onCloseToTrayChange: (value: boolean) => void;
  }) => (
    <button type="button" onClick={() => onCloseToTrayChange(!closeToTray)}>
      {closeToTray ? "Tray on" : "Tray off"}
    </button>
  ),
}));
vi.mock("./settings/SecuritySettings", () => ({
  SecuritySettings: () => null,
}));
vi.mock("./settings/ExperimentalSettings", () => ({
  ExperimentalSettings: () => null,
}));

const renderPage = () =>
  render(
    <I18nProvider locale="en">
      <SettingsPage
        themeId="nord"
        themeOptions={[]}
        onThemeChange={vi.fn()}
        onReloadThemes={vi.fn(async () => undefined)}
        compactListItems={false}
        onCompactListItemsChange={vi.fn()}
        language="en"
        onLanguageChange={vi.fn()}
      />
    </I18nProvider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  settingsMocks.get.mockReset();
  settingsMocks.getRecoveryStatus.mockReset();
  settingsMocks.restoreBackup.mockReset();
  settingsMocks.set.mockReset();
  settingsMocks.openFile.mockClear();
  settingsMocks.onChanged.mockClear();
  toastMocks.success.mockClear();
  toastMocks.error.mockClear();
});

it("does not revert a rapid toggle when an older save or reload finishes", async () => {
  const settings = {
    theme: "nord",
    commands: {
      policyMode: "blacklist",
      whitelist: [],
      blacklist: [],
    },
    targetGroups: [],
    currentTargetGroupId: null,
    ui: { compactListItems: false, closeToTray: true, language: "en" },
  };
  settingsMocks.get.mockResolvedValue(settings);
  settingsMocks.getRecoveryStatus.mockResolvedValue({
    needsRecovery: false,
    backupAvailable: false,
    error: null,
  });
  let resolveFirst!: (value: unknown) => void;
  let resolveSecond!: (value: unknown) => void;
  settingsMocks.set
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );
  renderPage();

  const trayButton = await screen.findByRole("button", { name: "Tray on" });
  await waitFor(() => expect(trayButton.matches(":disabled")).toBe(false));
  fireEvent.click(trayButton);
  expect(screen.getByRole("button", { name: "Tray off" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Tray off" }));
  expect(screen.getByRole("button", { name: "Tray on" })).toBeTruthy();
  await act(async () => {
    settingsMocks.onChanged.mock.calls[0][0]();
    await Promise.resolve();
  });
  expect(screen.getByRole("button", { name: "Tray on" })).toBeTruthy();

  await act(async () =>
    resolveFirst({
      ...settings,
      ui: { ...settings.ui, closeToTray: false },
    }),
  );
  expect(screen.getByRole("button", { name: "Tray on" })).toBeTruthy();
  await act(async () => resolveSecond(settings));
  expect(screen.getByRole("button", { name: "Tray on" })).toBeTruthy();
});

it("shows persistent recovery controls and restores a validated backup", async () => {
  settingsMocks.get.mockRejectedValueOnce("settings file is invalid");
  settingsMocks.getRecoveryStatus
    .mockResolvedValueOnce({
      needsRecovery: true,
      backupAvailable: true,
      error: "invalid JSON",
    })
    .mockResolvedValueOnce({
      needsRecovery: false,
      backupAvailable: true,
      error: null,
    });
  settingsMocks.restoreBackup.mockResolvedValueOnce({
    theme: "nord",
    commands: {
      policyMode: "blacklist",
      whitelist: [],
      blacklist: [],
      trustedDirectories: [],
    },
    targetGroups: [],
    currentTargetGroupId: null,
    ui: { compactListItems: false, closeToTray: true, language: "en" },
  });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  renderPage();

  expect((await screen.findByRole("alert")).textContent).toContain(
    "Settings need recovery",
  );
  expect(
    screen
      .getByRole("button", { name: "Settings control" })
      .matches(":disabled"),
  ).toBe(true);
  fireEvent.click(
    screen.getAllByRole("button", { name: "Restore from backup" })[0],
  );

  await waitFor(() =>
    expect(settingsMocks.restoreBackup).toHaveBeenCalledTimes(1),
  );
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(
    screen
      .getByRole("button", { name: "Settings control" })
      .matches(":disabled"),
  ).toBe(false);
  expect(toastMocks.success).toHaveBeenCalled();
});

it("does not offer restoration when the backup is invalid", async () => {
  settingsMocks.get.mockRejectedValueOnce("settings file is invalid");
  settingsMocks.getRecoveryStatus.mockResolvedValueOnce({
    needsRecovery: true,
    backupAvailable: false,
    error: "invalid JSON",
  });
  renderPage();

  expect((await screen.findByRole("alert")).textContent).toContain(
    "No valid backup is available",
  );
  for (const button of screen.getAllByRole("button", {
    name: "Restore from backup",
  })) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
  }
  expect(settingsMocks.restoreBackup).not.toHaveBeenCalled();
});

it("offers the Advanced restore action for a healthy settings file and asks for confirmation", async () => {
  const settings = {
    theme: "nord",
    commands: {
      policyMode: "blacklist",
      whitelist: [],
      blacklist: [],
      trustedDirectories: [],
    },
    targetGroups: [],
    currentTargetGroupId: null,
    ui: { compactListItems: false, closeToTray: true, language: "en" },
  };
  settingsMocks.get.mockResolvedValue(settings);
  settingsMocks.getRecoveryStatus.mockResolvedValue({
    needsRecovery: false,
    backupAvailable: true,
    error: null,
  });
  settingsMocks.restoreBackup.mockResolvedValue(settings);
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal("confirm", confirm);
  renderPage();

  const restore = await screen.findByRole("button", {
    name: "Restore from backup",
  });
  await waitFor(() =>
    expect((restore as HTMLButtonElement).disabled).toBe(false),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(restore);
  expect(settingsMocks.restoreBackup).not.toHaveBeenCalled();
  fireEvent.click(restore);
  await waitFor(() =>
    expect(settingsMocks.restoreBackup).toHaveBeenCalledTimes(1),
  );
  expect(confirm).toHaveBeenCalledTimes(2);
});
