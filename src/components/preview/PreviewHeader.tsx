import {
  Settings,
  CircleHelp,
  Keyboard,
  Info,
  Bug,
  Plug,
  Globe,
  History,
  Tags,
  RefreshCw,
  Copy,
  Download,
  Search,
} from "lucide-react";

import { settingsApi } from "@/api/settings";

import { IndexItem, PreviewMode } from "@/types";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useI18nContext } from "@/i18n/I18nProvider";
import { getInternalPageTitle } from "@/utils/internalPageTitle";
import { isPluginInternalPage } from "@/features/plugins/pluginRegistry";
import { openLocalPluginInstallDialog } from "@/features/plugins/pluginPageEvents";
import { hasHelpContent } from "@/utils/helpContent";
import { toast } from "@/utils/toast";

type Props = {
  item: IndexItem;
  selectedIndex: number;
  displayIndex: number;
  active?: boolean;
  previewMode: PreviewMode;
  htmlPreviewControls?: {
    loaded: boolean;
    onLoad: () => void;
    onOpen: () => void;
  };
  onPreviewModeChange: (mode: PreviewMode) => void;
  onCopyContent: () => Promise<boolean>;
  onInspectItem: (item: IndexItem) => void;
  onHelpItemPage?: (itemPage: string) => void;
  onOpenCommandHistory?: () => void;
  onUrlAction?: () => void;
  onCommandAction?: () => void;
  onRefreshTemporaryItem?: () => void;
};

const getPreviewIcon = (item: IndexItem) => {
  if (item.preview.type === "external") {
    return Globe;
  }

  if (item.preview.type !== "internal") {
    return null;
  }

  if (isPluginInternalPage(item.preview.page)) {
    return Plug;
  }

  switch (item.preview.page) {
    case "settings":
      return Settings;
    case "help":
      return CircleHelp;
    case "metadata":
      return Tags;
    case "shortcuts":
      return Keyboard;
    case "about":
      return Info;
    case "debug":
      return Bug;
    case "plugin":
      return Plug;
    case "command-history":
      return History;
    case "tag-cloud":
      return Tags;
    default:
      return null;
  }
};

const getActionButtons = (
  item: IndexItem,
  LL: ReturnType<typeof useI18nContext>["LL"],
) => {
  const buttons: Array<{
    kind: "url" | "command" | "refresh";
    label: string;
    tooltip: string;
  }> = [];
  const isTemporarySavedItem = item.id.startsWith("temporary-saved:");

  if (item.url) {
    buttons.push({
      kind: "url",
      label: LL.previewPanel.openLink(),
      tooltip: item.url,
    });
  }

  if (isTemporarySavedItem) {
    buttons.push({
      kind: "refresh",
      label: LL.common.reload(),
      tooltip: LL.common.reload(),
    });

    return buttons;
  }

  if (item.command) {
    buttons.push({
      kind: "command",
      label: LL.helpPage.open.command(),
      tooltip: item.command,
    });
  }

  return buttons;
};

export const PreviewHeader = ({
  item,
  selectedIndex,
  displayIndex,
  active,
  previewMode,
  htmlPreviewControls,
  onPreviewModeChange,
  onCopyContent,
  onInspectItem,
  onHelpItemPage,
  onOpenCommandHistory,
  onUrlAction,
  onCommandAction,
  onRefreshTemporaryItem,
}: Props) => {
  const { LL } = useI18nContext();

  const hasHelpPage =
    item.preview.type === "internal" && hasHelpContent(item.preview.page);

  const isSettingsPage =
    item.preview.type === "internal" && item.preview.page === "settings";
  const isPluginPage =
    item.preview.type === "internal" && item.preview.page === "plugin";

  const PreviewIcon = getPreviewIcon(item);
  const actionButtons = getActionButtons(item, LL);

  const title =
    item.preview.type === "internal"
      ? getInternalPageTitle(item.preview.page, LL)
      : item.title;

  return (
    <header className="relative pr-4 pl-4 pt-2 pb-2 border-b border-border-main flex justify-between items-center bg-glass-bg backdrop-blur-md z-10 flex-shrink-0">
      {active && (
        <div className="absolute left-0 top-0 h-0.5 w-full bg-accent" />
      )}

      <div className="flex items-center gap-2 min-w-0">
        {PreviewIcon && (
          <PreviewIcon
            className="h-4 w-4 shrink-0 text-text-muted"
            strokeWidth={2}
          />
        )}

        <span className="truncate text-sm font-semibold tracking-wide">
          {title}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {selectedIndex !== displayIndex && (
          <div className="text-[10px] text-accent animate-pulse font-mono font-bold">
            {LL.previewPanel.debouncing()}
          </div>
        )}

        {actionButtons.map((button) => (
          <button
            key={button.kind}
            type="button"
            onClick={
              button.kind === "url"
                ? onUrlAction
                : button.kind === "command"
                  ? onCommandAction
                  : onRefreshTemporaryItem
            }
            aria-label={button.tooltip}
            title={button.tooltip}
            disabled={
              button.kind === "url"
                ? !onUrlAction
                : button.kind === "command"
                  ? !onCommandAction
                  : !onRefreshTemporaryItem
            }
            className="text-xs text-accent hover:underline disabled:text-text-muted disabled:hover:no-underline"
            tabIndex={-1}
          >
            {button.label}
          </button>
        ))}

        {htmlPreviewControls && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={htmlPreviewControls.onLoad}
              disabled={htmlPreviewControls.loaded}
              className="rounded border border-border-main px-2 py-1 text-xs text-accent hover:border-accent hover:bg-item-hover disabled:border-border-main disabled:text-text-muted disabled:hover:bg-transparent"
              tabIndex={-1}
            >
              {htmlPreviewControls.loaded
                ? LL.previewPanel.loadedHtmlPreview()
                : LL.previewPanel.loadHtmlPreview()}
            </button>

            <button
              type="button"
              onClick={htmlPreviewControls.onOpen}
              className="rounded border border-border-main px-2 py-1 text-xs text-accent hover:border-accent hover:bg-item-hover"
              tabIndex={-1}
            >
              {LL.previewPanel.openHtmlPreview()}
            </button>
          </div>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-sm text-text-muted focus:outline-none hover:bg-item-hover hover:text-text-main"
              tabIndex={-1}
            >
              ⋯
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            {item.preview.type === "markdown" && (
              <DropdownMenuItem
                onClick={() =>
                  onPreviewModeChange(
                    previewMode === "markdown" ? "raw" : "markdown",
                  )
                }
              >
                <RefreshCw className="size-4 text-text-muted" />
                {LL.previewPanel.toggleViewMode()}
                <DropdownMenuShortcut action="togglePreviewMode" />
              </DropdownMenuItem>
            )}

            {(item.preview.type === "markdown" ||
              item.preview.type === "raw") && (
              <DropdownMenuItem
                onSelect={async (event) => {
                  event.preventDefault();

                  const copied = await onCopyContent();

                  if (copied) {
                    toast.success(LL.previewPanel.textCopied());
                  } else {
                    toast.error(LL.previewPanel.noTextToCopy());
                  }
                }}
              >
                <Copy className="size-4 text-text-muted" />
                {LL.previewPanel.copyContent()}
                <DropdownMenuShortcut action="copyActivePreviewContent" />
              </DropdownMenuItem>
            )}

            {hasHelpPage && onHelpItemPage && (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();

                  if (item.preview.type === "internal") {
                    onHelpItemPage(item.preview.page);
                  }
                }}
              >
                {LL.previewPanel.openHelp()}
                <DropdownMenuShortcut action="openItemHelp" />
              </DropdownMenuItem>
            )}

            {isSettingsPage && (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  void settingsApi.openFile();
                }}
              >
                {LL.previewPanel.openSettingsFile()}
                <DropdownMenuShortcut action="openSettingsFile" />
              </DropdownMenuItem>
            )}

            {isPluginPage && (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  openLocalPluginInstallDialog();
                }}
              >
                <Download className="size-4 text-text-muted" />
                {LL.pluginPage.installed.localInstall()}
              </DropdownMenuItem>
            )}

            {onOpenCommandHistory && (
              <DropdownMenuItem onClick={onOpenCommandHistory}>
                <History className="size-4 text-text-muted" />
                {LL.commandHistoryPage.title()}
                <DropdownMenuShortcut action="openCommandHistory" />
              </DropdownMenuItem>
            )}

            <DropdownMenuItem onClick={() => onInspectItem(item)}>
              <Search className="size-4 text-text-muted" />
              {LL.previewPanel.inspectItem()}
              <DropdownMenuShortcut action="inspectActiveItem" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
