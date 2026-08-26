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
import { FileEditorPanel } from "./FileEditorPanel";
import { HelpPanel } from "./HelpPanel";
import { InspectorPanel } from "./InspectorPanel";
import { LIVE_PREVIEW_TAB_ID } from "./constants";
import { parseSearchInput } from "@/features/search/parseSearchInput";
import { useI18nContext } from "@/i18n/I18nProvider";

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
  onInspectItem: (item: IndexItem) => void;
  onHelpItemPage: (itemPage: string) => void;
  onOpenCommandHistory: () => void;
  onUrlAction?: () => void;
  onCommandAction?: () => void;
  onRefreshTemporaryItem?: () => void;
  onTagCloudTagSelect: (tag: string) => void;
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
  onInspectItem,
  onHelpItemPage,
  onOpenCommandHistory,
  onUrlAction,
  onCommandAction,
  onRefreshTemporaryItem,
  onTagCloudTagSelect,
  onFileEditorChange,
  onFileEditorHelp,
  onCloseTab,
  onFileEditorSaved,
}: Props) => {
  const { LL } = useI18nContext();

  return (
    <div className="flex flex-1 min-w-0 overflow-hidden">
      {tabs.map((tab) => {
        const isLive = tab.id === LIVE_PREVIEW_TAB_ID;

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
          />
        );
      })}
    </div>
  );
};
