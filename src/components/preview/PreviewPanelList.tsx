import { Bug, CircleHelp, FilePlus, Pencil, SearchCode, X } from "lucide-react";
import type { ComponentType } from "react";

import {
  CommandHistoryEntry,
  FileEditorTabState,
  IndexItem,
  Language,
  PreviewPanelHandle,
  PreviewTab,
} from "@/types";
import { ThemeOption } from "@/constants/themes";
import { PreviewPanel } from "./PreviewPanel";
import { getPreviewIcon } from "./PreviewHeader";
import { FileEditorPanel } from "./FileEditorPanel";
import { HelpPanel } from "./HelpPanel";
import { InspectorPanel } from "./InspectorPanel";
import { LIVE_PREVIEW_TAB_ID } from "./constants";
import { parseSearchInput } from "@/features/search/parseSearchInput";
import { useI18nContext } from "@/i18n/I18nProvider";
import { getInternalPageTitle } from "@/utils/internalPageTitle";
import { getHelpContent } from "@/utils/helpContent";
import { cn } from "@/lib/utils";

type FileEditorSaveResult = {
  filePath: string;
  previousFilePath?: string;
  title: string;
  body: string;
  contentMode: FileEditorTabState["contentMode"];
  gjsonDocument?: FileEditorTabState["gjsonDocument"];
};

type Props = {
  tabs: PreviewTab[];
  activeTabId: string;
  lastActivePinnedTabId: string | null;
  selectedIndex: number;
  displayIndex: number;
  isLoading: boolean;
  hasResults: boolean;
  animation: boolean;
  themeId: string;
  themeOptions: ThemeOption[];
  onReloadThemes: () => Promise<void>;
  compactListItems: boolean;
  onLoad: () => void;
  onThemeChange: (themeId: string) => void;
  onCompactListItemsChange: (compact: boolean) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  commandHistory: CommandHistoryEntry[];
  setPreviewRef: (tabId: string, handle: PreviewPanelHandle | null) => void;
  onActivateTab: (tabId: string) => void;
  onInspectItem: (item: IndexItem) => void;
  onHelpItemPage: (itemPage: string) => void;
  onOpenCommandHistory: () => void;
  onUrlAction?: () => void;
  onCommandAction?: () => void;
  onRefreshTemporaryItem?: () => void;
  onTagCloudTagSelect: (tag: string) => void;
  onOpenMarkdownLink: (
    sourcePath: string | null | undefined,
    href: string,
  ) => void;
  onFileEditorChange: (
    tabId: string,
    patch: Partial<FileEditorTabState>,
  ) => void;
  onFileEditorHelp: () => void;
  onCloseTab: (tabId: string, options?: { force?: boolean }) => void;
  onFileEditorSaved: (tabId: string, result: FileEditorSaveResult) => void;
};

export const PreviewPanelList = ({
  tabs,
  activeTabId,
  lastActivePinnedTabId,
  selectedIndex,
  displayIndex,
  isLoading,
  hasResults,
  animation,
  themeId,
  themeOptions,
  onReloadThemes,
  compactListItems,
  onLoad,
  onThemeChange,
  onCompactListItemsChange,
  language,
  onLanguageChange,
  commandHistory,
  setPreviewRef,
  onActivateTab,
  onInspectItem,
  onHelpItemPage,
  onOpenCommandHistory,
  onUrlAction,
  onCommandAction,
  onRefreshTemporaryItem,
  onTagCloudTagSelect,
  onOpenMarkdownLink,
  onFileEditorChange,
  onFileEditorHelp,
  onCloseTab,
  onFileEditorSaved,
}: Props) => {
  const { LL } = useI18nContext();
  const liveTab = tabs.find((tab) => tab.id === LIVE_PREVIEW_TAB_ID);
  const pinnedTabs = tabs.filter((tab) => tab.id !== LIVE_PREVIEW_TAB_ID);
  const activePinnedTab = pinnedTabs.find((tab) => tab.id === activeTabId);
  const displayedPinnedTab =
    activePinnedTab ??
    pinnedTabs.find((tab) => tab.id === lastActivePinnedTabId) ??
    pinnedTabs[0] ??
    null;

  const getTabTitle = (tab: PreviewTab) => {
    if (tab.type === "item") {
      return tab.item.preview.type === "internal"
        ? getInternalPageTitle(tab.item.preview.page, LL)
        : tab.item.title;
    }

    if (tab.type === "fileEditor") {
      return `${tab.editor.title}${tab.editor.dirty ? " *" : ""}`;
    }

    if (tab.type === "itemInspector") {
      return tab.item.title;
    }

    if (tab.type === "queryInspector") {
      return tab.query;
    }

    return getHelpContent(tab.itemPage, LL)?.title ?? tab.itemPage;
  };

  const getTabIcon = (
    tab: PreviewTab,
  ): ComponentType<{ className?: string }> | null => {
    if (tab.type === "item") {
      return getPreviewIcon(tab.item);
    }

    if (tab.type === "fileEditor") {
      return tab.editor.mode === "create" ? FilePlus : Pencil;
    }

    if (tab.type === "itemInspector") {
      return Bug;
    }

    if (tab.type === "queryInspector") {
      return SearchCode;
    }

    return CircleHelp;
  };

  const renderPinnedTabs = () => (
    <div
      className="-my-2 -ml-4 flex min-w-0 flex-1 self-stretch overflow-hidden"
      aria-label="Pinned preview tabs"
    >
      {pinnedTabs.map((tab) => {
        const Icon = getTabIcon(tab);
        const active = tab.id === activeTabId;
        const lastActive =
          activeTabId === LIVE_PREVIEW_TAB_ID &&
          tab.id === displayedPinnedTab?.id;

        return (
          <div
            key={tab.id}
            className={cn(
              "relative flex min-w-0 flex-1 items-center border-r border-border-main text-text-muted",
              active &&
                "bg-main-bg text-text-main before:absolute before:left-0 before:top-0 before:h-0.5 before:w-full before:bg-accent",
              lastActive &&
                "bg-main-bg text-text-main after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:bg-accent/60",
              !active && !lastActive && "bg-glass-bg hover:bg-item-hover",
            )}
          >
            <button
              type="button"
              onClick={() => onActivateTab(tab.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-left text-xs"
              title={getTabTitle(tab)}
              tabIndex={-1}
            >
              {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0 truncate font-medium">
                {getTabTitle(tab)}
              </span>
            </button>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted hover:bg-item-hover hover:text-text-main max-sm:hidden"
              title={LL.common.close()}
              tabIndex={-1}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );

  const renderTabPanel = (
    tab: PreviewTab,
    options?: { pinnedHeader?: boolean },
  ) => {
    const isLive = tab.id === LIVE_PREVIEW_TAB_ID;
    const pinnedHeaderLeading = options?.pinnedHeader
      ? renderPinnedTabs()
      : undefined;

    if (tab.type === "fileEditor") {
      return (
        <FileEditorPanel
          key={tab.id}
          editor={tab.editor}
          active={tab.id === activeTabId}
          onChange={(patch) => onFileEditorChange(tab.id, patch)}
          onClose={(options) => onCloseTab(tab.id, options)}
          onHelp={onFileEditorHelp}
          onSaved={(result) => onFileEditorSaved(tab.id, result)}
          headerLeading={pinnedHeaderLeading}
        />
      );
    }

    if (tab.type === "itemInspector") {
      return (
        <InspectorPanel
          key={tab.id}
          title={LL.itemInspector.title()}
          subtitle={tab.item.title}
          kind="item"
          json={JSON.stringify(tab.item, null, 2)}
          active={tab.id === activeTabId}
          onClose={() => onCloseTab(tab.id)}
          headerLeading={pinnedHeaderLeading}
        />
      );
    }

    if (tab.type === "queryInspector") {
      const parsed = parseSearchInput(tab.query);
      const data = {
        raw: tab.query,
        query: parsed.query,
        hidden: parsed.hidden,
        commandArgs: parsed.commandArgs,
        isInternal: parsed.query.startsWith("$"),
      };

      return (
        <InspectorPanel
          key={tab.id}
          title={LL.queryInspector.title()}
          subtitle={tab.query}
          kind="query"
          json={JSON.stringify(data, null, 2)}
          active={tab.id === activeTabId}
          onClose={() => onCloseTab(tab.id)}
          headerLeading={pinnedHeaderLeading}
        />
      );
    }

    if (tab.type === "help") {
      return (
        <HelpPanel
          key={tab.id}
          itemPage={tab.itemPage}
          active={tab.id === activeTabId}
          onClose={() => onCloseTab(tab.id)}
          headerLeading={pinnedHeaderLeading}
        />
      );
    }

    return (
      <PreviewPanel
        key={tab.id}
        item={tab.item}
        selectedIndex={isLive ? selectedIndex : 0}
        displayIndex={isLive ? displayIndex : 0}
        isLoading={isLive ? isLoading : false}
        onLoad={isLive ? onLoad : () => {}}
        animation={isLive ? animation : false}
        isNotFound={isLive ? !hasResults && !isLoading : false}
        themeId={themeId}
        themeOptions={themeOptions}
        onReloadThemes={onReloadThemes}
        onThemeChange={onThemeChange}
        ref={(handle) => setPreviewRef(tab.id, handle)}
        active={tab.id === activeTabId}
        compactListItems={compactListItems}
        onCompactListItemsChange={onCompactListItemsChange}
        language={language}
        onLanguageChange={onLanguageChange}
        commandHistory={commandHistory}
        onInspectItem={onInspectItem}
        onHelpItemPage={onHelpItemPage}
        onOpenCommandHistory={onOpenCommandHistory}
        onUrlAction={onUrlAction}
        onCommandAction={onCommandAction}
        onRefreshTemporaryItem={onRefreshTemporaryItem}
        onTagCloudTagSelect={onTagCloudTagSelect}
        onOpenMarkdownLink={onOpenMarkdownLink}
        headerLeading={pinnedHeaderLeading}
      />
    );
  };

  const renderPinnedPanel = () => {
    if (!displayedPinnedTab) {
      return null;
    }

    return renderTabPanel(displayedPinnedTab, { pinnedHeader: true });
  };

  return (
    <div className="flex flex-1 min-w-0 overflow-hidden">
      {liveTab && renderTabPanel(liveTab)}
      {renderPinnedPanel()}
    </div>
  );
};
