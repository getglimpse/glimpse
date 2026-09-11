export type BuiltInInternalPage =
  | "about"
  | "settings"
  | "debug"
  | "plugin"
  | "plugin-store"
  | "shortcuts"
  | "metadata"
  | "command-history"
  | "tag-cloud"
  | "help";

export type PluginInternalPage = `plugin:${string}`;

export type InternalPage = BuiltInInternalPage | PluginInternalPage;

export type Preview =
  | { type: "markdown"; content: string }
  | { type: "raw"; content: string }
  | { type: "external"; url: string }
  | { type: "pluginViewer"; pluginId: string; viewerId: string }
  | { type: "internal"; page: InternalPage };

export type DefaultAction = "url" | "command";

export type IndexMetadata = {
  tags: string[];
  aliases: string[];
  star: boolean;
  hidden?: boolean;
  boost: number;
};

export type IndexItem = {
  id: string;
  title: string;
  sourcePath?: string | null;
  updatedAt: string;
  metadata: IndexMetadata;
  preview: Preview;
  url?: string | null;
  command?: string | null;
  defaultAction?: DefaultAction | null;
};

export type SearchSnippetSource = "body" | "title" | "alias" | "tag";

export type SearchSnippetFragment = {
  text: string;
  matched: boolean;
};

export type SearchSnippetChunk = {
  ordinal: number;
  startByte: number;
  endByte: number;
};

export type SearchSnippet = {
  source: SearchSnippetSource;
  fragments: SearchSnippetFragment[];
  chunk?: SearchSnippetChunk;
};

export type SearchResult = {
  item: IndexItem;
  score: number;
  snippets?: SearchSnippet[];
};
