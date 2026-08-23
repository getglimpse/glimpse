import { TranslationFunctions } from "@/i18n/i18n-types";
import { getInternalPageContribution } from "@/features/plugins/pluginRegistry";

type HelpCommand = {
  command: string;
  description: string;
};

export type HelpContent = {
  title: string;
  description: string;
  examplesTitle: string;
  commandsTitle: string;
  examples: string[];
  commands: HelpCommand[];
};

export const hasHelpContent = (page: string): boolean => {
  const contribution = getInternalPageContribution(page);

  return Boolean(
    contribution?.help?.description ||
    contribution?.help?.examples?.length ||
    contribution?.help?.commands?.length ||
    contribution?.staticPage?.subtitle,
  );
};

/**
 * Returns help content for plugin-provided internal pages.
 *
 * The returned object is intended to be rendered by
 * help-related components.
 *
 * @param page Internal help page identifier.
 * @param LL Translation functions provided by typesafe-i18n.
 *
 * @returns Help content for the specified page,
 * or `null` if the page is unsupported.
 */
export const getHelpContent = (
  page: string,
  _LL: TranslationFunctions,
): HelpContent | null => {
  return getPluginHelpContent(page);
};

const getPluginHelpContent = (page: string): HelpContent | null => {
  const contribution = getInternalPageContribution(page);

  if (!contribution) {
    return null;
  }

  const description =
    contribution.help?.description ?? contribution.staticPage?.subtitle ?? "";
  const examples = contribution.help?.examples ?? [];
  const commands = contribution.help?.commands ?? [];

  if (!description && examples.length === 0 && commands.length === 0) {
    return null;
  }

  return {
    title: contribution.title,
    description,
    examplesTitle: "Examples",
    commandsTitle: "Commands",
    examples,
    commands,
  };
};
