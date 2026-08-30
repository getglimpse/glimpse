export type SearchBarViewModel = {
  displayValue: string;
  committedTags: string[];
  unstar: boolean;
  hidden: boolean;
  reverse: boolean;
  internal: boolean;
  pluginPlayground: boolean;
};

export type TagCompletion = {
  tag: string;
  suffix: string;
};

export type TagSuggestionEntry = {
  tag: string;
  count: number;
};

type SearchInputParts = {
  search: string;
  command: string;
};

type SearchSyntaxParts = {
  unstar: boolean;
  hidden: boolean;
  reverse: boolean;
  internal: boolean;
  pluginPlayground: boolean;
  separator: string;
  body: string;
};

type TokenizedSearchBody = {
  committedTags: string[];
  looseSearch: string;
  looseTokens: string[];
};

const splitCommand = (input: string): SearchInputParts => {
  const commandIndex = input.indexOf(">");

  if (commandIndex === -1) {
    return {
      search: input,
      command: "",
    };
  }

  return {
    search: input.slice(0, commandIndex),
    command: input.slice(commandIndex),
  };
};

const splitSearchSyntax = (search: string): SearchSyntaxParts => {
  let index = 0;
  let unstar = false;
  let hidden = false;
  let reverse = false;
  let internal = false;
  let pluginPlayground = false;
  let separator = "";

  while (/\s/.test(search[index] ?? "")) {
    index += 1;
  }

  if (search[index] === "*") {
    unstar = true;
    index += 1;

    const separatorStart = index;

    while (/\s/.test(search[index] ?? "")) {
      index += 1;
    }

    separator = search.slice(separatorStart, index);
  }

  if (search[index] === "!") {
    hidden = true;
    index += 1;

    const separatorStart = index;

    while (/\s/.test(search[index] ?? "")) {
      index += 1;
    }

    separator = search.slice(separatorStart, index);
  }

  if (search[index] === "^") {
    reverse = true;
    index += 1;

    const separatorStart = index;

    while (/\s/.test(search[index] ?? "")) {
      index += 1;
    }

    separator = search.slice(separatorStart, index);
  }

  if (search[index] === ":" || search[index] === "/") {
    internal = search[index] === ":";
    pluginPlayground = search[index] === "/";
    index += 1;

    const separatorStart = index;

    while (/\s/.test(search[index] ?? "")) {
      index += 1;
    }

    separator = search.slice(separatorStart, index);
  }

  return {
    unstar,
    hidden,
    reverse,
    internal,
    pluginPlayground,
    separator,
    body: search.slice(index),
  };
};

const tokenizeSearchBody = (body: string): TokenizedSearchBody => {
  const committedTags: string[] = [];
  let looseSearch = "";
  const looseTokens: string[] = [];
  const tokenPattern = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(body)) !== null) {
    const token = match[0];
    const tokenEnd = match.index + token.length;
    const isFollowedBySpace =
      tokenEnd < body.length && /\s/.test(body[tokenEnd]);

    if (token.startsWith("#") && token.length > 1 && isFollowedBySpace) {
      committedTags.push(token.slice(1));
      continue;
    }

    const nextTokenIndex = tokenPattern.lastIndex;
    const followingSpaces = body.slice(nextTokenIndex).match(/^\s*/)?.[0] ?? "";

    looseSearch += `${token}${followingSpaces}`;
    looseTokens.push(token);
  }

  return {
    committedTags,
    looseSearch: looseSearch.trimStart(),
    looseTokens,
  };
};

const buildSearch = (
  unstar: boolean,
  hidden: boolean,
  reverse: boolean,
  internal: boolean,
  pluginPlayground: boolean,
  separator: string,
  tags: string[],
  body: string,
  command: string,
) => {
  const scopePrefix = internal ? ":" : pluginPlayground ? "/" : "";
  const prefix = `${unstar ? "*" : ""}${hidden ? "!" : ""}${reverse ? "^" : ""}${scopePrefix}`;
  const tagText = tags.map((tag) => `#${tag}`).join(" ");
  const nextBody = body.trimStart();

  if (!tagText) {
    return `${prefix}${separator}${nextBody}${command}`;
  }

  const tagSeparator =
    (internal || pluginPlayground) && !separator ? " " : separator;

  return `${prefix}${tagSeparator}${tagText} ${nextBody}${command}`;
};

export const getSearchBarViewModel = (input: string): SearchBarViewModel => {
  const { search, command } = splitCommand(input);
  const { unstar, hidden, reverse, internal, pluginPlayground, body } =
    splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);

  return {
    displayValue: `${looseSearch}${command}`,
    committedTags,
    unstar,
    hidden,
    reverse,
    internal,
    pluginPlayground,
  };
};

export const buildSearchInputFromDisplay = (
  previousInput: string,
  nextDisplayValue: string,
) => {
  const previousSearch = splitCommand(previousInput).search;
  const previousSyntax = splitSearchSyntax(previousSearch);
  const previousTokens = tokenizeSearchBody(previousSyntax.body);

  if (
    !previousSyntax.unstar &&
    !previousSyntax.hidden &&
    !previousSyntax.reverse &&
    !previousSyntax.internal &&
    !previousSyntax.pluginPlayground &&
    previousTokens.committedTags.length === 0
  ) {
    return nextDisplayValue;
  }

  const { search, command } = splitCommand(nextDisplayValue);
  const { unstar, hidden, reverse, internal, pluginPlayground, separator, body } =
    splitSearchSyntax(search);
  const hasPreviousScope =
    previousSyntax.internal || previousSyntax.pluginPlayground;

  return buildSearch(
    previousSyntax.unstar || unstar,
    previousSyntax.hidden || hidden,
    previousSyntax.reverse || reverse,
    hasPreviousScope ? previousSyntax.internal : internal,
    hasPreviousScope ? previousSyntax.pluginPlayground : pluginPlayground,
    unstar ? separator : "",
    previousTokens.committedTags,
    body,
    command,
  );
};

export const removeCommittedTagAt = (input: string, tagIndex: number) => {
  const { search, command } = splitCommand(input);
  const { unstar, hidden, reverse, internal, pluginPlayground, separator, body } =
    splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);
  const nextTags = committedTags.filter((_, index) => index !== tagIndex);

  return buildSearch(
    unstar,
    hidden,
    reverse,
    internal,
    pluginPlayground,
    separator,
    nextTags,
    looseSearch,
    command,
  );
};

export const removeUnstarFilter = (input: string) => {
  const { search, command } = splitCommand(input);
  const { hidden, reverse, internal, pluginPlayground, body } =
    splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);

  return buildSearch(
    false,
    hidden,
    reverse,
    internal,
    pluginPlayground,
    "",
    committedTags,
    looseSearch,
    command,
  );
};

export const toggleUnstarFilter = (input: string) => {
  const { search, command } = splitCommand(input);
  const { unstar, hidden, reverse, internal, pluginPlayground, separator, body } =
    splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);

  return buildSearch(
    !unstar,
    hidden,
    reverse,
    internal,
    pluginPlayground,
    !unstar ? separator : "",
    committedTags,
    looseSearch,
    command,
  );
};

export const removeHiddenFilter = (input: string) => {
  const { search, command } = splitCommand(input);
  const { unstar, reverse, internal, pluginPlayground, separator, body } =
    splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);

  return buildSearch(
    unstar,
    false,
    reverse,
    internal,
    pluginPlayground,
    unstar ? separator : "",
    committedTags,
    looseSearch,
    command,
  );
};

export const removeReverseSearch = (input: string) => {
  const { search, command } = splitCommand(input);
  const { unstar, hidden, internal, pluginPlayground, separator, body } =
    splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);

  return buildSearch(
    unstar,
    hidden,
    false,
    internal,
    pluginPlayground,
    unstar ? separator : "",
    committedTags,
    looseSearch,
    command,
  );
};

export const removeInternalFilter = (input: string) => {
  const { search, command } = splitCommand(input);
  const { unstar, hidden, reverse, pluginPlayground, separator, body } =
    splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);

  return buildSearch(
    unstar,
    hidden,
    reverse,
    false,
    pluginPlayground,
    unstar ? separator : "",
    committedTags,
    looseSearch,
    command,
  );
};

export const removePluginPlaygroundFilter = (input: string) => {
  const { search, command } = splitCommand(input);
  const { unstar, hidden, reverse, internal, separator, body } =
    splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);

  return buildSearch(
    unstar,
    hidden,
    reverse,
    internal,
    false,
    unstar ? separator : "",
    committedTags,
    looseSearch,
    command,
  );
};

export const toggleHiddenFilter = (input: string) => {
  const { search, command } = splitCommand(input);
  const { unstar, hidden, reverse, internal, pluginPlayground, separator, body } =
    splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);

  return buildSearch(
    unstar,
    !hidden,
    reverse,
    internal,
    pluginPlayground,
    unstar ? separator : "",
    committedTags,
    looseSearch,
    command,
  );
};

export const toggleReverseSearch = (input: string) => {
  const { search, command } = splitCommand(input);
  const { unstar, hidden, reverse, internal, pluginPlayground, separator, body } =
    splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);

  return buildSearch(
    unstar,
    hidden,
    !reverse,
    internal,
    pluginPlayground,
    unstar ? separator : "",
    committedTags,
    looseSearch,
    command,
  );
};

export const toggleInternalFilter = (input: string) => {
  const { search, command } = splitCommand(input);
  const { unstar, hidden, reverse, internal, separator, body } =
    splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);

  return buildSearch(
    unstar,
    hidden,
    reverse,
    !internal,
    false,
    unstar ? separator : "",
    committedTags,
    looseSearch,
    command,
  );
};

export const togglePluginPlaygroundFilter = (input: string) => {
  const { search, command } = splitCommand(input);
  const { unstar, hidden, reverse, pluginPlayground, separator, body } =
    splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);

  return buildSearch(
    unstar,
    hidden,
    reverse,
    false,
    !pluginPlayground,
    unstar ? separator : "",
    committedTags,
    looseSearch,
    command,
  );
};

export const getTagCompletion = ({
  displayValue,
  committedTags,
  availableTags,
}: {
  displayValue: string;
  committedTags: string[];
  availableTags: string[];
}): TagCompletion | null => {
  const { search, command } = splitCommand(displayValue);

  if (command) {
    return null;
  }

  const { body } = splitSearchSyntax(search);

  if (!body || /\s$/.test(body)) {
    return null;
  }

  const activeToken = body.match(/(?:^|\s)(#[^\s]*)$/)?.[1];

  if (!activeToken) {
    return null;
  }

  const typedTag = activeToken.slice(1);
  const normalizedTypedTag = typedTag.toLowerCase();
  const committedTagSet = new Set(
    committedTags.map((tag) => tag.toLowerCase()),
  );

  const suggestion = availableTags.find((tag) => {
    const normalizedTag = tag.toLowerCase();

    return (
      normalizedTag.startsWith(normalizedTypedTag) &&
      normalizedTag !== normalizedTypedTag &&
      !committedTagSet.has(normalizedTag)
    );
  });

  if (!suggestion) {
    return null;
  }

  return {
    tag: suggestion,
    suffix: suggestion.slice(typedTag.length),
  };
};

export const completeActiveTag = (displayValue: string, tag: string) => {
  const { search, command } = splitCommand(displayValue);
  const { unstar, hidden, reverse, internal, pluginPlayground, separator, body } =
    splitSearchSyntax(search);
  const nextBody = body.replace(/(?:^|\s)(#[^\s]*)$/, (match) => {
    const leadingSpace = match.startsWith("#") ? "" : match[0];

    return `${leadingSpace}#${tag} `;
  });

  return buildSearch(
    unstar,
    hidden,
    reverse,
    internal,
    pluginPlayground,
    separator,
    [],
    nextBody,
    command,
  );
};

export const commitActiveTag = (displayValue: string) => {
  const { search, command } = splitCommand(displayValue);

  if (command) {
    return null;
  }

  const { unstar, hidden, reverse, internal, pluginPlayground, separator, body } =
    splitSearchSyntax(search);

  if (!body || /\s$/.test(body)) {
    return null;
  }

  const activeTag = body.match(/(?:^|\s)(#[^\s]+)$/)?.[1];

  if (!activeTag || activeTag.length <= 1) {
    return null;
  }

  return buildSearch(
    unstar,
    hidden,
    reverse,
    internal,
    pluginPlayground,
    separator,
    [],
    `${body} `,
    command,
  );
};

export const sortTagSuggestions = (entries: TagSuggestionEntry[]) =>
  [...entries]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .map((entry) => entry.tag);
