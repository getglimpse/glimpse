import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { Locales, TranslationFunctions } from "./i18n-types";
import { loadLocaleAsync } from "./i18n-util.async";
import { i18nObject, isLocale } from "./i18n-util";

type I18nContextValue = {
  locale: Locales;
  LL: TranslationFunctions;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider = ({
  locale,
  children,
}: {
  locale: string;
  children: React.ReactNode;
}) => {
  const safeLocale: Locales = isLocale(locale) ? locale : "en";
  const [loadedLocale, setLoadedLocale] = useState<Locales | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadLocaleAsync(safeLocale).then(() => {
      if (!cancelled) {
        setLoadedLocale(safeLocale);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [safeLocale]);

  const value = useMemo<I18nContextValue | null>(() => {
    if (!loadedLocale) return null;

    return {
      locale: loadedLocale,
      LL: i18nObject(loadedLocale),
    };
  }, [loadedLocale]);

  if (!value) {
    return null;
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18nContext = () => {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18nContext must be used inside I18nProvider");
  }

  return context;
};