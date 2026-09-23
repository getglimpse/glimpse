// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { SearchResult } from "@/types";
import { useSearchController } from "./useSearchController";

const searchMocks = vi.hoisted(() => ({
  getItems: vi.fn(),
  getItemsBySourcePath: vi.fn(),
}));

vi.mock("@/api/search", () => ({ searchApi: searchMocks }));
vi.mock("@/features/plugins/registry", () => ({
  subscribeToPluginChanges: () => () => undefined,
}));
vi.mock("@/utils/debugPerf", () => ({
  perf: {
    begin: () => undefined,
    end: () => undefined,
    start: () => undefined,
    stop: () => undefined,
    log: () => undefined,
  },
}));

const searchResult = (id: string) =>
  ({ item: { id, sourcePath: `${id}.md` }, score: 1 }) as SearchResult;

it("keeps the newest results and loading state when older searches finish", async () => {
  const requests = new Map<string, (results: SearchResult[]) => void>();
  searchMocks.getItems.mockImplementation(
    ({ query }: { query: string }) =>
      new Promise<SearchResult[]>((resolve) => requests.set(query, resolve)),
  );
  const { result, unmount } = renderHook(() =>
    useSearchController({
      setSelectedIndex: vi.fn(),
      setLoadedPreview: vi.fn(),
      failedRefreshMessage: (error) => error,
    }),
  );

  await waitFor(() => expect(requests.has("")).toBe(true));
  act(() => result.current.handleQueryChange("a"));
  await waitFor(() => expect(searchMocks.getItems).toHaveBeenCalledTimes(2));
  expect(requests.has("a")).toBe(true);
  act(() => result.current.handleQueryChange("ab"));
  await waitFor(() => expect(requests.has("ab")).toBe(true));

  await act(async () => requests.get("a")?.([searchResult("old")]));
  expect(result.current.isLoading).toBe(true);
  expect(result.current.visibleSearchResults).toEqual([]);

  await act(async () => requests.get("ab")?.([searchResult("new")]));
  expect(result.current.isLoading).toBe(false);
  expect(result.current.visibleSearchResults[0]?.item.id).toBe("new");

  await act(async () => requests.get("")?.([searchResult("oldest")]));
  expect(result.current.visibleSearchResults[0]?.item.id).toBe("new");
  unmount();
});
