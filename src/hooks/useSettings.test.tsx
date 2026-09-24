// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useSettings } from "./useSettings";

const settingsMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  onChanged: vi.fn(async (_handler: () => void) => () => undefined),
}));
const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("@/api/settings", () => ({ settingsApi: settingsMocks }));
vi.mock("@/utils/toast", () => ({ toast: toastMocks }));

afterEach(() => {
  settingsMocks.get.mockReset();
  settingsMocks.set.mockReset();
  settingsMocks.onChanged.mockClear();
  toastMocks.error.mockReset();
  toastMocks.dismiss.mockReset();
  vi.useRealTimers();
});

const settingsWithCompact = (compactListItems: boolean) => ({
  theme: "nord",
  ui: { compactListItems, language: "en" },
  keybindings: {},
  targetGroups: [],
  currentTargetGroupId: null,
});

it("keeps the latest compact choice while old reloads and saves finish", async () => {
  settingsMocks.get.mockResolvedValue(settingsWithCompact(false));
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
  const { result, unmount } = renderHook(() => useSettings());
  await waitFor(() => expect(settingsMocks.get).toHaveBeenCalled());
  vi.useFakeTimers();

  act(() => result.current.setCompactListItems(true));
  expect(result.current.compactListItems).toBe(true);
  await act(async () => {
    settingsMocks.onChanged.mock.calls[0][0]();
    await Promise.resolve();
  });
  expect(result.current.compactListItems).toBe(true);

  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
  });
  expect(settingsMocks.set).toHaveBeenCalledWith({
    ui: { compactListItems: true },
  });

  act(() => result.current.setCompactListItems(false));
  await act(async () => resolveFirst(settingsWithCompact(true)));
  expect(result.current.compactListItems).toBe(false);
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
  });
  await act(async () => resolveSecond(settingsWithCompact(false)));
  expect(result.current.compactListItems).toBe(false);
  unmount();
});

it("keeps local language and theme choices through stale settings events", async () => {
  settingsMocks.get.mockResolvedValue(settingsWithCompact(false));
  let resolveLanguage!: (value: unknown) => void;
  let resolveTheme!: (value: unknown) => void;
  settingsMocks.set
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLanguage = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTheme = resolve;
        }),
    );
  const { result, unmount } = renderHook(() => useSettings());
  await waitFor(() => expect(settingsMocks.get).toHaveBeenCalled());

  act(() => {
    result.current.setLanguage("ja");
    result.current.setThemeId("dark");
  });
  await act(async () => {
    settingsMocks.onChanged.mock.calls[0][0]();
    await Promise.resolve();
  });
  expect(result.current.language).toBe("ja");
  expect(result.current.themeId).toBe("dark");

  await act(async () =>
    resolveLanguage({
      ...settingsWithCompact(false),
      ui: { compactListItems: false, language: "ja" },
    }),
  );
  expect(result.current.themeId).toBe("dark");
  await act(async () =>
    resolveTheme({
      ...settingsWithCompact(false),
      theme: "dark",
      ui: { compactListItems: false, language: "ja" },
    }),
  );
  expect(result.current.language).toBe("ja");
  expect(result.current.themeId).toBe("dark");
  unmount();
});

it("keeps a settings load failure visible until settings can be loaded again", async () => {
  settingsMocks.get.mockRejectedValueOnce("settings file is invalid");
  const { result, unmount } = renderHook(() => useSettings());

  await waitFor(() => {
    expect(toastMocks.error).toHaveBeenCalledWith(
      "Failed to load settings: settings file is invalid",
      { id: "settings-load-error", duration: Infinity },
    );
  });

  settingsMocks.get.mockResolvedValueOnce({
    theme: "nord",
    ui: { compactListItems: false, language: "en" },
    keybindings: {},
    targetGroups: [],
    currentTargetGroupId: null,
  });
  await result.current.reloadSettings();
  expect(toastMocks.dismiss).toHaveBeenCalledWith("settings-load-error");
  unmount();
});
