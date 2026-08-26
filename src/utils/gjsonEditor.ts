import { GjsonCardItem, GjsonEditorDocument } from "@/types";

const stringValue = (value: unknown) =>
  typeof value === "string" ? value : "";
const booleanValue = (value: unknown, fallback = false) =>
  typeof value === "boolean" ? value : fallback;

const stringListValue = (value: unknown) => {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string").join(", ");
  }

  return "";
};

const parseStringList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const createEmptyGjsonCardItem = (): GjsonCardItem => ({
  id: crypto.randomUUID(),
  title: "",
  desc: "",
  url: "",
  tags: "",
  aliases: "",
  star: false,
  hidden: false,
  iframe: true,
  command: "",
  defaultAction: "",
  raw: {},
});

export const createEmptyGjsonDocument = (): GjsonEditorDocument => ({
  root: {},
  items: [createEmptyGjsonCardItem()],
});

export const parseGjsonEditorDocument = (
  content: string,
): GjsonEditorDocument => {
  const parsed = JSON.parse(content) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(".gjson root must be an object");
  }

  const root = parsed as Record<string, unknown>;

  if (!Array.isArray(root.items)) {
    throw new Error(".gjson root must contain an items array");
  }

  const items = root.items.map((rawItem, index): GjsonCardItem => {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      throw new Error(`items[${index}] must be an object`);
    }

    const raw = rawItem as Record<string, unknown>;
    const title = stringValue(raw.title);

    if (!title.trim()) {
      throw new Error(`items[${index}].title must be a non-empty string`);
    }

    return {
      id: crypto.randomUUID(),
      title,
      desc: stringValue(raw.description) || stringValue(raw.desc),
      url: stringValue(raw.url),
      tags: stringListValue(raw.tags),
      aliases: stringListValue(raw.aliases),
      star: booleanValue(raw.star),
      hidden: booleanValue(raw.hidden),
      iframe: booleanValue(raw.iframe, true),
      command: stringValue(raw.command),
      defaultAction:
        raw.defaultAction === "command" || raw.defaultAction === "url"
          ? raw.defaultAction
          : raw.default_action === "command" || raw.default_action === "url"
            ? raw.default_action
            : "",
      raw,
    };
  });

  return {
    root,
    items,
  };
};

export const serializeGjsonEditorDocument = (document: GjsonEditorDocument) => {
  const items = document.items
    .filter((item) => !isEmptyGjsonCardItem(item))
    .map((item) => {
      const next: Record<string, unknown> = { ...item.raw };

      next.title = item.title.trim();

      setOptionalString(next, "desc", item.desc);
      delete next.description;
      setOptionalString(next, "url", item.url);

      const tags = parseStringList(item.tags);
      if (tags.length > 0) {
        next.tags = tags.length === 1 ? tags[0] : tags;
      } else {
        delete next.tags;
      }

      const aliases = parseStringList(item.aliases);
      if (aliases.length > 0) {
        next.aliases = aliases.length === 1 ? aliases[0] : aliases;
      } else {
        delete next.aliases;
      }

      setOptionalBoolean(next, "star", item.star);
      setOptionalBoolean(next, "hidden", item.hidden);
      setDefaultTrueBoolean(next, "iframe", item.iframe);
      setOptionalString(next, "command", item.command);

      if (item.defaultAction) {
        next.defaultAction = item.defaultAction;
      } else {
        delete next.defaultAction;
        delete next.default_action;
      }

      return next;
    });

  return `${JSON.stringify({ ...document.root, items }, null, 2)}\n`;
};

const setOptionalString = (
  target: Record<string, unknown>,
  key: string,
  value: string,
) => {
  const trimmed = value.trim();

  if (trimmed) {
    target[key] = trimmed;
  } else {
    delete target[key];
  }
};

const setOptionalBoolean = (
  target: Record<string, unknown>,
  key: string,
  value: boolean,
) => {
  if (value) {
    target[key] = true;
  } else {
    delete target[key];
  }
};

const setDefaultTrueBoolean = (
  target: Record<string, unknown>,
  key: string,
  value: boolean,
) => {
  if (value) {
    delete target[key];
  } else {
    target[key] = false;
  }
};

export const isEmptyGjsonDocument = (document?: GjsonEditorDocument) => {
  if (!document) return true;

  return document.items.every(isEmptyGjsonCardItem);
};

export const isEmptyGjsonCardItem = (item: GjsonCardItem) =>
  !item.title.trim() &&
  !item.desc.trim() &&
  !item.url.trim() &&
  !item.tags.trim() &&
  !item.aliases.trim() &&
  !item.star &&
  !item.hidden &&
  item.iframe &&
  !item.command.trim() &&
  !item.defaultAction;
