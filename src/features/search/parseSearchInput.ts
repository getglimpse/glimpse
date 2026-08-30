export type ParsedSearchInput = {
  query: string;
  tags: string[];
  commandArgs: string | null;
  unstar: boolean;
  hidden: boolean;
  reverse: boolean;
};

export const parseSearchInput = (input: string): ParsedSearchInput => {
  const commandIndex = input.indexOf(">");

  const rawSearch =
    commandIndex === -1 ? input.trim() : input.slice(0, commandIndex).trim();

  const commandArgs =
    commandIndex === -1 ? null : input.slice(commandIndex + 1).trim();

  const trimmed = rawSearch.trimStart();
  const unstar = trimmed.startsWith("*");
  const searchPrefixRemoved = unstar
    ? trimmed.slice(1).trimStart()
    : trimmed;
  const hidden = searchPrefixRemoved.startsWith("!");
  const hiddenPrefixRemoved = hidden
    ? searchPrefixRemoved.slice(1).trimStart()
    : searchPrefixRemoved;
  const reverse = hiddenPrefixRemoved.startsWith("^");

  const searchPart = reverse
    ? hiddenPrefixRemoved.slice(1).trim()
    : hiddenPrefixRemoved.trim();

  const tags: string[] = [];
  const queryTokens: string[] = [];

  for (const token of searchPart.split(/\s+/)) {
    if (!token) continue;

    if (token.startsWith("#") && token.length > 1) {
      tags.push(token.slice(1));
      continue;
    }

    queryTokens.push(token);
  }

  return {
    query: queryTokens.join(" "),
    tags,
    unstar,
    hidden,
    reverse,
    commandArgs,
  };
};
