export type SearchBarViewModel = {
  displayValue: string;
  committedTags: string[];
};

export type TagCompletion = {
  tag: string;
  suffix: string;
};

type SearchInputParts = {
  search: string;
  command: string;
};

type SearchSyntaxParts = {
  prefix: string;
  body: string;
};

type TokenizedSearchBody = {
  committedTags: string[];
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
  let prefix = "";

  while (/\s/.test(search[index] ?? "")) {
    index += 1;
  }

  if (search[index] === "*") {
    prefix += "*";
    index += 1;

    while (/\s/.test(search[index] ?? "")) {
      index += 1;
    }
  }

  if (search[index] === "!") {
    prefix += "!";
    index += 1;

    while (/\s/.test(search[index] ?? "")) {
      index += 1;
    }
  }

  return {
    prefix,
    body: search.slice(index),
  };
};

const tokenizeSearchBody = (body: string): TokenizedSearchBody => {
  const committedTags: string[] = [];
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

    looseTokens.push(token);
  }

  return {
    committedTags,
    looseTokens,
  };
};

const buildSearch = (
  prefix: string,
  tags: string[],
  body: string,
  command: string,
) => {
  const tagText = tags.map((tag) => `#${tag}`).join(" ");
  const nextBody = body.trimStart();

  if (!tagText) {
    return `${prefix}${nextBody}${command}`;
  }

  const needsTrailingSpace = nextBody || command;

  return `${prefix}${tagText}${needsTrailingSpace ? " " : ""}${nextBody}${command}`;
};

export const getSearchBarViewModel = (input: string): SearchBarViewModel => {
  const { search, command } = splitCommand(input);
  const { prefix, body } = splitSearchSyntax(search);
  const { committedTags, looseTokens } = tokenizeSearchBody(body);
  const looseSearch = looseTokens.join(" ");

  return {
    displayValue: `${prefix}${looseSearch}${command}`,
    committedTags,
  };
};

export const buildSearchInputFromDisplay = (
  previousInput: string,
  nextDisplayValue: string,
) => {
  const previousSearch = splitCommand(previousInput).search;
  const previousSyntax = splitSearchSyntax(previousSearch);
  const previousTokens = tokenizeSearchBody(previousSyntax.body);

  if (previousTokens.committedTags.length === 0) {
    return nextDisplayValue;
  }

  const { search, command } = splitCommand(nextDisplayValue);
  const { prefix, body } = splitSearchSyntax(search);

  return buildSearch(prefix, previousTokens.committedTags, body, command);
};

export const removeCommittedTagAt = (input: string, tagIndex: number) => {
  const { search, command } = splitCommand(input);
  const { prefix, body } = splitSearchSyntax(search);
  const { committedTags, looseTokens } = tokenizeSearchBody(body);
  const nextTags = committedTags.filter((_, index) => index !== tagIndex);

  return buildSearch(prefix, nextTags, looseTokens.join(" "), command);
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
  const { prefix, body } = splitSearchSyntax(search);
  const nextBody = body.replace(/(?:^|\s)(#[^\s]*)$/, (match) => {
    const leadingSpace = match.startsWith("#") ? "" : match[0];

    return `${leadingSpace}#${tag} `;
  });

  return `${prefix}${nextBody}${command}`;
};

export const commitActiveTag = (displayValue: string) => {
  const { search, command } = splitCommand(displayValue);

  if (command) {
    return null;
  }

  const { prefix, body } = splitSearchSyntax(search);

  if (!body || /\s$/.test(body)) {
    return null;
  }

  const activeTag = body.match(/(?:^|\s)(#[^\s]+)$/)?.[1];

  if (!activeTag || activeTag.length <= 1) {
    return null;
  }

  return `${prefix}${body} `;
};
