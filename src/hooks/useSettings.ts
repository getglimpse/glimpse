import { useCallback, useEffect, useState } from "react";

import { settingsApi } from "@/api/settings";
import { KeybindingMap, Language } from "@/types";
import { getStoredStartupTheme } from "./useTheme";

export const useSettings = () => {
  const [themeId, setThemeId] = useState(getStoredStartupTheme);
  const [compactListItems, setCompactListItems] = useState(false);
  const [keybindings, setKeybindings] = useState<KeybindingMap>({});
  const [language, setLanguage] = useState<Language>("en");
  const [currentTargetGroupName, setCurrentTargetGroupName] =
    useState<string | null>(null);

  const applySettings = useCallback((settings: Awaited<ReturnType<typeof settingsApi.get>>) => {
    setThemeId(settings.theme);
    setCompactListItems(settings.ui?.compactListItems ?? false);
    setKeybindings(settings.keybindings ?? {});

    const nextLanguage = settings.ui?.language;

    setLanguage(
      nextLanguage === "ja" || nextLanguage === "en" ? nextLanguage : "en",
    );

    const currentGroup = settings.targetGroups?.find(
      (group) => group.id === settings.currentTargetGroupId,
    );

    setCurrentTargetGroupName(currentGroup?.name ?? null);
  }, []);

  const reloadSettings = useCallback(async () => {
    const settings = await settingsApi.get();
    applySettings(settings);
    return settings;
  }, [applySettings]);

  useEffect(() => {
    void reloadSettings();

    const unlisten = settingsApi.onChanged(() => {
      void reloadSettings();
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [reloadSettings]);

  return {
    themeId,
    setThemeId,
    compactListItems,
    setCompactListItems,
    keybindings,
    language,
    setLanguage,
    currentTargetGroupName,
    setCurrentTargetGroupName,
    reloadSettings,
    applySettings,
  };
};
