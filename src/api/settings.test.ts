import { afterEach, expect, it, vi } from "vitest";

import { settingsApi } from "./settings";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

afterEach(() => invoke.mockReset());

it("sends rapid settings writes in order", async () => {
  const first = deferred();
  const second = deferred();
  invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

  const one = settingsApi.set({ ui: { closeToTray: false } });
  const two = settingsApi.set({ ui: { closeToTray: true } });
  await Promise.resolve();
  expect(invoke).toHaveBeenCalledTimes(1);

  first.resolve({ ui: { closeToTray: false } });
  await one;
  await Promise.resolve();
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenNthCalledWith(2, "set_settings", {
    partial: { ui: { closeToTray: true } },
  });
  second.resolve({ ui: { closeToTray: true } });
  await two;
});

it("continues the settings queue after a failed write", async () => {
  invoke
    .mockRejectedValueOnce("first write failed")
    .mockResolvedValueOnce({ ui: { closeToTray: true } });

  const one = settingsApi.set({ ui: { closeToTray: false } });
  const two = settingsApi.set({ ui: { closeToTray: true } });
  await expect(one).rejects.toBe("first write failed");
  await expect(two).resolves.toEqual({ ui: { closeToTray: true } });
  expect(invoke).toHaveBeenCalledTimes(2);
});
