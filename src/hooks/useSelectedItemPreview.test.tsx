// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { previewApi } from "@/api/preview";
import type { Preview } from "@/types";
import { useSelectedItemPreview } from "./useSelectedItemPreview";
import type { LoadedPreview } from "./useSelectedItemPreview";

vi.mock("@/api/preview", () => ({ previewApi: { getPreview: vi.fn() } }));

const deferred = () => {
  let resolve!: (preview: Preview) => void;
  const promise = new Promise<Preview>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(previewApi.getPreview).mockReset();
});

it.each(["old first", "new first"])(
  "keeps the selected item's preview when requests finish %s",
  async (completionOrder) => {
    vi.useFakeTimers();
    const oldRequest = deferred();
    const newRequest = deferred();
    vi.mocked(previewApi.getPreview).mockImplementation((itemId) =>
      itemId === "old" ? oldRequest.promise : newRequest.promise,
    );

    const { result, rerender, unmount } = renderHook(
      ({ itemId }: { itemId: string }) => {
        const [loaded, setLoaded] = useState<LoadedPreview | null>(null);
        useSelectedItemPreview(itemId, setLoaded);
        return loaded;
      },
      { initialProps: { itemId: "old" } },
    );

    act(() => vi.advanceTimersByTime(80));
    expect(previewApi.getPreview).toHaveBeenCalledWith("old");
    rerender({ itemId: "new" });
    act(() => vi.advanceTimersByTime(80));
    expect(previewApi.getPreview).toHaveBeenCalledWith("new");

    const completeOld = async () => {
      await act(async () => oldRequest.resolve({ type: "raw", content: "old body" }));
    };
    const completeNew = async () => {
      await act(async () => newRequest.resolve({ type: "raw", content: "new body" }));
    };
    if (completionOrder === "old first") {
      await completeOld();
      expect(result.current).toBeNull();
      await completeNew();
    } else {
      await completeNew();
      await completeOld();
    }

    expect(result.current).toEqual({
      itemId: "new",
      preview: { type: "raw", content: "new body" },
    });
    unmount();
  },
);
