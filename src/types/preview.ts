import { IndexItem } from "./item";

export type PreviewMode = "markdown" | "raw";

export type FileEditorMode = "create" | "edit";

export type PreviewPanelHandle = {
  scrollDown: () => void;
  scrollUp: () => void;
  revealRange?: (range: { startByte: number; endByte: number }) => void;
  copyCodeBlock?: (index: number) => Promise<boolean>;
  copyContent?: () => Promise<boolean>;
  togglePreviewMode?: () => void;
};

export type FileEditorTabState = {
  mode: FileEditorMode;
  filePath?: string;
  initialTitle: string;
  initialBody: string;
  title: string;
  dirty: boolean;
};

export type ItemPreviewTab = {
  id: string;
  type: "item";
  item: IndexItem;
};

export type FileEditorPreviewTab = {
  id: string;
  type: "fileEditor";
  editor: FileEditorTabState;
};

export type ItemInspectorPreviewTab = {
  id: string;
  type: "itemInspector";
  item: IndexItem;
};

export type QueryInspectorPreviewTab = {
  id: string;
  type: "queryInspector";
  query: string;
};

export type HelpPreviewTab = {
  id: string;
  type: "help";
  itemPage: string;
};

export type PreviewTab =
  | ItemPreviewTab
  | FileEditorPreviewTab
  | ItemInspectorPreviewTab
  | QueryInspectorPreviewTab
  | HelpPreviewTab;
