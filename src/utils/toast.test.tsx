import { describe, expect, it, vi, beforeEach } from "vitest";

import { copyText } from "@/utils/clipboard";
import { toast as sonnerToast } from "sonner";
import { toast } from "./toast";

vi.mock("@/utils/clipboard", () => ({
  copyText: vi.fn(),
}));

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    custom: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
    getHistory: vi.fn(),
    getToasts: vi.fn(),
  });

  return { toast };
});

const mockedSonnerToast = vi.mocked(sonnerToast);
const mockedCopyText = vi.mocked(copyText);

beforeEach(() => {
  mockedSonnerToast.mockClear();
  mockedSonnerToast.success.mockClear();
  mockedSonnerToast.error.mockClear();
  mockedCopyText.mockReset();
});

describe("toast", () => {
  it("does not add a copy action to success toasts by default", () => {
    toast.success("No changes");

    expect(mockedSonnerToast.success).toHaveBeenCalledWith("No changes", {});
  });

  it("adds a copy action to error toasts by default", () => {
    toast.error("Failed to save");

    const options = mockedSonnerToast.error.mock.calls[0]?.[1];

    expect(options?.action).toBeDefined();
  });

  it("copies the toast text when the copy action is clicked", () => {
    toast.error("Failed to save");

    const options = mockedSonnerToast.error.mock.calls[0]?.[1];
    const action = options?.action;

    if (typeof action !== "object" || !action || !("onClick" in action)) {
      throw new Error("Expected toast action");
    }

    (action.onClick as () => void)();

    expect(mockedCopyText).toHaveBeenCalledWith("Failed to save");
  });

  it("allows copy behavior to be opted in or out per toast", () => {
    toast.success("Saved", { copy: true, duration: 1000 });
    toast.error("Expected failure", { copy: false });

    expect(mockedSonnerToast.success.mock.calls[0]?.[1]).toMatchObject({
      duration: 1000,
      action: expect.any(Object),
    });
    expect(mockedSonnerToast.success.mock.calls[0]?.[1]).not.toHaveProperty(
      "copy",
    );
    expect(mockedSonnerToast.error.mock.calls[0]?.[1]).toEqual({});
  });
});
