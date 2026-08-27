export type SearchBarViewModel = {
  displayValue: string;
  committedTags: string[];
  hidden: boolean;
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
  star: boolean;
  hidden: boolean;
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
  let star = false;
  let hidden = false;
  let separator = "";

  while (/\s/.test(search[index] ?? "")) {
    index += 1;
  }

  if (search[index] === "*") {
    star = true;
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

  return {
    star,
    hidden,
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
  star: boolean,
  hidden: boolean,
  separator: string,
  tags: string[],
  body: string,
  command: string,
) => {
  const prefix = `${star ? "*" : ""}${hidden ? "!" : ""}`;
  const tagText = tags.map((tag) => `#${tag}`).join(" ");
  const nextBody = body.trimStart();

  if (!tagText) {
    return `${prefix}${separator}${nextBody}${command}`;
  }

  return `${prefix}${separator}${tagText} ${nextBody}${command}`;
};

export const getSearchBarViewModel = (input: string): SearchBarViewModel => {
  const { search, command } = splitCommand(input);
  const { star, hidden, separator, body } = splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);
  const displayPrefix = star ? "*" : "";

  return {
    displayValue: `${displayPrefix}${star ? separator : ""}${looseSearch}${command}`,
    committedTags,
    hidden,
  };
};

export const buildSearchInputFromDisplay = (
  previousInput: string,
  nextDisplayValue: string,
) => {
  const previousSearch = splitCommand(previousInput).search;
  const previousSyntax = splitSearchSyntax(previousSearch);
  const previousTokens = tokenizeSearchBody(previousSyntax.body);

  if (!previousSyntax.hidden && previousTokens.committedTags.length === 0) {
    return nextDisplayValue;
  }

  const { search, command } = splitCommand(nextDisplayValue);
  const { star, hidden, separator, body } = splitSearchSyntax(search);

  return buildSearch(
    star,
    previousSyntax.hidden || hidden,
    star ? separator : "",
    previousTokens.committedTags,
    body,
    command,
  );
};

export const removeCommittedTagAt = (input: string, tagIndex: number) => {
  const { search, command } = splitCommand(input);
  const { star, hidden, separator, body } = splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);
  const nextTags = committedTags.filter((_, index) => index !== tagIndex);

  return buildSearch(star, hidden, separator, nextTags, looseSearch, command);
};

export const removeHiddenFilter = (input: string) => {
  const { search, command } = splitCommand(input);
  const { star, separator, body } = splitSearchSyntax(search);
  const { committedTags, looseSearch } = tokenizeSearchBody(body);

  return buildSearch(
    star,
    false,
    star ? separator : "",
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
  const { star, hidden, separator, body } = splitSearchSyntax(search);
  const nextBody = body.replace(/(?:^|\s)(#[^\s]*)$/, (match) => {
    const leadingSpace = match.startsWith("#") ? "" : match[0];

    return `${leadingSpace}#${tag} `;
  });

  return buildSearch(star, hidden, separator, [], nextBody, command);
};

export const commitActiveTag = (displayValue: string) => {
  const { search, command } = splitCommand(displayValue);

  if (command) {
    return null;
  }

  const { star, hidden, separator, body } = splitSearchSyntax(search);

  if (!body || /\s$/.test(body)) {
    return null;
  }

  const activeTag = body.match(/(?:^|\s)(#[^\s]+)$/)?.[1];

  if (!activeTag || activeTag.length <= 1) {
    return null;
  }

  return buildSearch(star, hidden, separator, [], `${body} `, command);
};

export const sortTagSuggestions = (entries: TagSuggestionEntry[]) =>
  [...entries]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .map((entry) => entry.tag);
