"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { translate, type Locale, type MessageKey } from "./i18n";

const LocaleContext = createContext<Locale>("it");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

/** `t("chiave", { n: 3 })` nella lingua attiva. Accetta anche chiavi dinamiche (codici d'errore dell'API). */
export function useT() {
  const locale = useLocale();
  return useCallback(
    (key: MessageKey | (string & {}), vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}
