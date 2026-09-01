// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PluginInternalPageManifest } from "@/types";

import { PluginInternalPageView } from "./PluginInternalPageView";

vi.mock("./pluginRuntime", () => ({
  getPluginRuntime: vi.fn(() => undefined),
  getPluginRuntimeSnapshot: vi.fn(() => ({
    pluginId: "test-plugin",
    status: "ready",
    logs: [],
    updatedAt: "2026-08-31T00:00:00.000Z",
  })),
  subscribeToPluginRuntimeChanges: vi.fn(() => () => undefined),
}));

afterEach(() => {
  cleanup();
});

describe("PluginInternalPageView", () => {
  it("allows plugin page text selection", () => {
    const page: PluginInternalPageManifest = {
      id: "plugin:test-plugin",
      title: "Test Plugin",
      staticPage: {
        sections: [
          {
            title: "Overview",
            paragraphs: ["Selectable plugin page text"],
          },
        ],
      },
    };

    const { container } = render(
      <PluginInternalPageView page={page} pluginId="test-plugin" />,
    );

    expect(
      container.querySelector("[data-glimpse-plugin-page='test-plugin']")
        ?.className,
    ).toContain("select-text");
    expect(
      container.querySelector("[data-glimpse-plugin-page='test-plugin']")
        ?.className,
    ).toContain("overflow-hidden");
    expect(
      screen.queryByRole("heading", { name: "Test Plugin" }),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(screen.getByText("Selectable plugin page text")).toBeTruthy();
  });
});
