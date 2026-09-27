import { expect, test } from "@playwright/test";
import { artifact, currentRun, currentRunState, resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should keep the document reader open until clarification requires an answer", async ({ page, request }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/?demo=1");
  await page.getByRole("tab", { name: "Preuves" }).click();
  const documents = page.getByRole("button", { name: /Documents générés/ });
  await expect(documents).toContainText("1");
  await documents.click();

  const reader = page.getByRole("dialog", { name: "Documents générés" });
  await expect(reader.getByText("IH-42 · Préférences de notification")).toBeVisible();
  await expect(reader.getByText("Le workflow continue en arrière-plan")).toBeVisible();
  await expect(reader.getByText("Claude attend 2 réponses")).toBeVisible();

  expect(await currentRunState(request)).toMatchObject({ phase: 2, status: "attention" });
  await expect(reader).toBeVisible();

  await reader.getByRole("button", { name: "Répondre" }).click();
  await expect(reader).toBeHidden();
  await expect(page.getByRole("tab", { name: "Conversation" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Décision requise")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();

  await expect(documents).toContainText("3");
  await documents.click();
  await reader.getByRole("button", { name: "implementation-plan.md" }).click();
  await expect(reader.getByText("Ajouter le modèle de préférences.")).toBeVisible();
  await reader.getByRole("button", { name: "Fermer" }).click();

  const agents = page.getByRole("region", { name: "Agents" });
  await expect(agents.getByText(/ · Dev$/).first()).toBeVisible();
  await expect(agents.getByText(/ · Revue$/)).toBeVisible();
  await expect(agents.getByText(/ · Dev$/)).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("should expose only generated documents from the current run", async ({ page, request }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("button", { name: /Documents générés/ })).toContainText("1");

  const { id } = await currentRun(request);
  const response = await artifact(request, id, "ticket-context.md");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    path: "ticket-context.md",
    content: expect.stringContaining("Critères d’acceptation"),
  });
  expect((await artifact(request, id, "not-generated.md")).status()).toBe(404);
  expect((await artifact(request, id, "../run.json")).status()).toBe(404);
  // A document is only ever read through the run that produced it.
  expect((await artifact(request, "demo-unknown", "ticket-context.md")).status()).toBe(404);
});
