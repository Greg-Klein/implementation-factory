import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const brand = path.resolve(import.meta.dirname, "../../brand");
const consoleRoot = path.resolve(import.meta.dirname, "..");
// The sheet reads the console's own tokens, so the image cannot drift from the app.
const globals = readFileSync(path.join(consoleRoot, "app/globals.css"), "utf8");
const tokens = globals.match(/:root\s*\{[^}]*\}/)?.[0];
const darkTokens = globals.match(/:root\[data-theme="dark"\]\s*\{[^}]*\}/)?.[0];
if (!tokens || !darkTokens) throw new Error("Tokens clairs ou sombres introuvables dans globals.css.");
const statusColors = readFileSync(path.join(consoleRoot, "node_modules/tailwindcss/theme.css"), "utf8")
  .match(/--color-(?:amber|red|emerald)-\d+:[^;]+;/g) ?? [];

const themes = [
  { name: "light", label: "Thème clair", file: "brand-sheet.png" },
  { name: "dark", label: "Thème sombre", file: "brand-sheet-dark.png" },
];

const browser = await chromium.launch({ headless: true, channel: process.env.CI ? undefined : "chrome" });
try {
  for (const theme of themes) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(path.join(brand, "sheet.html")).href);
    await page.addStyleTag({ content: `:root { ${statusColors.join(" ")} }\n${tokens}\n${darkTokens}` });
    await page.evaluate(({ name, label }) => {
      document.documentElement.dataset.theme = name;
      for (const element of document.querySelectorAll("[data-theme-label]")) element.textContent = label;
      for (const element of document.querySelectorAll("[data-token]"))
        element.textContent = getComputedStyle(document.documentElement).getPropertyValue(element.getAttribute("data-token")).trim();
    }, theme);
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".sheet").screenshot({ path: path.join(brand, theme.file) });
    await page.close();
  }
} finally {
  await browser.close();
}
