import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import {
  IndexItem,
  CommandHistoryEntry,
  Language,
  PreviewMode,
  PreviewPanelHandle,
} from "@/types";

import { PreviewHeader } from "./PreviewHeader";

import { openerApi } from "@/api/opener";
import { DebugPage } from "@/views/internal/DebugPage";
import { ThemeOption } from "@/constants/themes";
import {
  MarkdownPreview,
  MarkdownPreviewHandle,
} from "@/views/preview/MarkdownPreview";

import { RawPreview, RawPreviewHandle } from "@/views/preview/RawPreview";

import { AboutPage } from "@/views/internal/AboutPage";
import { HelpPage } from "@/views/internal/HelpPage";
import { MetadataHelpPage } from "@/views/internal/MetadataHelpPage";
import { PluginPage } from "@/views/internal/PluginPage";
import { ShortcutsPage } from "@/views/internal/ShortcutsPage";
import { SettingsPage } from "@/views/internal/SettingsPage";
import { CommandHistoryPage } from "@/views/internal/CommandHistoryPage";
import { TagCloudPage } from "@/views/internal/TagCloudPage";

import { copyPreviewContent } from "@/utils/clipboard";
import {
  getInternalPageContribution,
  getPluginViewerContributionForSourcePath,
} from "@/features/plugins/pluginRegistry";
import { PluginViewerPreview } from "@/features/plugins/PluginViewerPreview";
import { useI18nContext } from "@/i18n/I18nProvider";
import { toast } from "@/utils/toast";

type Props = {
  item: IndexItem | null;
  selectedIndex: number;
  displayIndex: number;
  animation: boolean;
  isLoading: boolean;
  onLoad: () => void;
  isNotFound?: boolean;
  themeId: string;
  themeOptions: ThemeOption[];
  onThemeChange: (themeId: string) => void;
  onReloadThemes: () => Promise<void>;
  compactListItems: boolean;
  onCompactListItemsChange: (compact: boolean) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  commandHistory: CommandHistoryEntry[];
  active?: boolean;
  onInspectItem: (item: IndexItem) => void;
  onHelpItemPage?: (itemPage: string) => void;
  onOpenCommandHistory?: () => void;
  onUrlAction?: () => void;
  onCommandAction?: () => void;
  onRefreshTemporaryItem?: () => void;
  onTagCloudTagSelect: (tag: string) => void;
};

export const PreviewPanel = forwardRef<PreviewPanelHandle, Props>(
  (
    {
      item,
      selectedIndex,
      displayIndex,
      animation,
      isLoading,
      onLoad,
      isNotFound,
      themeId,
      themeOptions,
      onThemeChange,
      onReloadThemes,
      compactListItems,
      onCompactListItemsChange,
      active,
      language,
      onLanguageChange,
      commandHistory,
      onInspectItem,
      onHelpItemPage,
      onOpenCommandHistory,
      onUrlAction,
      onCommandAction,
      onRefreshTemporaryItem,
      onTagCloudTagSelect,
    },
    ref,
  ) => {
    const markdownRef = useRef<MarkdownPreviewHandle>(null);
    const rawRef = useRef<RawPreviewHandle>(null);

    const [previewMode, setPreviewMode] = useState<PreviewMode>("markdown");
    const [pendingRevealRange, setPendingRevealRange] = useState<{
      startByte: number;
      endByte: number;
    } | null>(null);
    const [loadedHtmlPreviewId, setLoadedHtmlPreviewId] = useState<
      string | null
    >(null);

    const { LL } = useI18nContext();

    const copyContent = useCallback(async () => {
      if (item?.preview.type !== "markdown" && item?.preview.type !== "raw") {
        return false;
      }

      try {
        return await copyPreviewContent(item.preview.content);
      } catch {
        return false;
      }
    }, [item]);

    const togglePreviewMode = useCallback(() => {
      if (item?.preview.type !== "markdown") {
        return;
      }

      setPreviewMode((prev) => (prev === "markdown" ? "raw" : "markdown"));
    }, [item?.preview.type]);

    useImperativeHandle(
      ref,
      () => ({
        scrollDown: () => {
          if (item?.preview.type === "raw") {
            rawRef.current?.scrollDown();
            return;
          }

          if (item?.preview.type === "markdown") {
            if (previewMode === "raw") {
              rawRef.current?.scrollDown();
              return;
            }

            markdownRef.current?.scrollDown();
          }
        },

        scrollUp: () => {
          if (item?.preview.type === "raw") {
            rawRef.current?.scrollUp();
            return;
          }

          if (item?.preview.type === "markdown") {
            if (previewMode === "raw") {
              rawRef.current?.scrollUp();
              return;
            }

            markdownRef.current?.scrollUp();
          }
        },

        copyCodeBlock: (index: number) => {
          if (item?.preview.type !== "markdown" || previewMode !== "markdown") {
            return Promise.resolve(false);
          }

          return (
            markdownRef.current?.copyCodeBlock(index) ?? Promise.resolve(false)
          );
        },

        revealRange: (range) => {
          if (item?.preview.type === "raw") {
            rawRef.current?.revealRange(range);
            return;
          }

          if (item?.preview.type === "markdown") {
            setPendingRevealRange(range);
            setPreviewMode("raw");
          }
        },

        copyContent,

        togglePreviewMode,
      }),
      [item, previewMode, copyContent, togglePreviewMode],
    );

    useEffect(() => {
      if (!pendingRevealRange || item?.preview.type !== "markdown") {
        return;
      }

      if (previewMode !== "raw") {
        return;
      }

      const frame = window.requestAnimationFrame(() => {
        rawRef.current?.revealRange(pendingRevealRange);
        setPendingRevealRange(null);
      });

      return () => {
        window.cancelAnimationFrame(frame);
      };
    }, [item?.preview.type, pendingRevealRange, previewMode]);

    useEffect(() => {
      if (item?.preview.type === "raw") {
        rawRef.current?.scrollToTop();
        return;
      }

      if (item?.preview.type === "markdown") {
        if (previewMode === "raw") {
          rawRef.current?.scrollToTop();
          return;
        }

        markdownRef.current?.scrollToTop();
      }
    }, [item?.id, item?.preview.type, previewMode]);

    useEffect(() => {
      setPreviewMode("markdown");
      setLoadedHtmlPreviewId(null);
      setPendingRevealRange(null);
    }, [item?.id]);

    const viewerContribution =
      item?.preview.type === "raw"
        ? getPluginViewerContributionForSourcePath(item.sourcePath)
        : undefined;
    const isHtmlViewerPreview =
      viewerContribution?.plugin.id === "html-viewer-plugin" &&
      viewerContribution.viewer.id === "html";
    const htmlPreviewLoaded =
      Boolean(item?.id) && loadedHtmlPreviewId === item?.id;

    const openHtmlSourceFile = useCallback(async () => {
      if (!item?.sourcePath) {
        toast.error(LL.previewPanel.noSourceFilePath());
        return;
      }

      try {
        await openerApi.openSourceFileOrReveal(item.sourcePath);
      } catch {
        toast.error(LL.previewPanel.openFileFallback());
      }
    }, [LL, item?.sourcePath]);

    if (isNotFound || !item) {
      return (
        <main className="flex-1 flex flex-col items-center justify-center bg-main-bg relative overflow-hidden h-full min-w-0">
          <div className="flex flex-col items-center gap-4 opacity-40">
            <svg
              className="w-16 h-16"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>

            <div className="text-center">
              <h2 className="text-xl font-bold tracking-wider mb-1">
                {LL.previewPanel.notFound.title()}
              </h2>

              <p className="text-xs">
                {LL.previewPanel.notFound.description()}
              </p>
            </div>
          </div>
        </main>
      );
    }

    const renderPreview = () => {
      if (item.preview.type === "raw") {
        if (viewerContribution) {
          if (isHtmlViewerPreview && !htmlPreviewLoaded) {
            return (
              <RawPreview
                ref={rawRef}
                id={item.id}
                content={item.preview.content}
              />
            );
          }

          return (
            <PluginViewerPreview
              item={{
                ...item,
                preview: {
                  type: "pluginViewer",
                  pluginId: viewerContribution.plugin.id,
                  viewerId: viewerContribution.viewer.id,
                },
              }}
            />
          );
        }
      }

      switch (item.preview.type) {
        case "internal": {
          switch (item.preview.page) {
            case "help":
              return <HelpPage />;

            case "metadata":
              return <MetadataHelpPage />;

            case "shortcuts":
              return <ShortcutsPage />;

            case "about":
              return <AboutPage />;

            case "debug":
              return <DebugPage />;

            case "plugin":
              return <PluginPage />;

            case "command-history":
              return <CommandHistoryPage entries={commandHistory} />;

            case "tag-cloud":
              return <TagCloudPage onTagSelect={onTagCloudTagSelect} />;

            case "settings":
              return (
                <SettingsPage
                  themeId={themeId}
                  themeOptions={themeOptions}
                  onThemeChange={onThemeChange}
                  onReloadThemes={onReloadThemes}
                  compactListItems={compactListItems}
                  onCompactListItemsChange={onCompactListItemsChange}
                  language={language}
                  onLanguageChange={onLanguageChange}
                />
              );

            default: {
              const contribution = getInternalPageContribution(
                item.preview.page,
              );

              if (contribution) {
                return contribution.render();
              }
            }
          }

          return (
            <div className="p-4 text-red-400">
              {LL.previewPanel.unknownPreviewType({
                type: `internal:${item.preview.page}`,
              })}
            </div>
          );
        }

        case "external":
          return (
            <div
              className="w-full h-full"
              style={{ backgroundColor: "var(--iframe-bg)" }}
            >
              <iframe
                key={item.preview.url}
                src={item.preview.url}
                onLoad={onLoad}
                className={`w-full h-full border-none pointer-events-none ${
                  animation ? "transition-opacity duration-500" : ""
                } ${isLoading ? "opacity-0" : "opacity-100"}`}
              />
            </div>
          );

        case "pluginViewer":
          return <PluginViewerPreview item={item} />;

        case "raw":
          return (
            <RawPreview
              ref={rawRef}
              id={item.id}
              content={item.preview.content}
            />
          );

        case "markdown":
          if (previewMode === "raw") {
            return (
              <RawPreview
                ref={rawRef}
                id={item.id}
                content={item.preview.content}
              />
            );
          }

          return (
            <MarkdownPreview
              ref={markdownRef}
              id={item.id}
              sourcePath={item.sourcePath}
              content={item.preview.content}
            />
          );

        default:
          return (
            <div className="p-4 text-red-400">
              {LL.previewPanel.unknownPreviewType({
                type: String((item.preview as any).type),
              })}
            </div>
          );
      }
    };

    return (
      <main className="flex-1 flex flex-col bg-main-bg border-l border-border-main relative overflow-hidden min-w-0">
        <PreviewHeader
          item={item}
          selectedIndex={selectedIndex}
          displayIndex={displayIndex}
          active={active}
          previewMode={previewMode}
          htmlPreviewControls={
            isHtmlViewerPreview
              ? {
                  loaded: htmlPreviewLoaded,
                  onLoad: () => setLoadedHtmlPreviewId(item.id),
                  onOpen: () => {
                    void openHtmlSourceFile();
                  },
                }
              : undefined
          }
          onPreviewModeChange={setPreviewMode}
          onCopyContent={copyContent}
          onInspectItem={onInspectItem}
          onHelpItemPage={onHelpItemPage}
          onOpenCommandHistory={onOpenCommandHistory}
          onUrlAction={onUrlAction}
          onCommandAction={onCommandAction}
          onRefreshTemporaryItem={onRefreshTemporaryItem}
        />

        <div className="flex-1 relative min-h-0 overflow-hidden">
          {renderPreview()}
        </div>
      </main>
    );
  },
);

PreviewPanel.displayName = "PreviewPanel";
