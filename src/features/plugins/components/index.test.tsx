// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n/I18nProvider";

import {
  createPluginComponents,
  PluginPageActivityProvider,
  type PluginActions,
} from ".";
import { ConvertedFilePrefixSettings } from "./converter";
import { publishPluginPlaygroundExecution } from "../events/playground";

const clipboardMocks = vi.hoisted(() => ({
  copyText: vi.fn(),
}));

const fileMocks = vi.hoisted(() => ({
  fileApi: {
    getDefaultDownloadDirectory: vi.fn(async () => "C:/Users/j/Downloads"),
    getPluginOutputDirectoryGrant: vi.fn(
      async (): Promise<{ path: string; token: string } | null> => ({
        path: "C:/Users/j/Downloads",
        token: "output-token",
      }),
    ),
    selectOutputDirectory: vi.fn(
      async (): Promise<{ path: string; token: string } | null> => ({
        path: "C:/Converted",
        token: "selected-token",
      }),
    ),
    claimPluginTextInputs: vi.fn(async (paths: string[]) =>
      paths.map((path) => ({ path, token: "input-token" })),
    ),
    selectPluginTextInputs: vi.fn(async () => [
      { path: "C:/Inbox/notes.txt", token: "picked-token" },
    ]),
    readPluginTextInput: vi.fn(async () => "hello from path"),
    writePluginTextOutput: vi.fn(
      async ({ fileName }) => `C:/Users/j/Downloads/${fileName}`,
    ),
    overwritePluginTextInput: vi.fn(async () => "C:/Inbox/notes.txt"),
  },
}));

const openerMocks = vi.hoisted(() => ({
  openerApi: {
    revealInExplorer: vi.fn(),
  },
}));

const windowMocks = vi.hoisted(() => {
  const dragDropHandlers: Array<(event: unknown) => void> = [];

  return {
    dragDropHandlers,
    reset: () => {
      dragDropHandlers.splice(0);
    },
    getCurrentWindow: vi.fn(() => ({
      onDragDropEvent: vi.fn(async (handler) => {
        dragDropHandlers.push(handler);

        return () => {
          const index = dragDropHandlers.indexOf(handler);

          if (index >= 0) {
            dragDropHandlers.splice(index, 1);
          }
        };
      }),
    })),
  };
});

const settingsMocks = vi.hoisted(() => {
  const createSettings = () => ({
    theme: "nord",
    commands: {
      policyMode: "blacklist",
      whitelist: [],
      blacklist: [],
      trustedDirectories: [],
    },
    plugins: {},
    targetGroups: [],
    currentTargetGroupId: null,
    ui: {
      compactListItems: false,
      closeToTray: true,
      language: "en",
    },
    experimental: {
      captureSelectedTextOnActivation: false,
    },
    keybindings: {},
  });

  let currentSettings = createSettings();

  return {
    getSettings: () => currentSettings,
    setSettings: (settings: ReturnType<typeof createSettings>) => {
      currentSettings = settings;
    },
    resetSettings: () => {
      currentSettings = createSettings();
    },
    settingsApi: {
      get: vi.fn(async () => currentSettings),
      set: vi.fn(async (partial) => {
        currentSettings = {
          ...currentSettings,
          ...partial,
        };

        return currentSettings;
      }),
      selectTargetDirectory: vi.fn(async () => "C:/Converted"),
    },
  };
});

vi.mock("@/utils/clipboard", () => ({
  copyText: clipboardMocks.copyText,
}));

vi.mock("@/api/settings", () => ({
  settingsApi: settingsMocks.settingsApi,
}));

vi.mock("@/api/file", () => ({
  fileApi: fileMocks.fileApi,
}));

vi.mock("@/api/opener", () => ({
  openerApi: openerMocks.openerApi,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: windowMocks.getCurrentWindow,
}));

afterEach(() => {
  clipboardMocks.copyText.mockReset();
  fileMocks.fileApi.getDefaultDownloadDirectory.mockClear();
  fileMocks.fileApi.getPluginOutputDirectoryGrant.mockClear();
  fileMocks.fileApi.selectOutputDirectory.mockClear();
  fileMocks.fileApi.claimPluginTextInputs.mockClear();
  fileMocks.fileApi.selectPluginTextInputs.mockClear();
  fileMocks.fileApi.readPluginTextInput.mockClear();
  fileMocks.fileApi.writePluginTextOutput.mockClear();
  fileMocks.fileApi.overwritePluginTextInput.mockClear();
  openerMocks.openerApi.revealInExplorer.mockClear();
  windowMocks.getCurrentWindow.mockClear();
  windowMocks.reset();
  settingsMocks.settingsApi.get.mockClear();
  settingsMocks.settingsApi.set.mockClear();
  settingsMocks.settingsApi.selectTargetDirectory.mockClear();
  settingsMocks.resetSettings();
  cleanup();
});

describe("pluginComponents", () => {
  it("runs CalculationPanel actions and renders calculation history", async () => {
    const actions: PluginActions = {
      calculate: {
        handler: (input) => {
          expect(input).toBe("2 + 2");
          return 4;
        },
      },
    };
    const { CalculationPanel } = createPluginComponents(actions);

    render(
      <CalculationPanel
        action="calculate"
        examples={["2 + 2"]}
        input={{ placeholder: "Expression" }}
        result={{ copyable: true }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Expression"), {
      target: { value: "2 + 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("4")).toBeTruthy();
    expect(screen.getAllByText("2 + 2")).toHaveLength(2);
  });

  it("renders a missing action error in CalculationPanel history", async () => {
    const { CalculationPanel } = createPluginComponents({});

    render(
      <CalculationPanel
        action="missing"
        input={{ placeholder: "Expression" }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Expression"), {
      target: { value: "1 + 1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(screen.getByText("Missing action: missing")).toBeTruthy();
    });
  });

  it("renders Details content as a regular section", () => {
    const { Details } = createPluginComponents({});

    render(
      <Details title="API details">
        <div>ctx.registerPage()</div>
      </Details>,
    );

    expect(screen.queryByRole("button", { name: "API details" })).toBeNull();
    expect(screen.getByRole("heading", { name: "API details" })).toBeTruthy();
    expect(screen.getByText("ctx.registerPage()")).toBeTruthy();
  });

  it("renders Markdown with readable plugin page typography", () => {
    const { Markdown } = createPluginComponents({});

    const { container } = render(
      <Markdown
        content={
          "Before `>` and after `today`.\n\n- Adds preview support for `.pdf` files."
        }
      />,
    );

    const markdown = container.firstElementChild;

    expect(markdown?.className).toContain("prose-p:text-text-main");
    expect(markdown?.className).toContain("select-text");
    expect(markdown?.className).toContain("[--tw-prose-body:var(--text-main)]");
    expect(markdown?.className).toContain("prose-code:text-text-main");
    expect(markdown?.className).toContain("prose-code:before:content-none");
    expect(screen.getByText(/Adds preview support/).className).toContain(
      "text-text-main",
    );
    expect(screen.getByText(">")).toBeTruthy();
    expect(screen.getByText("today")).toBeTruthy();
  });

  it("renders Tabs with a constrained scrollable content area", () => {
    const { Tabs } = createPluginComponents({});

    const { container } = render(
      <Tabs
        items={[
          {
            id: "playground",
            title: "Playground",
            content: <div>Playground content</div>,
          },
          {
            id: "info",
            title: "Info",
            content: <div>Info content</div>,
          },
        ]}
      />,
    );

    expect(container.firstElementChild?.className).toContain("h-full");
    expect(container.firstElementChild?.className).toContain("min-h-0");
    expect(
      screen.getByText("Playground content").parentElement?.className,
    ).toContain("overflow-y-auto");
    expect(
      screen.getByText("Playground content").parentElement?.className,
    ).toContain("overflow-x-hidden");
  });

  it("preserves Converter results while switching page tabs", async () => {
    const { FileDropConverter, Tabs } = createPluginComponents(
      { convertFile: { handler: () => "converted" } },
      "file-converter-plugin",
    );
    const { container } = render(
      <Tabs
        items={[
          {
            id: "converter",
            title: "Converter",
            content: <FileDropConverter action="convertFile" />,
          },
          {
            id: "info",
            title: "Info",
            content: <div>Info content</div>,
          },
        ]}
      />,
    );
    const dropZone = container.querySelector(
      "[data-glimpse-plugin-file-drop-converter]",
    );

    fireEvent.drop(dropZone!, {
      dataTransfer: {
        files: [new File(["hello"], "notes.txt", { type: "text/plain" })],
      },
    });
    expect(await screen.findByText("notes.converted.txt")).toBeTruthy();

    await waitFor(() => {
      expect(windowMocks.dragDropHandlers).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    await waitFor(() => {
      expect(windowMocks.dragDropHandlers).toHaveLength(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Converter" }));

    expect(screen.getByText("notes.converted.txt")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Save notes.converted.txt" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(windowMocks.dragDropHandlers).toHaveLength(1);
    });
  });

  it("wraps long KeyValueList values inside the plugin page width", () => {
    const { KeyValueList } = createPluginComponents({});

    render(
      <KeyValueList
        rows={[
          ["Page", "plugin:very-long-plugin-page-identifier-that-should-wrap"],
        ]}
      />,
    );

    const value = screen.getByText(
      "plugin:very-long-plugin-page-identifier-that-should-wrap",
    );
    const row = value.parentElement;

    expect(row?.className).toContain("min-w-0");
    expect(row?.className).toContain(
      "grid-cols-[minmax(0,8rem)_minmax(0,1fr)]",
    );
    expect(value.className).toContain("min-w-0");
    expect(value.className).toContain("break-all");
  });

  it("fills and runs ActionPlayground examples", async () => {
    const actions: PluginActions = {
      hello: {
        handler: (input) => `Hello, ${input}!`,
      },
    };
    const { ActionPlayground } = createPluginComponents(actions);

    render(
      <ActionPlayground
        action="hello"
        placeholder="Name"
        examples={["Ada"]}
        submitLabel="Say hello"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ada" }));
    expect(
      (screen.getByPlaceholderText("Name") as HTMLInputElement).value,
    ).toBe("Ada");
    expect(screen.getByPlaceholderText("Name")).toBe(document.activeElement);

    fireEvent.click(screen.getByRole("button", { name: "Say hello" }));

    expect(await screen.findByText("Hello, Ada!")).toBeTruthy();
  });

  it("renders ActionPlayground history in chat order", async () => {
    const actions: PluginActions = {
      hello: {
        handler: (input) => `Hello, ${input}!`,
      },
    };
    const { ActionPlayground } = createPluginComponents(actions);

    render(
      <ActionPlayground action="hello" placeholder="Name" submitLabel="Run" />,
    );

    fireEvent.change(screen.getByPlaceholderText("Name"), {
      target: { value: "Ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("Hello, Ada!");

    fireEvent.change(screen.getByPlaceholderText("Name"), {
      target: { value: "Bob" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("Hello, Bob!");

    const firstResult = screen.getByText("Hello, Ada!").closest("button");
    const secondResult = screen.getByText("Hello, Bob!").closest("button");

    expect(firstResult).not.toBeNull();
    expect(secondResult).not.toBeNull();
    expect(
      firstResult!.compareDocumentPosition(secondResult!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("adds matching search-bar executions to ActionPlayground history", async () => {
    const { ActionPlayground } = createPluginComponents(
      {},
      "calculator-plugin",
    );

    render(
      <ActionPlayground
        action="calculate"
        placeholder="Expression"
        submitLabel="Run"
      />,
    );

    publishPluginPlaygroundExecution({
      pluginId: "other-plugin",
      actionId: "calculate",
      input: "1 + 1",
      result: "2",
      source: "search",
    });
    publishPluginPlaygroundExecution({
      pluginId: "calculator-plugin",
      actionId: "other-action",
      input: "2 + 2",
      result: "4",
      source: "search",
    });
    publishPluginPlaygroundExecution({
      pluginId: "calculator-plugin",
      actionId: "calculate",
      input: "3 + 3",
      result: "6",
      source: "search",
    });

    expect(await screen.findByText("3 + 3")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.queryByText("1 + 1")).toBeNull();
    expect(screen.queryByText("2 + 2")).toBeNull();
  });

  it("adds failed search-bar executions to ActionPlayground history", async () => {
    const { ActionPlayground } = createPluginComponents(
      {},
      "calculator-plugin",
    );

    render(
      <ActionPlayground
        action="calculate"
        placeholder="Expression"
        submitLabel="Run"
      />,
    );

    publishPluginPlaygroundExecution({
      pluginId: "calculator-plugin",
      actionId: "calculate",
      input: "invalid",
      result: "Invalid expression",
      error: true,
      source: "search",
    });

    expect(await screen.findByText("invalid")).toBeTruthy();
    expect(screen.getByText("Invalid expression")).toBeTruthy();
    expect(screen.getByText("Error:")).toBeTruthy();
  });

  it("adds search-bar executions only to the active Playground instance", async () => {
    const { ActionPlayground } = createPluginComponents(
      {},
      "calculator-plugin",
    );

    render(
      <>
        <PluginPageActivityProvider active>
          <ActionPlayground
            action="calculate"
            placeholder="Active Playground"
            submitLabel="Run active"
          />
        </PluginPageActivityProvider>
        <PluginPageActivityProvider active={false}>
          <ActionPlayground
            action="calculate"
            placeholder="Inactive Playground"
            submitLabel="Run inactive"
          />
        </PluginPageActivityProvider>
      </>,
    );

    publishPluginPlaygroundExecution({
      pluginId: "calculator-plugin",
      actionId: "calculate",
      input: "4 + 4",
      result: "8",
      source: "search",
    });

    expect(await screen.findByText("4 + 4")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.queryByText("Active Playground")).toBeNull();
    expect(screen.getByText("Inactive Playground")).toBeTruthy();
  });

  it("keeps ActionPlayground messages in a scroll view above the composer", () => {
    const { ActionPlayground } = createPluginComponents({});

    const { container } = render(
      <ActionPlayground action="hello" placeholder="Name" submitLabel="Run" />,
    );

    expect(
      container.querySelector("[data-glimpse-plugin-playground]")?.className,
    ).toContain("overflow-hidden");
    expect(
      container.querySelector("[data-glimpse-plugin-playground-messages]")
        ?.className,
    ).toContain("min-h-0 flex-1");
    expect(
      container.querySelector("[data-glimpse-plugin-playground-messages]")
        ?.className,
    ).toContain("overflow-y-auto");
    expect(
      container.querySelector("[data-glimpse-plugin-playground-composer]")
        ?.className,
    ).toContain("shrink-0");
  });

  it("keeps ActionPlayground input key events inside the playground", () => {
    const actions: PluginActions = {
      hello: {
        handler: () => "Hello!",
      },
    };
    const { ActionPlayground } = createPluginComponents(actions);
    const onKeyDown = vi.fn();

    render(
      <div onKeyDown={onKeyDown}>
        <ActionPlayground action="hello" placeholder="Name" submitLabel="Run" />
      </div>,
    );

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });

    screen.getByPlaceholderText("Name").dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("saves ActionSettings search result copy settings", async () => {
    const actions: PluginActions = {
      hello: {
        handler: () => "Copied result",
      },
    };
    const { ActionSettings } = createPluginComponents(actions, "copy-plugin");

    render(<ActionSettings action="hello" />);

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Copy successful search result",
      }),
    );

    await waitFor(() => {
      expect(settingsMocks.settingsApi.set).toHaveBeenCalledWith({
        plugins: {
          "copy-plugin": {
            copySuccessfulSearchResults: {
              hello: true,
            },
          },
        },
      });
    });
  });

  it("converts a dropped file without saving until a result action is clicked", async () => {
    const convertFile = vi.fn(() => ({
      fileName: "notes.converted.txt",
      body: "HELLO\n",
    }));
    const { FileDropConverter } = createPluginComponents(
      { convertFile: { handler: convertFile } },
      "file-converter-plugin",
    );
    const { container } = render(<FileDropConverter action="convertFile" />);
    fireEvent.drop(
      container.querySelector("[data-glimpse-plugin-file-drop-converter]")!,
      {
        dataTransfer: {
          files: [new File(["hello"], "notes.txt", { type: "text/plain" })],
        },
      },
    );

    expect(await screen.findByText("notes.converted.txt")).toBeTruthy();
    expect(convertFile).toHaveBeenCalledTimes(1);
    expect(fileMocks.fileApi.writePluginTextOutput).not.toHaveBeenCalled();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy();
    expect(screen.getByText("6 B")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy notes.converted.txt" }),
    );
    await waitFor(() =>
      expect(clipboardMocks.copyText).toHaveBeenCalledWith("HELLO\n"),
    );
    expect(fileMocks.fileApi.writePluginTextOutput).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Save notes.converted.txt" }),
    );
    await waitFor(() =>
      expect(fileMocks.fileApi.writePluginTextOutput).toHaveBeenCalledWith({
        grantToken: "output-token",
        fileName: "notes.converted.txt",
        body: "HELLO\n",
      }),
    );
    expect(screen.getByText("Saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(openerMocks.openerApi.revealInExplorer).toHaveBeenCalledWith(
      "C:/Users/j/Downloads/notes.converted.txt",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove notes.converted.txt from results",
      }),
    );
    expect(screen.getByText("No output yet")).toBeTruthy();
  });

  it("offers localized output modes beside Results", async () => {
    const { FileDropConverter } = createPluginComponents(
      { convertFile: { handler: () => "converted" } },
      "file-converter-plugin",
    );
    render(
      <I18nProvider locale="ja">
        <FileDropConverter action="convertFile" />
      </I18nProvider>,
    );
    const group = await screen.findByRole("group", { name: "出力方法" });
    expect(group.parentElement).toBe(
      screen.getByRole("button", { name: "すべて保存" }).parentElement,
    );
    expect(screen.getByRole("button", { name: "新規作成" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "上書き" })).toBeTruthy();
  });

  it("overwrites only when the saved result maps to an authorized source", async () => {
    const { FileDropConverter } = createPluginComponents(
      { convertFile: { handler: () => "OVERWRITTEN" } },
      "file-converter-plugin",
    );
    render(<FileDropConverter action="convertFile" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose File" }));
    const save = await screen.findByRole("button", {
      name: "Save notes.converted.txt",
    });
    expect(fileMocks.fileApi.overwritePluginTextInput).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    fireEvent.click(save);
    await waitFor(() =>
      expect(fileMocks.fileApi.overwritePluginTextInput).toHaveBeenCalledWith({
        grantToken: "picked-token",
        body: "OVERWRITTEN",
      }),
    );
    expect(fileMocks.fileApi.writePluginTextOutput).not.toHaveBeenCalled();
  });

  it("converts a Tauri file drop and keeps its input grant for deferred overwrite", async () => {
    const convertFile = vi.fn(() => ({
      fileName: "notes.converted.txt",
      body: "DONE",
    }));
    const { FileDropConverter } = createPluginComponents(
      { convertFile: { handler: convertFile } },
      "file-converter-plugin",
    );
    render(<FileDropConverter action="convertFile" />);
    await waitFor(() =>
      expect(windowMocks.dragDropHandlers.length).toBeGreaterThan(0),
    );
    windowMocks.dragDropHandlers[0]?.({
      payload: { type: "drop", paths: ["C:/Inbox/notes.txt"] },
    });
    await screen.findByRole("button", { name: "Save notes.converted.txt" });
    expect(fileMocks.fileApi.readPluginTextInput).toHaveBeenCalledWith(
      "input-token",
    );
    expect(convertFile).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: "C:/Inbox/notes.txt" }),
    );
    expect(fileMocks.fileApi.overwritePluginTextInput).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save notes.converted.txt" }),
    );
    await waitFor(() =>
      expect(fileMocks.fileApi.overwritePluginTextInput).toHaveBeenCalledWith({
        grantToken: "input-token",
        body: "DONE",
      }),
    );
  });

  it("asks for reconversion if the original grant expires before overwrite", async () => {
    fileMocks.fileApi.overwritePluginTextInput.mockRejectedValueOnce(
      new Error("invalid plugin file grant"),
    );
    const { FileDropConverter } = createPluginComponents(
      { convertFile: { handler: () => "converted" } },
      "file-converter-plugin",
    );
    render(<FileDropConverter action="convertFile" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose File" }));
    await screen.findByRole("button", { name: "Save notes.converted.txt" });
    fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save notes.converted.txt" }),
    );
    expect(
      await screen.findByText(/Select and convert the original file again/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Save notes.converted.txt" }),
    ).toBeTruthy();
  });

  it("converts pasted text and copies without writing a file", async () => {
    const convertFile = vi.fn(() => "CONVERTED");
    const { FileDropConverter } = createPluginComponents(
      { convertFile: { handler: convertFile } },
      "file-converter-plugin",
    );
    render(<FileDropConverter action="convertFile" />);
    expect(screen.queryByLabelText("Paste text to convert")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to text input" }),
    );
    expect(screen.queryByRole("button", { name: "Choose File" })).toBeNull();
    expect(screen.queryByText("Paste text to convert")).toBeNull();
    fireEvent.paste(screen.getByLabelText("Paste text to convert"), {
      clipboardData: { getData: () => "hello" },
    });
    expect(await screen.findByText("pasted-text.converted.txt")).toBeTruthy();
    expect(convertFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "pasted-text.txt", text: "hello" }),
    );
    expect(
      (screen.getByRole("button", { name: "Overwrite" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy pasted-text.converted.txt" }),
    );
    await waitFor(() =>
      expect(clipboardMocks.copyText).toHaveBeenCalledWith("CONVERTED"),
    );
    expect(fileMocks.fileApi.writePluginTextOutput).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to file input" }),
    );
    expect(screen.getByRole("button", { name: "Choose File" })).toBeTruthy();
  });

  it("keeps failed inputs for retry and ignores stale asynchronous conversions", async () => {
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const convertFile = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockImplementationOnce(() => "SECOND");
    const { FileDropConverter } = createPluginComponents(
      { convertFile: { handler: convertFile } },
      "file-converter-plugin",
    );
    const { container } = render(<FileDropConverter action="convertFile" />);
    const dropZone = container.querySelector(
      "[data-glimpse-plugin-file-drop-converter]",
    )!;
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [new File(["first"], "first.txt", { type: "text/plain" })],
      },
    });
    await waitFor(() => expect(convertFile).toHaveBeenCalledTimes(1));
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [new File(["second"], "second.txt", { type: "text/plain" })],
      },
    });
    expect(await screen.findByText("second.converted.txt")).toBeTruthy();
    finish("FIRST");
    await waitFor(() =>
      expect(screen.queryByText("first.converted.txt")).toBeNull(),
    );
  });

  it("keeps a failed conversion available for retry", async () => {
    const convertFile = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("conversion failed");
      })
      .mockImplementationOnce(() => "OK");
    const { FileDropConverter } = createPluginComponents(
      { convertFile: { handler: convertFile } },
      "file-converter-plugin",
    );
    render(<FileDropConverter action="convertFile" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose File" }));
    expect(await screen.findByText("conversion failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("notes.converted.txt")).toBeTruthy();
  });

  it("saves all unsaved rows and leaves failed rows for retry", async () => {
    fileMocks.fileApi.writePluginTextOutput.mockRejectedValueOnce(
      new Error("disk full"),
    );
    const { FileDropConverter } = createPluginComponents(
      {
        convertFile: {
          handler: () => [
            { fileName: "one.txt", body: "one" },
            { fileName: "two.txt", body: "two" },
          ],
        },
      },
      "file-converter-plugin",
    );
    render(<FileDropConverter action="convertFile" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose File" }));
    await screen.findByRole("button", { name: "Save one.txt" });
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await waitFor(() =>
      expect(fileMocks.fileApi.writePluginTextOutput).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByText("disk full")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save one.txt" })).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await waitFor(() =>
      expect(fileMocks.fileApi.writePluginTextOutput).toHaveBeenCalledTimes(3),
    );
  });

  it("does not discard a result when the output picker is cancelled", async () => {
    fileMocks.fileApi.getPluginOutputDirectoryGrant.mockResolvedValueOnce(null);
    fileMocks.fileApi.selectOutputDirectory.mockResolvedValueOnce(null);
    const { FileDropConverter } = createPluginComponents(
      { convertFile: { handler: () => "converted" } },
      "file-converter-plugin",
    );
    render(<FileDropConverter action="convertFile" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose File" }));
    await screen.findByRole("button", { name: "Save notes.converted.txt" });
    fireEvent.click(
      screen.getByRole("button", { name: "Save notes.converted.txt" }),
    );
    await waitFor(() =>
      expect(fileMocks.fileApi.selectOutputDirectory).toHaveBeenCalled(),
    );
    expect(
      screen.getByRole("button", { name: "Save notes.converted.txt" }),
    ).toBeTruthy();
    expect(fileMocks.fileApi.writePluginTextOutput).not.toHaveBeenCalled();
  });

  it("uses the configured filename prefix before a result is saved", async () => {
    await settingsMocks.settingsApi.set({
      plugins: {
        "file-converter-plugin": {
          preferences: { convertedFilePrefix: ".ready" },
        },
      },
    });
    const { FileDropConverter } = createPluginComponents(
      { convertFile: { handler: () => "converted" } },
      "file-converter-plugin",
    );
    render(<FileDropConverter action="convertFile" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose File" }));
    expect(await screen.findByText("notes.ready.txt")).toBeTruthy();
    expect(fileMocks.fileApi.writePluginTextOutput).not.toHaveBeenCalled();
  });

  it("rejects non-text files before invoking the converter", async () => {
    const convertFile = vi.fn(() => "SHOULD NOT RUN");
    const { FileDropConverter } = createPluginComponents(
      { convertFile: { handler: convertFile } },
      "file-converter-plugin",
    );
    const { container } = render(<FileDropConverter action="convertFile" />);
    fireEvent.drop(
      container.querySelector("[data-glimpse-plugin-file-drop-converter]")!,
      {
        dataTransfer: {
          files: [new File(["a,b"], "data.csv", { type: "text/csv" })],
        },
      },
    );
    expect(
      await screen.findByText("Only text and Markdown files are supported"),
    ).toBeTruthy();
    expect(convertFile).not.toHaveBeenCalled();
  });

  it("preserves explicit manual execution without saving on Run", async () => {
    const convertFile = vi.fn(() => "converted");
    const { FileDropConverter } = createPluginComponents(
      { convertFile: { handler: convertFile } },
      "file-converter-plugin",
    );
    render(<FileDropConverter action="convertFile" execution="manual" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose File" }));
    expect(await screen.findByRole("button", { name: "Run" })).toBeTruthy();
    expect(convertFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(
      await screen.findByRole("button", { name: "Save notes.converted.txt" }),
    ).toBeTruthy();
    expect(fileMocks.fileApi.writePluginTextOutput).not.toHaveBeenCalled();
  });

  it("saves OutputDirectorySettings as a plugin preference", async () => {
    const { OutputDirectorySettings } = createPluginComponents(
      {},
      "file-converter-plugin",
    );
    render(
      <OutputDirectorySettings
        label="Output directory"
        chooseDirectoryLabel="Change Output Directory"
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Change Output Directory" }),
    );
    await waitFor(() =>
      expect(settingsMocks.settingsApi.set).toHaveBeenCalledWith({
        plugins: {
          "file-converter-plugin": {
            preferences: { downloadDirectory: "C:/Converted" },
          },
        },
      }),
    );
  });

  it("does not accept a typed path as an output permission", async () => {
    const { OutputDirectorySettings } = createPluginComponents(
      {},
      "file-converter-plugin",
    );
    render(<OutputDirectorySettings label="Output directory" />);
    const input = (await screen.findByLabelText(
      "Output directory",
    )) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
  });

  it("saves a filename prefix and resets blank input to .converted", async () => {
    render(<ConvertedFilePrefixSettings pluginId="file-converter-plugin" />);
    const input = (await screen.findByLabelText(
      "Converted filename prefix",
    )) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe(".converted"));
    fireEvent.change(input, { target: { value: ".custom" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(settingsMocks.getSettings().plugins).toEqual({
        "file-converter-plugin": {
          preferences: { convertedFilePrefix: ".custom" },
        },
      }),
    );
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe(".converted"));
  });

  it("does not auto-copy ActionPlayground results", async () => {
    const actions: PluginActions = {
      hello: {
        handler: () => "Copied result",
      },
    };
    const { ActionPlayground } = createPluginComponents(actions, "copy-plugin");

    render(<ActionPlayground action="hello" submitLabel="Run" />);

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("Copied result")).toBeTruthy();
    expect(clipboardMocks.copyText).not.toHaveBeenCalled();
  });

  it("copies successful ActionPlayground result bubbles when clicked", async () => {
    const actions: PluginActions = {
      hello: {
        handler: () => "Copied result",
      },
    };
    const { ActionPlayground } = createPluginComponents(actions, "copy-plugin");

    render(<ActionPlayground action="hello" submitLabel="Run" />);

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    const resultBubble = await screen.findByRole("button", {
      name: "Copy playground result",
    });
    fireEvent.click(resultBubble);

    await waitFor(() => {
      expect(clipboardMocks.copyText).toHaveBeenCalledWith("Copied result");
    });
  });

  it("does not copy failed ActionPlayground results", async () => {
    const actions: PluginActions = {
      fail: {
        handler: () => {
          throw new Error("Boom");
        },
      },
    };
    const { ActionPlayground } = createPluginComponents(actions, "copy-plugin");

    render(<ActionPlayground action="fail" submitLabel="Run" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("Boom")).toBeTruthy();
    expect(clipboardMocks.copyText).not.toHaveBeenCalled();
  });
});
