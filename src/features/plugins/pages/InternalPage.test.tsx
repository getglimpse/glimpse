// @vitest-environment jsdom

import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PluginInternalPageManifest } from "@/types";

import { PluginInternalPageView } from "./InternalPage";
import { getPluginRuntime } from "../runtime";

const fileApiMocks = vi.hoisted(() => ({
  selectOutputDirectory: vi.fn(),
  writePluginTextOutput: vi.fn(),
}));

vi.mock("@/api/file", () => ({
  fileApi: fileApiMocks,
}));

vi.mock("../runtime", () => ({
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
  fileApiMocks.selectOutputDirectory.mockReset();
  fileApiMocks.writePluginTextOutput.mockReset();
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
    expect(screen.queryByRole("heading", { name: "Test Plugin" })).toBeNull();
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
          runLabel,
          createModeLabel,
          overwriteModeLabel,
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
          runLabel?: ReactNode;
          createModeLabel?: ReactNode;
          overwriteModeLabel?: ReactNode;
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
            <div>{runLabel}</div>
            <div>{createModeLabel}</div>
            <div>{overwriteModeLabel}</div>
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
            outputModes: ["create", "overwrite"],
            runLabel: "実行",
            createModeLabel: "新規作成",
            overwriteModeLabel: "上書き",
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

    render(<PluginInternalPageView page={page} pluginId="converter-plugin" />);

    expect(screen.getByText("日本語の説明")).toBeTruthy();
    expect(screen.getByText("ここにファイルをドロップ")).toBeTruthy();
    expect(screen.getByText("ファイルを選択")).toBeTruthy();
    expect(screen.getByText("実行")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByLabelText("Converted filename prefix")).toBeTruthy();
    expect(screen.getByText("新規作成")).toBeTruthy();
    expect(screen.getByText("上書き")).toBeTruthy();
    expect(screen.getByText("結果")).toBeTruthy();
    expect(screen.getByText("表示")).toBeTruthy();
    expect(screen.getByText("クリア")).toBeTruthy();
    expect(screen.getByText("ファイル")).toBeTruthy();
    expect(screen.getByText("サイズ")).toBeTruthy();
    expect(screen.getByText("パス")).toBeTruthy();
    expect(screen.getByText("出力はまだありません")).toBeTruthy();
  });

  it("runs a Form tab with default values and copies its result", async () => {
    const generatePassword = vi.fn(() => "secure-password");
    const writeText = vi.fn(() => Promise.resolve());
    fileApiMocks.selectOutputDirectory.mockResolvedValue({
      path: "C:/Exports",
      token: "exports-token",
    });
    fileApiMocks.writePluginTextOutput
      .mockResolvedValueOnce(
        "C:/Exports/password-generator-plugin-generator-latest.txt",
      )
      .mockResolvedValueOnce(
        "C:/Exports/password-generator-plugin-generator-results.txt",
      );

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.mocked(getPluginRuntime).mockReturnValue({
      pluginId: "password-generator-plugin",
      version: "0.2.0",
      pages: new Map(),
      actions: {
        generatePassword: { handler: generatePassword },
      },
      components: {
        ActionPlayground: () => <div>Playground</div>,
        FileDropConverter: () => <div>Converter</div>,
        OutputDirectorySettings: () => <div>Settings</div>,
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
      id: "plugin:password-generator-plugin",
      title: "Password Generator",
      pageDefinition: {
        id: "plugin:password-generator-plugin",
        tabs: [
          {
            id: "generator",
            type: "form",
            title: "Generator",
            action: "generatePassword",
            submitLabel: "Generate",
            fields: [
              {
                id: "length",
                type: "number",
                control: "number",
                label: "Length",
                default: 20,
                min: 8,
                max: 128,
              },
              {
                id: "symbols",
                type: "boolean",
                control: "checkbox",
                label: "Symbols",
                default: true,
              },
            ],
            result: {
              type: "text",
              copy: true,
              copyLabel: "Copy password",
              copiedLabel: "Copied",
              saveLatestLabel: "Save latest result",
              saveAllLabel: "Save all results",
              resetLabel: "Reset results",
            },
          },
        ],
      },
    };

    const { container } = render(
      <PluginInternalPageView
        page={page}
        pluginId="password-generator-plugin"
      />,
    );

    const results = container.querySelector(
      "[data-glimpse-plugin-form-results]",
    );
    const action = container.querySelector("[data-glimpse-plugin-form-action]");
    const parameters = container.querySelector(
      "[data-glimpse-plugin-form-parameters]",
    );

    expect(results).toBeTruthy();
    expect(action).toBeTruthy();
    expect(parameters).toBeTruthy();
    if (!results || !action || !parameters) {
      throw new Error("Expected Form layout sections to render");
    }
    expect(
      results.compareDocumentPosition(parameters) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(results.parentElement?.contains(action)).toBe(true);
    expect(parameters.contains(action)).toBe(false);

    expect(screen.getByText("Parameters")).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Length" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Symbols" })).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Save results",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Reset results",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await screen.findByText("secure-password");
    expect(generatePassword).toHaveBeenCalledWith({
      length: 20,
      symbols: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("secure-password");
      expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.getAllByText("secure-password")).toHaveLength(2);
    });
    expect(screen.getByText("[1]:")).toBeTruthy();
    expect(screen.getByText("[2]:")).toBeTruthy();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Save results" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Save latest result" }),
    );
    await waitFor(() => {
      expect(fileApiMocks.writePluginTextOutput).toHaveBeenNthCalledWith(1, {
        grantToken: "exports-token",
        fileName: "password-generator-plugin-generator-latest.txt",
        body: "secure-password",
      });
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Save results" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Save all results" }),
    );
    await waitFor(() => {
      expect(fileApiMocks.writePluginTextOutput).toHaveBeenNthCalledWith(2, {
        grantToken: "exports-token",
        fileName: "password-generator-plugin-generator-results.txt",
        body: "secure-password\nsecure-password",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset results" }));
    expect(screen.queryAllByText("secure-password")).toHaveLength(0);
    expect(
      (
        screen.getByRole("button", {
          name: "Save results",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("orders v0.2 generated tabs as Settings then Info", () => {
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
