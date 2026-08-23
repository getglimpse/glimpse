import type { PluginInternalPage } from "./item";

export type Shortcut = {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: (e: KeyboardEvent) => void;
  preventDefault?: boolean;
};

export const PLUGIN_ACTION_PAGE_SHORTCUT_PREFIX = "openPluginActionPage:";

export type PluginActionPageShortcutAction =
  `${typeof PLUGIN_ACTION_PAGE_SHORTCUT_PREFIX}${PluginInternalPage}`;

export const pluginActionPageShortcutAction = (
  page: PluginInternalPage,
): PluginActionPageShortcutAction =>
  `${PLUGIN_ACTION_PAGE_SHORTCUT_PREFIX}${page}`;

export const isPluginActionPageShortcutAction = (
  action: string,
): action is PluginActionPageShortcutAction =>
  action.startsWith(PLUGIN_ACTION_PAGE_SHORTCUT_PREFIX);

export const pluginActionPageFromShortcutAction = (
  action: PluginActionPageShortcutAction,
): PluginInternalPage =>
  action.slice(
    PLUGIN_ACTION_PAGE_SHORTCUT_PREFIX.length,
  ) as PluginInternalPage;

export type StaticShortcutAction =
  | "toggleMainWindow"
  | "selectNextItem"
  | "selectPrevItem"
  | "selectNextPage"
  | "selectPrevPage"
  | "selectFirstItem"
  | "selectLastItem"
  | "openActiveItem"
  | "scrollActivePreviewDown"
  | "scrollActivePreviewUp"
  | "createFile"
  | "openActiveFileEditor"
  | "pinActivePreview"
  | "switchNextPreviewTab"
  | "switchPrevPreviewTab"
  | "closeActivePreviewTab"
  | "focusSearch"
  | "openActiveSourceFile"
  | "revealActiveSourceFile"
  | "togglePreviewLayout"
  | "toggleLauncherLayout"
  | "togglePreviewMode"
  | "switchTargetGroup"
  | "openQueryInspector"
  | "openItemHelp"
  | "openCommandHistory"
  | "openDebugPage"
  | "openTagCloudPage"
  | "inspectActiveItem"
  | "closePreviewWindow"
  | "copyActivePreviewContent"
  | "copyActivePreviewCodeBlock1"
  | "copyActivePreviewCodeBlock2"
  | "copyActivePreviewCodeBlock3"
  | "copyActivePreviewCodeBlock4"
  | "openSettingsFile";

export type ShortcutAction =
  | StaticShortcutAction
  | PluginActionPageShortcutAction;

export type BackendShortcutAction = "toggleMainWindow";

export type FrontendStaticShortcutAction = Exclude<
  StaticShortcutAction,
  BackendShortcutAction
>;

export type FrontendShortcutAction = Exclude<
  ShortcutAction,
  BackendShortcutAction
>;

export type ShortcutHandlers = Record<
  FrontendStaticShortcutAction,
  () => void
> & {
  openPluginActionPage: (page: PluginInternalPage) => void;
};
