import { defineTexts } from "./index";

export const common = defineTexts({
  language: { en: "Language", fr: "Langue" },
  languageName: { en: "English", fr: "Français" },
  switchLanguage: {
    en: "Interface and runs in English. New runs write in this language; a run already started keeps its own.",
    fr: "Interface et runs en français. Les nouveaux runs écrivent dans cette langue, un run déjà lancé garde la sienne.",
  },
  languageChanged: { en: "Language changed", fr: "Langue changée" },
  languageFromShell: {
    en: "IMPL_LANGUAGE is set in the shell that started the console: it takes over again at the next restart.",
    fr: "IMPL_LANGUAGE est défini dans le shell qui a lancé la console : il reprendra la main au prochain redémarrage.",
  },
});
