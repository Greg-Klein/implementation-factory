import { describe, expect, it } from "@jest/globals";
import { clockTime, languageOf, pickTexts } from "../../lib/i18n";
import { CATALOG, texts } from "../../lib/i18n/texts";

describe("the language setting", () => {
  it("should read English whatever its case and spacing", () => {
    expect(languageOf(" EN ")).toBe("en");
  });

  it("should fall back on French for anything else, unset included", () => {
    expect(languageOf(undefined)).toBe("fr");
    expect(languageOf("")).toBe("fr");
    expect(languageOf("de")).toBe("fr");
  });
});

describe("the text catalog", () => {
  const entries = Object.entries(CATALOG).flatMap(([area, texts]) => Object.entries(texts).map(([key, pair]) => ({ name: `${area}.${key}`, pair: pair as { en: unknown; fr: unknown } })));

  it("should give every text the same kind in both languages", () => {
    const mismatched = entries.filter(({ pair }) => typeof pair.en !== typeof pair.fr || (typeof pair.en === "function" && (pair.en as () => string).length !== (pair.fr as () => string).length));
    expect(mismatched.map(({ name }) => name)).toEqual([]);
  });

  it("should hold no empty text and no dash the brand book forbids", () => {
    const faulty = entries.filter(({ pair }) => [pair.en, pair.fr].some((value) => typeof value === "string" && (!value.trim() || /[–—]/.test(value))));
    expect(faulty.map(({ name }) => name)).toEqual([]);
  });

  it("should pick each language's own text", () => {
    expect(pickTexts(CATALOG, "fr").common.language).toBe("Langue");
    expect(texts("en").common.language).toBe("Language");
  });
});

describe("the clock format", () => {
  it("should write hours and minutes on 24 hours in both languages", () => {
    const at = new Date(2026, 9, 28, 17, 5);
    expect(clockTime("fr", at)).toBe("17:05");
    expect(clockTime("en", at)).toBe("17:05");
  });
});
