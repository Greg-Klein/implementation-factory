"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n";
import { texts } from "@/lib/i18n/texts";

/** Fed by the factory snapshot: the server owns the language, the page only shows it. */
export const LanguageContext = createContext<Language>(DEFAULT_LANGUAGE);

export function useLanguage() {
  return useContext(LanguageContext);
}

export function useTexts() {
  return texts(useContext(LanguageContext));
}
