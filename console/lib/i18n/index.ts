/**
 * One language decides the interface, the terminal client and what a run writes
 * for people. French unless the setting says `en`, unset or unknown included.
 */
export type Language = "fr" | "en";
export const LANGUAGES: readonly Language[] = ["fr", "en"];
export const DEFAULT_LANGUAGE: Language = "fr";

export function languageOf(value: unknown): Language {
  return typeof value === "string" && value.trim().toLowerCase() === "en" ? "en" : DEFAULT_LANGUAGE;
}

export function isLanguage(value: unknown): value is Language {
  return value === "fr" || value === "en";
}

type Text = string | ((...args: never[]) => string);

/**
 * The French and English forms of each text side by side, the English one
 * typing both, so a key missing in one language or taking other arguments does
 * not compile.
 */
export function defineTexts<T extends Record<string, Text>>(texts: { [K in keyof T]: { en: T[K]; fr: T[K] } }) {
  return texts;
}

type Catalog = Record<string, Record<string, { en: Text; fr: Text }>>;
export type TextsOf<C extends Catalog> = { [A in keyof C]: { [K in keyof C[A]]: C[A][K]["en"] } };

export function pickTexts<C extends Catalog>(catalog: C, language: Language): TextsOf<C> {
  return Object.fromEntries(Object.entries(catalog).map(([area, entries]) => [
    area,
    Object.fromEntries(Object.entries(entries).map(([key, pair]) => [key, pair[language]])),
  ])) as TextsOf<C>;
}

export function locale(language: Language) {
  return language === "fr" ? "fr-FR" : "en-US";
}

/** Hours and minutes on 24 hours, the one clock format the interface uses. */
export function clockTime(language: Language, at: string | number | Date) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(locale(language), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function shortDateTime(language: Language, at: string | number | Date) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(locale(language), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function longDateTime(language: Language, at: string | number | Date) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(locale(language), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function formatNumber(language: Language, value: number) {
  return value.toLocaleString(locale(language));
}
