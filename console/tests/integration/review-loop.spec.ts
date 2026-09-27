import { expect, test } from "@playwright/test";
import { currentRunState, expectDemoCompleted, resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should loop through requested changes, then open a draft merge request while a criterion still fails", async ({ page, request }) => {
  await page.goto("/?demo=1");
  await expect(page.getByText("Décision requise")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();

  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Review 1/2 : changements demandés sur le fallback et sa couverture de test.")).toBeVisible();
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Boucle vers l’implémentation : correction du fallback et ajout du test manquant…")).toBeVisible();
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Review 2/2 : les retours du premier passage sont résolus, mais AC4 reste en échec. Limite de boucle atteinte : la merge request partira en draft.")).toBeVisible();
  await expectDemoCompleted(page);
  // A criterion still failing at the loop limit ships as a draft, and says so.
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Merge request draft simulée prête. Fin de la démonstration.")).toBeVisible();

  await expect.poll(() => currentRunState(request)).toMatchObject({
    status: "completed",
    phase: 10,
    artifacts: expect.arrayContaining(["senior-review-round-1.md", "senior-review-round-2.md", "mr-description.md"]),
    agents: expect.arrayContaining([
      expect.objectContaining({ name: "developer", status: "completed" }),
      expect.objectContaining({ name: "senior-reviewer", status: "completed" }),
    ]),
  });
});
