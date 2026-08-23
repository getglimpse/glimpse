export type ParsedSearchInput = {
  query: string;
  tags: string[];
  commandArgs: string | null;
  global: boolean;
  hidden: boolean;
};

export const parseSearchInput = (input: string): ParsedSearchInput => {
  const commandIndex = input.indexOf(">");

  const rawSearch =
    commandIndex === -1 ? input.trim() : input.slice(0, commandIndex).trim();

  const commandArgs =
    commandIndex === -1 ? null : input.slice(commandIndex + 1).trim();

  const trimmed = rawSearch.trimStart();
  const global = trimmed.startsWith("*");
  const afterGlobal = global ? trimmed.slice(1).trimStart() : trimmed;
  const hidden = afterGlobal.startsWith("!");

  const searchPart = hidden ? afterGlobal.slice(1).trim() : afterGlobal;

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
    global,
    hidden,
    commandArgs,
  };
};
