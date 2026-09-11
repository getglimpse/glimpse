// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n/I18nProvider";
import type { IndexItem } from "@/types";
import { OPEN_LOCAL_PLUGIN_INSTALL_EVENT } from "@/features/plugins/pluginPageEvents";

import { PreviewHeader } from "./PreviewHeader";

const pluginPageItem: IndexItem = {
  id: "internal:plugin",
  title: "Plugin Page",
  updatedAt: "2026-09-09T00:00:00.000Z",
  metadata: {
    aliases: [],
    boost: 0,
    hidden: false,
    star: false,
    tags: [],
  },
  preview: {
    type: "internal",
    page: "plugin",
  },
};

const renderPreviewHeader = () =>
  render(
    <I18nProvider locale="en">
      <PreviewHeader
        item={pluginPageItem}
        selectedIndex={0}
        displayIndex={0}
        previewMode="markdown"
        onPreviewModeChange={vi.fn()}
        onCopyContent={vi.fn(async () => true)}
        onInspectItem={vi.fn()}
      />
    </I18nProvider>,
  );

afterEach(() => {
  cleanup();
});

describe("PreviewHeader plugin page actions", () => {
  it("exposes local plugin install in the page header menu", async () => {
    const openLocalInstall = vi.fn();

    window.addEventListener(OPEN_LOCAL_PLUGIN_INSTALL_EVENT, openLocalInstall);

    try {
      renderPreviewHeader();

      await screen.findByText("Plugin Page");
      fireEvent.pointerDown(screen.getByRole("button", { name: "⋯" }));
      fireEvent.click(
        await screen.findByRole("menuitem", {
          name: "Install local plugin",
        }),
      );

      expect(openLocalInstall).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(
        OPEN_LOCAL_PLUGIN_INSTALL_EVENT,
        openLocalInstall,
      );
    }
  });
});
