// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PluginInternalPageManifest } from "@/types";

import { PluginInternalPageView } from "./PluginInternalPageView";
import { getPluginRuntime } from "./pluginRuntime";

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
  vi.mocked(getPluginRuntime).mockReturnValue(undefined);
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

  it("renders v0.2 standard playground tabs from page.json", () => {
    vi.mocked(getPluginRuntime).mockReturnValue({
      pluginId: "test-plugin",
      version: "0.2.0",
      pages: new Map(),
      actions: {},
      components: {
        ActionPlayground: ({
          action,
          placeholder,
        }: {
          action: string;
          placeholder?: string;
        }) => (
          <div>
            Playground {action}: {placeholder}
          </div>
        ),
        FileDropConverter: () => <div>Converter</div>,
        OutputDirectorySettings: ({ label }: { label?: ReactNode }) => (
          <div>{label}</div>
        ),
        Tabs: ({
          items,
        }: {
          items?: Array<{ id: string; title: string; content: ReactNode }>;
        }) => (
          <div>
            {items?.map((item) => (
              <section key={item.id}>
                <h2>{item.title}</h2>
                {item.content}
              </section>
            ))}
          </div>
        ),
      },
      context: {
        i18n: {
          language: "en",
          locale: "en",
          t: (_key: string, fallback?: string) => fallback ?? "",
          has: () => false,
        },
      },
    } as never);
    const page: PluginInternalPageManifest = {
      id: "plugin:test-plugin",
      title: "Test Plugin",
      pageDefinition: {
        id: "plugin:test-plugin",
        tabs: [
          {
            id: "playground",
            type: "playground",
            titleFallback: "Playground",
            action: "calculate",
            inputPlaceholderFallback: "Expression",
          },
        ],
      },
    };

    const { container } = render(
      <PluginInternalPageView page={page} pluginId="test-plugin" />,
    );

    expect(screen.getByRole("heading", { name: "Info" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Playground" })).toBeTruthy();
    expect(screen.getByText("Playground calculate: Expression")).toBeTruthy();
    expect(
      Array.from(container.querySelectorAll("h2")).map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["Playground", "Info", "Overview"]);
  });

  it("passes v0.2 converter labels into the standard converter tab", () => {
    vi.mocked(getPluginRuntime).mockReturnValue({
      pluginId: "converter-plugin",
      version: "0.2.0",
      pages: new Map(),
      actions: {},
      components: {
        ActionPlayground: () => <div>Playground</div>,
        FileDropConverter: ({
          description,
          emptyLabel,
          chooseFileLabel,
          resultsLabel,
          revealLabel,
          clearLabel,
          fileColumnLabel,
          sizeColumnLabel,
          pathColumnLabel,
          emptyResultsLabel,
        }: {
          description?: ReactNode;
          emptyLabel?: ReactNode;
          chooseFileLabel?: ReactNode;
          resultsLabel?: ReactNode;
          revealLabel?: ReactNode;
          clearLabel?: ReactNode;
          fileColumnLabel?: ReactNode;
          sizeColumnLabel?: ReactNode;
          pathColumnLabel?: ReactNode;
          emptyResultsLabel?: ReactNode;
        }) => (
          <div>
            <div>{description}</div>
            <div>{emptyLabel}</div>
            <div>{chooseFileLabel}</div>
            <div>{resultsLabel}</div>
            <div>{revealLabel}</div>
            <div>{clearLabel}</div>
            <div>{fileColumnLabel}</div>
            <div>{sizeColumnLabel}</div>
            <div>{pathColumnLabel}</div>
            <div>{emptyResultsLabel}</div>
          </div>
        ),
        OutputDirectorySettings: ({ label }: { label?: ReactNode }) => (
          <div>{label}</div>
        ),
        Tabs: ({
          items,
        }: {
          items?: Array<{ id: string; title: string; content: ReactNode }>;
        }) => (
          <div>
            {items?.map((item) => (
              <section key={item.id}>
                <h2>{item.title}</h2>
                {item.content}
              </section>
            ))}
          </div>
        ),
      },
      context: {
        i18n: {
          language: "en",
          locale: "en",
          t: (_key: string, fallback?: string) => fallback ?? "",
          has: () => false,
        },
      },
    } as never);
    const page: PluginInternalPageManifest = {
      id: "plugin:converter-plugin",
      title: "Converter Plugin",
      pageDefinition: {
        id: "plugin:converter-plugin",
        tabs: [
          {
            id: "converter",
            type: "converter",
            title: "Converter",
            action: "convertFile",
            description: "日本語の説明",
            emptyLabel: "ここにファイルをドロップ",
            chooseFileLabel: "ファイルを選択",
            resultsLabel: "結果",
            revealLabel: "表示",
            clearLabel: "クリア",
            fileColumnLabel: "ファイル",
            sizeColumnLabel: "サイズ",
            pathColumnLabel: "パス",
            emptyResultsLabel: "出力はまだありません",
          },
        ],
      },
    };

    render(
      <PluginInternalPageView
        page={page}
        pluginId="converter-plugin"
      />,
    );

    expect(screen.getByText("日本語の説明")).toBeTruthy();
    expect(screen.getByText("ここにファイルをドロップ")).toBeTruthy();
    expect(screen.getByText("ファイルを選択")).toBeTruthy();
    expect(screen.getByText("結果")).toBeTruthy();
    expect(screen.getByText("表示")).toBeTruthy();
    expect(screen.getByText("クリア")).toBeTruthy();
    expect(screen.getByText("ファイル")).toBeTruthy();
    expect(screen.getByText("サイズ")).toBeTruthy();
    expect(screen.getByText("パス")).toBeTruthy();
    expect(screen.getByText("出力はまだありません")).toBeTruthy();
  });

  it("orders v0.2 generated tabs as execution, Settings, then Info", () => {
    vi.mocked(getPluginRuntime).mockReturnValue({
      pluginId: "settings-plugin",
      version: "0.2.0",
      pages: new Map(),
      actions: {},
      components: {
        ActionPlayground: ({ action }: { action: string }) => (
          <div>Playground {action}</div>
        ),
        FileDropConverter: () => <div>Converter</div>,
        OutputDirectorySettings: ({ label }: { label?: ReactNode }) => (
          <div>{label}</div>
        ),
        Tabs: ({
          items,
        }: {
          items?: Array<{ id: string; title: string; content: ReactNode }>;
        }) => (
          <div>
            {items?.map((item) => (
              <section key={item.id}>
                <h2>{item.title}</h2>
                {item.content}
              </section>
            ))}
          </div>
        ),
      },
      context: {
        i18n: {
          language: "en",
          locale: "en",
          t: (_key: string, fallback?: string) => fallback ?? "",
          has: () => false,
        },
      },
    } as never);
    const page: PluginInternalPageManifest = {
      id: "plugin:settings-plugin",
      title: "Settings Plugin",
      pageDefinition: {
        id: "plugin:settings-plugin",
        tabs: [
          {
            id: "playground",
            type: "playground",
            titleFallback: "Playground",
            action: "run",
          },
        ],
      },
    };

    const { container } = render(
      <PluginInternalPageView
        page={page}
        plugin={{
          id: "settings-plugin",
          name: "Settings Plugin",
          version: "0.2.0",
          apiVersion: "0.2.0",
          settings: {
            outputDirectory: {
              type: "directory",
              labelFallback: "Output directory",
            },
          },
        }}
        pluginId="settings-plugin"
      />,
    );

    expect(
      Array.from(container.querySelectorAll("h2"))
        .map((heading) => heading.textContent)
        .slice(0, 4),
    ).toEqual(["Playground", "Settings", "Info", "Overview"]);
    expect(screen.getByText("Output directory")).toBeTruthy();
  });

  it("renders the generated Info tab when v0.2 page.json has no tabs", () => {
    vi.mocked(getPluginRuntime).mockReturnValue({
      pluginId: "viewer-plugin",
      version: "0.2.0",
      pages: new Map(),
      actions: {},
      components: {
        ActionPlayground: () => <div>Playground</div>,
        FileDropConverter: () => <div>Converter</div>,
        OutputDirectorySettings: ({ label }: { label?: ReactNode }) => (
          <div>{label}</div>
        ),
        Tabs: ({
          items,
        }: {
          items?: Array<{ id: string; title: string; content: ReactNode }>;
        }) => (
          <div>
            {items?.map((item) => (
              <section key={item.id}>
                <h2>{item.title}</h2>
                {item.content}
              </section>
            ))}
          </div>
        ),
      },
      context: {
        i18n: {
          language: "en",
          locale: "en",
          t: (_key: string, fallback?: string) => fallback ?? "",
          has: () => false,
        },
      },
    } as never);
    const page: PluginInternalPageManifest = {
      id: "plugin:viewer-plugin",
      title: "Viewer Plugin",
      pageDefinition: {
        id: "plugin:viewer-plugin",
        tabs: [],
      },
    };

    render(
      <PluginInternalPageView
        page={page}
        plugin={{
          id: "viewer-plugin",
          name: "Viewer Plugin",
          version: "0.2.0",
          apiVersion: "0.2.0",
          contributes: {
            viewers: [{ id: "pdf", title: "PDF Viewer", extensions: ["pdf"] }],
          },
        }}
        pluginId="viewer-plugin"
      />,
    );

    expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(screen.getByText("Viewer Plugin")).toBeTruthy();
    expect(screen.getAllByText("0.2.0")).toHaveLength(2);
    expect(screen.getByText("PDF Viewer")).toBeTruthy();
  });
});
