import { expect, test } from "@playwright/test";
import { currentRunState, resetRun, runDemoToCompletion } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should offer a simulated feedback field once the demonstration ends", async ({ page, request }) => {
  await runDemoToCompletion(page);

  const field = page.getByLabel("Improve the harness");
  await expect(field).toBeVisible();

  // Les cartes de fin de run se logent dans le panneau, qui absorbe le reste en
  // comprimant le journal : la page elle-meme ne doit jamais defiler.
  const pageOverflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollHeight - root.clientHeight;
  });
  expect(pageOverflow).toBe(0);
  await field.fill("La revue de design manque une vérification de contraste.");
  await page.getByRole("button", { name: "Add to the self-improvement loop" }).click();

  // Le panneau est montre en entier, mais rien ne doit rejoindre la file :
  // un retour simule serait ensuite traite comme du vecu par impl improve.
  await expect(page.getByText("Simulated feedback. Nothing was saved.")).toBeVisible();
  await expect(field).toHaveValue("");

  const state = await currentRunState(request) as { status: string; activities: { title: string }[] };
  expect(state.status).toBe("completed");
  expect(state.activities.map((item) => item.title))
    .not.toContain("Feedback added to the self-improvement loop");
});
