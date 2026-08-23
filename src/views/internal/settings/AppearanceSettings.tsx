import { useState } from "react";

import { settingsApi } from "@/api/settings";
import { themesApi } from "@/api/themes";
import { ThemeOption } from "@/constants/themes";
import { useI18nContext } from "@/i18n/I18nProvider";
import { AppSettings } from "@/types";

import { SettingsSection } from "./components/SettingsSection";
import { ThemeList } from "./components/ThemeList";
import { Button } from "@/components/ui/button";

type Props = {
  themeId: string;
  themeOptions: ThemeOption[];
  onThemeChange: (themeId: string) => void;
  onReloadThemes: () => Promise<void>;
  onSettingsChange: (settings: AppSettings) => void;
};

export const AppearanceSettings = ({
  themeId,
  themeOptions,
  onThemeChange,
  onReloadThemes,
  onSettingsChange,
}: Props) => {

  const [isReloading, setIsReloading] = useState(false);

  const reloadThemes = async () => {
    try {
      setIsReloading(true);
      await onReloadThemes();
    } finally {
      setIsReloading(false);
    }
  };

  const { LL } = useI18nContext();

  const selectTheme = async (nextThemeId: string) => {
    onThemeChange(nextThemeId);

    const nextSettings = await settingsApi.set({
      theme: nextThemeId,
    });

    onSettingsChange(nextSettings);
  };

  return (
    <SettingsSection
      title={LL.settingsPage.appearance.title()}
      description={LL.settingsPage.appearance.description()}
    >
      <div className="space-y-5">
        <ThemeList
          themes={themeOptions}
          themeId={themeId}
          onSelect={selectTheme}
        />

        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => themesApi.openFolder()}
            className="rounded-md border border-border-main px-3 py-2 text-sm"
          >
            {LL.settingsPage.appearance.openThemesFolder()}
          </Button>

          <Button
            type="button"
            onClick={() => void reloadThemes()}
            disabled={isReloading}
            className="rounded-md border border-border-main px-3 py-2 text-sm"
          >
            {isReloading
              ? "Reloading..."
              : LL.settingsPage.appearance.reloadThemes()}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
};