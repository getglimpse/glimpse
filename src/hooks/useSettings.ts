import { useCallback, useEffect, useRef, useState } from "react";

import { settingsApi } from "@/api/settings";
import { KeybindingMap, Language } from "@/types";
import { toast } from "@/utils/toast";
import { getStoredStartupTheme } from "./useTheme";

const SETTINGS_LOAD_ERROR_TOAST_ID = "settings-load-error";

export const useSettings = () => {
  const [themeId, setThemeIdState] = useState(getStoredStartupTheme);
  const [compactListItems, setCompactListItemsState] = useState(false);
  const [keybindings, setKeybindings] = useState<KeybindingMap>({});
  const [language, setLanguageState] = useState<Language>("en");
  const [currentTargetGroupName, setCurrentTargetGroupName] = useState<
    string | null
  >(null);
  const themeOverrideRef = useRef<string | null>(null);
  const compactOverrideRef = useRef<boolean | null>(null);
  const languageOverrideRef = useRef<Language | null>(null);
  const compactTimerRef = useRef<number | null>(null);
  const themeChangeRef = useRef(0);
  const compactChangeRef = useRef(0);
  const languageChangeRef = useRef(0);
  const reloadRef = useRef(0);

  const applySettings = useCallback(
    (settings: Awaited<ReturnType<typeof settingsApi.get>>) => {
      if (themeOverrideRef.current === null) {
        setThemeIdState(settings.theme);
      }
      if (compactOverrideRef.current === null) {
        setCompactListItemsState(settings.ui?.compactListItems ?? false);
      }
      setKeybindings(settings.keybindings ?? {});

      const nextLanguage = settings.ui?.language;

      if (languageOverrideRef.current === null) {
        setLanguageState(
          nextLanguage === "ja" ||
            nextLanguage === "en" ||
            nextLanguage === "de"
            ? nextLanguage
            : "en",
        );
      }

      const currentGroup = settings.targetGroups?.find(
        (group) => group.id === settings.currentTargetGroupId,
      );

      setCurrentTargetGroupName(currentGroup?.name ?? null);
    },
    [],
  );

  const reloadSettings = useCallback(async () => {
    const request = ++reloadRef.current;
    try {
      const settings = await settingsApi.get();
      if (request === reloadRef.current) {
        applySettings(settings);
        toast.dismiss(SETTINGS_LOAD_ERROR_TOAST_ID);
      }
      return settings;
    } catch (error) {
      if (request === reloadRef.current) {
        toast.error(`Failed to load settings: ${String(error)}`, {
          id: SETTINGS_LOAD_ERROR_TOAST_ID,
          duration: Infinity,
        });
      }
      throw error;
    }
  }, [applySettings]);

  const setCompactListItems = useCallback(
    (value: boolean) => {
      const change = ++compactChangeRef.current;
      compactOverrideRef.current = value;
      reloadRef.current += 1;
      setCompactListItemsState(value);
      if (compactTimerRef.current !== null) {
        window.clearTimeout(compactTimerRef.current);
      }
      compactTimerRef.current = window.setTimeout(async () => {
        compactTimerRef.current = null;
        try {
          const saved = await settingsApi.set({
            ui: { compactListItems: value },
          });
          if (change === compactChangeRef.current) {
            compactOverrideRef.current = null;
            reloadRef.current += 1;
            applySettings(saved);
          }
        } catch (error) {
          if (change === compactChangeRef.current) {
            compactOverrideRef.current = null;
            toast.error(`Failed to save settings: ${String(error)}`);
            void reloadSettings().catch(console.error);
          }
        }
      }, 500);
    },
    [applySettings, reloadSettings],
  );

  const setLanguage = useCallback(
    (value: Language) => {
      const change = ++languageChangeRef.current;
      languageOverrideRef.current = value;
      reloadRef.current += 1;
      setLanguageState(value);
      void settingsApi
        .set({ ui: { language: value } })
        .then((saved) => {
          if (change === languageChangeRef.current) {
            languageOverrideRef.current = null;
            reloadRef.current += 1;
            applySettings(saved);
          }
        })
        .catch((error) => {
          if (change === languageChangeRef.current) {
            languageOverrideRef.current = null;
            toast.error(`Failed to save settings: ${String(error)}`);
            void reloadSettings().catch(console.error);
          }
        });
    },
    [applySettings, reloadSettings],
  );

  const setThemeId = useCallback(
    (value: string) => {
      const change = ++themeChangeRef.current;
      themeOverrideRef.current = value;
      reloadRef.current += 1;
      setThemeIdState(value);
      void settingsApi
        .set({ theme: value })
        .then((saved) => {
          if (change === themeChangeRef.current) {
            themeOverrideRef.current = null;
            reloadRef.current += 1;
            applySettings(saved);
          }
        })
        .catch((error) => {
          if (change === themeChangeRef.current) {
            themeOverrideRef.current = null;
            toast.error(`Failed to save settings: ${String(error)}`);
            void reloadSettings().catch(console.error);
          }
        });
    },
    [applySettings, reloadSettings],
  );

  useEffect(() => {
    void reloadSettings().catch(console.error);

    const unlisten = settingsApi.onChanged(() => {
      void reloadSettings().catch(console.error);
    });

    return () => {
      if (compactTimerRef.current !== null) {
        window.clearTimeout(compactTimerRef.current);
        compactTimerRef.current = null;
        if (compactOverrideRef.current !== null) {
          void settingsApi
            .set({ ui: { compactListItems: compactOverrideRef.current } })
            .catch(console.error);
        }
      }
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
