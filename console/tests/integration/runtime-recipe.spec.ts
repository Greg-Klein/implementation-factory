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

test("should refuse to read a recipe for anything but an absolute path", async ({ request }) => {
  const response = await request.get("/api/repositories/recipe?repository=..%2F..%2Fetc");
  expect(response.status()).toBe(400);
});
