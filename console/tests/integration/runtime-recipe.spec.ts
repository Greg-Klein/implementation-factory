import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDirectory, sampleCheckout } from "../fixtures";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

/** Where the console keeps the recipe of a checkout, as `runtimeRecipeStore` names it. */
function recipeFile(repository: string) {
  const digest = createHash("sha256").update(path.resolve(repository)).digest("hex").slice(0, 10);
  return path.join(dataDirectory, "repositories", `${path.basename(repository)}-${digest}`, "runtime-recipe.md");
}

test("should show the runtime recipe kept for a repository, and forget it on request", async ({ page }) => {
  const stored = recipeFile(sampleCheckout);
  mkdirSync(path.dirname(stored), { recursive: true });
  writeFileSync(stored, "# Recette d'exécution\n\n## Lancer\n\n- `npm run dev -- --port <port>`\n");

  await page.goto("/");
  await page.getByLabel("Project directory").fill(sampleCheckout);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Runtime recipe" }).click();

  const dialog = page.getByRole("dialog", { name: "Runtime recipe" });
  await expect(dialog).toContainText("npm run dev -- --port <port>");
  await expect(dialog).toContainText(sampleCheckout);

  await dialog.getByRole("button", { name: "Forget the recipe" }).click();
  await expect(dialog).toContainText("No recipe for this repository");
  await expect(dialog.getByRole("button", { name: "Forget the recipe" })).toHaveCount(0);
  expect(existsSync(stored)).toBe(false);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("should show the review findings kept for a repository with the kinds that recur, and forget them on request", async ({ page }) => {
  const stored = path.join(path.dirname(recipeFile(sampleCheckout)), "review-findings.json");
  mkdirSync(path.dirname(stored), { recursive: true });
  const at = new Date(Date.now() - 86_400_000).toISOString();
  const finding = (ticket: number, category: string, summary: string, file?: string) => ({ id: "SR-R1-1", runId: `run-${ticket}-${category}`, ticket: `https://github.com/acme/shop/issues/${ticket}`, at, category, severity: "P1", summary, fixed: true, ...(file ? { file } : {}) });
  writeFileSync(stored, JSON.stringify({ version: 1, findings: [
    finding(1, "ui-state", "The list shows nothing while it loads.", "src/List.tsx"),
    finding(2, "ui-state", "The export button has no error state."),
    finding(2, "edge-case", "An empty cart divides by zero."),
  ] }));

  await page.goto("/");
  await page.getByLabel("Project directory").fill(sampleCheckout);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Runtime recipe" }).click();

  const findings = page.getByRole("dialog", { name: "Runtime recipe" }).getByRole("region", { name: "Review findings" });
  await expect(findings).toContainText("3 findings kept from 2 tickets");
  await expect(findings).toContainText("A loading, empty or error state missing");
  await expect(findings).toContainText("ui-state · 2 findings on 2 tickets");
  await expect(findings).toContainText("src/List.tsx The list shows nothing while it loads.");
  // Found on one ticket only, so no run is told about it.
  await expect(findings).not.toContainText("divides by zero");

  await findings.getByRole("button", { name: "Forget the findings" }).click();
  await expect(findings).toContainText("None kept for this repository");
  await expect(findings.getByRole("button", { name: "Forget the findings" })).toHaveCount(0);
  expect(existsSync(stored)).toBe(false);
});

test("should refuse to read a recipe for anything but an absolute path", async ({ request }) => {
  const response = await request.get("/api/repositories/recipe?repository=..%2F..%2Fetc");
  expect(response.status()).toBe(400);
  expect((await request.get("/api/repositories/findings?repository=..%2F..%2Fetc")).status()).toBe(400);
});
