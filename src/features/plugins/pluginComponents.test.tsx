// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPluginComponents, type PluginActions } from "./pluginComponents";

const clipboardMocks = vi.hoisted(() => ({
  copyText: vi.fn(),
}));

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
    },
  };
});

vi.mock("@/utils/clipboard", () => ({
  copyText: clipboardMocks.copyText,
}));

vi.mock("@/api/settings", () => ({
  settingsApi: settingsMocks.settingsApi,
}));

afterEach(() => {
  clipboardMocks.copyText.mockReset();
  settingsMocks.settingsApi.get.mockClear();
  settingsMocks.settingsApi.set.mockClear();
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
    expect(markdown?.className).toContain(
      "[--tw-prose-body:var(--text-main)]",
    );
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
    expect(screen.getByText("Playground content").parentElement?.className).toContain(
      "overflow-y-auto",
    );
    expect(
      screen.getByText("Playground content").parentElement?.className,
    ).toContain("overflow-x-hidden");
  });

  it("wraps long KeyValueList values inside the plugin page width", () => {
    const { KeyValueList } = createPluginComponents({});

    render(
      <KeyValueList
        rows={[
          [
            "Page",
            "plugin:very-long-plugin-page-identifier-that-should-wrap",
          ],
        ]}
      />,
    );

    const value = screen.getByText(
      "plugin:very-long-plugin-page-identifier-that-should-wrap",
    );
    const row = value.parentElement;

    expect(row?.className).toContain("min-w-0");
    expect(row?.className).toContain("grid-cols-[minmax(0,8rem)_minmax(0,1fr)]");
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
        <ActionPlayground
          action="hello"
          placeholder="Name"
          submitLabel="Run"
        />
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

  it("does not auto-copy ActionPlayground results", async () => {
    const actions: PluginActions = {
      hello: {
        handler: () => "Copied result",
      },
    };
    const { ActionPlayground } = createPluginComponents(
      actions,
      "copy-plugin",
    );

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
    const { ActionPlayground } = createPluginComponents(
      actions,
      "copy-plugin",
    );

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
    const { ActionPlayground } = createPluginComponents(
      actions,
      "copy-plugin",
    );

    render(<ActionPlayground action="fail" submitLabel="Run" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("Boom")).toBeTruthy();
    expect(clipboardMocks.copyText).not.toHaveBeenCalled();
  });
});
