// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useSettings } from "./useSettings";

const settingsMocks = vi.hoisted(() => ({
  get: vi.fn(),
  onChanged: vi.fn(async () => () => undefined),
}));
const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("@/api/settings", () => ({ settingsApi: settingsMocks }));
vi.mock("@/utils/toast", () => ({ toast: toastMocks }));

afterEach(() => {
  settingsMocks.get.mockReset();
  settingsMocks.onChanged.mockClear();
  toastMocks.error.mockReset();
  toastMocks.dismiss.mockReset();
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
