// utils/internalPageTitle.ts
import type { TranslationFunctions } from "@/i18n/i18n-types";
import type { IndexItem } from "@/types";
import { getInternalPageContribution } from "@/features/plugins/pluginRegistry";

export const getInternalPageTitle = (
  page: Extract<IndexItem["preview"], { type: "internal" }>["page"],
  LL: TranslationFunctions,
): string => {
  switch (page) {
    case "help":
      return LL.helpPage.title();

    case "settings":
      return LL.settingsPage.title();

    case "shortcuts":
      return LL.shortcutsPage.title();

    case "about":
      return LL.aboutPage.title();

    case "debug":
      return LL.debugPage.title();

    case "plugin":
      return LL.pluginPage.title();

    case "command-history":
      return LL.commandHistoryPage.title();

    case "tag-cloud":
      return LL.tagCloudPage.title();

    default:
      {
        const contribution = getInternalPageContribution(page);

        if (contribution) {
          return contribution.title;
        }
      }

      return String(page);
  }
};
