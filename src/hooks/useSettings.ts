import { useCallback, useEffect, useState } from "react";

import { settingsApi } from "@/api/settings";
import { KeybindingMap, Language } from "@/types";
import { toast } from "@/utils/toast";
import { getStoredStartupTheme } from "./useTheme";

const SETTINGS_LOAD_ERROR_TOAST_ID = "settings-load-error";

export const useSettings = () => {
  const [themeId, setThemeId] = useState(getStoredStartupTheme);
  const [compactListItems, setCompactListItems] = useState(false);
  const [keybindings, setKeybindings] = useState<KeybindingMap>({});
  const [language, setLanguage] = useState<Language>("en");
  const [currentTargetGroupName, setCurrentTargetGroupName] = useState<
    string | null
  >(null);

  const applySettings = useCallback(
    (settings: Awaited<ReturnType<typeof settingsApi.get>>) => {
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
    },
    [],
  );

  const reloadSettings = useCallback(async () => {
    try {
      const settings = await settingsApi.get();
      applySettings(settings);
      toast.dismiss(SETTINGS_LOAD_ERROR_TOAST_ID);
      return settings;
    } catch (error) {
      toast.error(`Failed to load settings: ${String(error)}`, {
        id: SETTINGS_LOAD_ERROR_TOAST_ID,
        duration: Infinity,
      });
      throw error;
    }
  }, [applySettings]);

  useEffect(() => {
    void reloadSettings().catch(console.error);

    const unlisten = settingsApi.onChanged(() => {
      void reloadSettings().catch(console.error);
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
