type MarkdownMetadata = {
  title?: string;
  desc?: string;
  tags: string[];
  aliases: string[];
  star: boolean;
  hidden: boolean;
  url?: string;
  iframe: boolean;
  command?: string;
  defaultAction?: "url" | "command";
  body: string;
};

type ActiveList = "tags" | "aliases";

const emptyMetadata = (body: string): MarkdownMetadata => ({
  tags: [],
  aliases: [],
  star: false,
  hidden: false,
  iframe: false,
  body,
});

const unquote = (value: string) => {
  const trimmed = value.trim();

  if (trimmed.length < 2) return trimmed;

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];

  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? trimmed.slice(1, -1)
    : trimmed;
};

const stripInlineComment = (value: string) => {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char !== "#" || inSingleQuote || inDoubleQuote) {
      continue;
    }

    const previous = index === 0 ? undefined : value[index - 1];

    if (!previous || /\s/.test(previous)) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value;
};

const parseBool = (value: string) =>
  unquote(stripInlineComment(value.trim())).toLowerCase() === "true";

const parseInlineList = (line: string, key: ActiveList) => {
  const prefix = `${key}:`;

  if (!line.startsWith(prefix)) return null;

  const value = line.slice(prefix.length).trim();

  if (!value) return null;

  if (!value.startsWith("[") || !value.endsWith("]")) {
    const item = unquote(value);

    return item ? [item] : null;
  }

  return value
    .slice(1, -1)
    .split(",")
    .map((item) => unquote(item.trim()))
    .filter(Boolean);
};

const parseBlockListItem = (line: string) => {
  if (!line.startsWith("- ")) return null;

  const value = unquote(line.slice(2).trim());

  return value ? value : null;
};

const normalizeStringList = (items: string[]) =>
  Array.from(new Set(items)).sort();

const isTopLevel = (line: string) =>
  !line.startsWith(" ") && !line.startsWith("\t");

const isClosingDelimiterLine = (line: string) => {
  const withoutLineEnding = line.replace(/[\r\n]+$/, "");

  return isTopLevel(withoutLineEnding) && withoutLineEnding === "---";
};

const splitFrontmatter = (content: string) => {
  const startLength = content.startsWith("---\n")
    ? 4
    : content.startsWith("---\r\n")
      ? 5
      : 0;

  if (startLength === 0) return null;

  let position = startLength;

  while (position <= content.length) {
    const nextNewline = content.indexOf("\n", position);
    const lineEnd =
      nextNewline === -1 ? content.length : nextNewline + "\n".length;
    const line = content.slice(position, lineEnd);

    if (isClosingDelimiterLine(line)) {
      return {
        yaml: content.slice(startLength, position),
        body: content.slice(lineEnd),
      };
    }

    if (nextNewline === -1) break;

    position = lineEnd;
  }

  return null;
};

export const parseMarkdownMetadata = (content: string): MarkdownMetadata => {
  const split = splitFrontmatter(content);

  if (!split) return emptyMetadata(content);

  const metadata = emptyMetadata(split.body.trim());
  let activeList: ActiveList | null = null;

  for (const rawLine of split.yaml.split(/\r?\n/)) {
    const line = rawLine.trim();
    const topLevel = isTopLevel(rawLine);

    if (!line || line.startsWith("#")) {
      continue;
    }

    if (activeList) {
      const value = parseBlockListItem(line);

      if (value) {
        metadata[activeList].push(value);
        continue;
      }

      activeList = null;
    }

    if (!topLevel) {
      continue;
    }

    if (line.startsWith("star:")) {
      metadata.star = parseBool(line.slice("star:".length));
      continue;
    }

    if (line.startsWith("hidden:")) {
      metadata.hidden = parseBool(line.slice("hidden:".length));
      continue;
    }

    if (line.startsWith("title:")) {
      const title = unquote(line.slice("title:".length));

      if (title) metadata.title = title;
      continue;
    }

    if (line.startsWith("description:")) {
      const desc = unquote(line.slice("description:".length));

      if (desc) metadata.desc = desc;
      continue;
    }

    if (line.startsWith("desc:")) {
      const desc = unquote(line.slice("desc:".length));

      if (desc && !metadata.desc) metadata.desc = desc;
      continue;
    }

    if (line.startsWith("url:")) {
      const url = unquote(line.slice("url:".length));

      if (url) metadata.url = url;
      continue;
    }

    if (line.startsWith("iframe:")) {
      metadata.iframe = parseBool(line.slice("iframe:".length));
      continue;
    }

    if (line.startsWith("command:")) {
      const command = unquote(line.slice("command:".length));

      if (command) metadata.command = command;
      continue;
    }

    if (line.startsWith("defaultAction:")) {
      const defaultAction = unquote(line.slice("defaultAction:".length));

      if (defaultAction === "url" || defaultAction === "command") {
        metadata.defaultAction = defaultAction;
      }

      continue;
    }

    if (line.startsWith("default_action:")) {
      const defaultAction = unquote(line.slice("default_action:".length));

      if (defaultAction === "url" || defaultAction === "command") {
        metadata.defaultAction = defaultAction;
      }

      continue;
    }

    const tags = parseInlineList(line, "tags");

    if (tags) {
      metadata.tags.push(...tags);
      continue;
    }

    const aliases = parseInlineList(line, "aliases");

    if (aliases) {
      metadata.aliases.push(...aliases);
      continue;
    }

    if (line === "tags:") {
      activeList = "tags";
      continue;
    }

    if (line === "aliases:") {
      activeList = "aliases";
    }
  }

  metadata.tags = normalizeStringList(metadata.tags);
  metadata.aliases = normalizeStringList(metadata.aliases);

  return metadata;
};

export const extractMarkdownMetadataTitle = (content: string) =>
  parseMarkdownMetadata(content).title ?? null;
