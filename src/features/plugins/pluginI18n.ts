import type {
  GlimpsePlugin,
  PluginActionManifest,
  PluginI18nDictionary,
  PluginI18nManifest,
  PluginInternalPageManifest,
  PluginPageHelpCommand,
  PluginStaticPageSection,
  PluginViewerManifest,
} from "@/types";

const FALLBACK_LOCALES = ["en"];

let currentPluginLocale = "en";

export type PluginI18nApi = {
  readonly language: string;
  readonly locale: string;
  t: (key: string, fallback?: string) => string;
  has: (key: string) => boolean;
};

export const setCurrentPluginLocale = (locale: string): boolean => {
  const nextLocale = normalizeLocale(locale);

  if (currentPluginLocale === nextLocale) {
    return false;
  }

  currentPluginLocale = nextLocale;
  return true;
};

export const getCurrentPluginLocale = () => currentPluginLocale;

export const createPluginI18nApi = (plugin: GlimpsePlugin): PluginI18nApi => ({
  get language() {
    return getCurrentPluginLocale();
  },
  get locale() {
    return getCurrentPluginLocale();
  },
  t: (key, fallback = key) => translatePluginString(plugin, key, fallback),
  has: (key) => translatePluginValue(plugin.i18n, key) !== undefined,
});

export const translatePluginString = (
  plugin: GlimpsePlugin,
  key: string,
  fallback: string,
): string => {
  const value = translatePluginValue(plugin.i18n, key);

  return typeof value === "string" ? value : fallback;
};

export const localizePlugin = (plugin: GlimpsePlugin): GlimpsePlugin => ({
  ...plugin,
  name: translatePluginString(plugin, "name", plugin.name),
  description: plugin.description
    ? translatePluginString(plugin, "description", plugin.description)
    : plugin.description,
  contributes: plugin.contributes
    ? {
        ...plugin.contributes,
        internalPages: plugin.contributes.internalPages?.map((page) =>
          localizeInternalPage(plugin, page),
        ),
        actions: plugin.contributes.actions?.map((action) =>
          localizeAction(plugin, action),
        ),
        viewers: plugin.contributes.viewers?.map((viewer) =>
          localizeViewer(plugin, viewer),
        ),
      }
    : plugin.contributes,
  internalPages: plugin.internalPages?.map((page) =>
    localizeInternalPage(plugin, page),
  ),
});

export const localizeInternalPage = (
  plugin: GlimpsePlugin,
  page: PluginInternalPageManifest,
): PluginInternalPageManifest => {
  const keys = pageKeyFactory(plugin, page);

  return {
    ...page,
    title: translateFirst(plugin, keys("title"), page.title),
    aliases:
      translateFirstArray(plugin, keys("aliases"), page.aliases) ??
      page.aliases,
    pageAction: page.pageAction
      ? {
          ...page.pageAction,
          inputPlaceholder: page.pageAction.inputPlaceholder
            ? translateFirst(
                plugin,
                keys("pageAction.inputPlaceholder", "inputPlaceholder"),
                page.pageAction.inputPlaceholder,
              )
            : page.pageAction.inputPlaceholder,
          examples:
            translateFirstArray(
              plugin,
              keys("pageAction.examples", "examples"),
              page.pageAction.examples,
            ) ?? page.pageAction.examples,
        }
      : page.pageAction,
    help: page.help
      ? {
          ...page.help,
          description: page.help.description
            ? translateFirst(
                plugin,
                keys("help.description", "description"),
                page.help.description,
              )
            : page.help.description,
          examples:
            translateFirstArray(
              plugin,
              keys("help.examples"),
              page.help.examples,
            ) ?? page.help.examples,
          commands: page.help.commands?.map((command) =>
            localizeHelpCommand(plugin, page, command),
          ),
        }
      : page.help,
    staticPage: page.staticPage
      ? {
          ...page.staticPage,
          subtitle: page.staticPage.subtitle
            ? translateFirst(
                plugin,
                keys("staticPage.subtitle", "subtitle"),
                page.staticPage.subtitle,
              )
            : page.staticPage.subtitle,
          sections: page.staticPage.sections?.map((section, index) =>
            localizeStaticSection(plugin, page, section, index),
          ),
        }
      : page.staticPage,
  };
};

export const localizeAction = (
  plugin: GlimpsePlugin,
  action: PluginActionManifest,
): PluginActionManifest => ({
  ...action,
  title: translatePluginString(
    plugin,
    `actions.${action.id}.title`,
    action.title,
  ),
  description: action.description
    ? translatePluginString(
        plugin,
        `actions.${action.id}.description`,
        action.description,
      )
    : action.description,
  aliases:
    readStringArray(
      translatePluginValue(plugin.i18n, `actions.${action.id}.aliases`),
    ) ?? action.aliases,
});

export const localizeViewer = (
  plugin: GlimpsePlugin,
  viewer: PluginViewerManifest,
): PluginViewerManifest => ({
  ...viewer,
  title: translatePluginString(
    plugin,
    `viewers.${viewer.id}.title`,
    viewer.title,
  ),
  description: viewer.description
    ? translatePluginString(
        plugin,
        `viewers.${viewer.id}.description`,
        viewer.description,
      )
    : viewer.description,
});

const localizeHelpCommand = (
  plugin: GlimpsePlugin,
  page: PluginInternalPageManifest,
  command: PluginPageHelpCommand,
): PluginPageHelpCommand => {
  const keys = pageKeyFactory(plugin, page);

  return {
    ...command,
    description: translateFirst(
      plugin,
      keys(
        `help.commands.${command.command}.description`,
        `commands.${command.command}.description`,
      ),
      command.description,
    ),
  };
};

const localizeStaticSection = (
  plugin: GlimpsePlugin,
  page: PluginInternalPageManifest,
  section: PluginStaticPageSection,
  index: number,
): PluginStaticPageSection => {
  const keys = pageKeyFactory(plugin, page);

  return {
    ...section,
    title: translateFirst(
      plugin,
      keys(`staticPage.sections.${index}.title`),
      section.title,
    ),
    rows: section.rows?.map((row, rowIndex) => ({
      label: translateFirst(
        plugin,
        keys(`staticPage.sections.${index}.rows.${rowIndex}.label`),
        row.label,
      ),
      value: translateFirst(
        plugin,
        keys(`staticPage.sections.${index}.rows.${rowIndex}.value`),
        row.value,
      ),
    })),
    paragraphs: section.paragraphs?.map((paragraph, paragraphIndex) =>
      translateFirst(
        plugin,
        keys(`staticPage.sections.${index}.paragraphs.${paragraphIndex}`),
        paragraph,
      ),
    ),
  };
};

const pageKeyFactory =
  (plugin: GlimpsePlugin, page: PluginInternalPageManifest) =>
  (...fields: string[]) => {
    const pageKeys = getPageKeys(plugin, page);

    return fields.flatMap((field) =>
      pageKeys.map((pageKey) => `pages.${pageKey}.${field}`).concat(
        `internalPages.${page.id}.${field}`,
      ),
    );
  };

const getPageKeys = (
  plugin: GlimpsePlugin,
  page: PluginInternalPageManifest,
): string[] => {
  const keys = [
    page.pageAction?.actionId,
    page.id,
    page.id.replace(`plugin:${plugin.id}`, "").replace(/^[:./-]+/, ""),
    "main",
  ].filter((key): key is string => Boolean(key));

  return [...new Set(keys)];
};

const translateFirst = (
  plugin: GlimpsePlugin,
  keys: string[],
  fallback: string,
): string => {
  for (const key of keys) {
    const value = translatePluginValue(plugin.i18n, key);

    if (typeof value === "string") {
      return value;
    }
  }

  return fallback;
};

const translateFirstArray = (
  plugin: GlimpsePlugin,
  keys: string[],
  fallback?: string[],
): string[] | undefined => {
  for (const key of keys) {
    const value = readStringArray(translatePluginValue(plugin.i18n, key));

    if (value) {
      return value;
    }
  }

  return fallback;
};

const translatePluginValue = (
  i18n: PluginI18nManifest | undefined,
  key: string,
): unknown => {
  const dictionaries = getLocaleDictionaries(i18n);

  for (const dictionary of dictionaries) {
    const value = readDictionaryValue(dictionary, key);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

const getLocaleDictionaries = (
  i18n: PluginI18nManifest | undefined,
): PluginI18nDictionary[] => {
  if (!i18n || typeof i18n !== "object") {
    return [];
  }

  const configured = i18n as {
    defaultLocale?: unknown;
    translations?: unknown;
  };
  const source = isLocaleMap(configured.translations)
    ? configured.translations
    : (i18n as Record<string, PluginI18nDictionary>);
  const defaultLocale =
    typeof configured.defaultLocale === "string"
      ? configured.defaultLocale
      : undefined;
  const localeCandidates = [
    currentPluginLocale,
    currentPluginLocale.split("-")[0],
    defaultLocale,
    ...FALLBACK_LOCALES,
  ].filter((locale): locale is string => Boolean(locale));

  return [...new Set(localeCandidates)].flatMap((locale) => {
    const dictionary = source[locale];

    return isDictionary(dictionary) ? [dictionary] : [];
  });
};

const readDictionaryValue = (
  dictionary: PluginI18nDictionary,
  key: string,
): unknown => {
  if (Object.prototype.hasOwnProperty.call(dictionary, key)) {
    return dictionary[key];
  }

  return key.split(".").reduce<unknown>((current, part) => {
    if (!isDictionary(current)) {
      return undefined;
    }

    return current[part];
  }, dictionary);
};

const readStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;

const isDictionary = (value: unknown): value is PluginI18nDictionary =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isLocaleMap = (
  value: unknown,
): value is Record<string, PluginI18nDictionary> =>
  isDictionary(value) && Object.values(value).every(isDictionary);

const normalizeLocale = (locale: string) => locale.trim() || "en";
