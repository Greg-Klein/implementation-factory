import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

/**
 * The pill behind the selected tab is measured from the DOM, and the tab bar
 * only exists once a run is going. Measured from a ref, it was never measured
 * at all for a page that arrived on a run already in progress: the pill stayed
 * a zero-width sliver and the white label of the selected tab sat unreadable on
 * the light bar until a click on another tab.
 */
async function selectedTabPill(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const list = document.querySelector('[role="tablist"]');
    const pill = list?.querySelector("span[aria-hidden]");
    const selected = list?.querySelector('[aria-selected="true"]');
    if (!pill || !selected) return { pillWidth: 0, tabWidth: 0, label: selected?.textContent?.trim() };
    return {
      pillWidth: Math.round(pill.getBoundingClientRect().width),
      tabWidth: Math.round(selected.getBoundingClientRect().width),
      label: selected.textContent?.trim(),
    };
  });
}

test("should fill the selected tab from the first frame the tab bar exists", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("tablist", { name: "Session view" }).waitFor();

  // No settling delay on purpose: an indicator that needs one is the bug.
  const onArrival = await selectedTabPill(page);
  expect(onArrival.label).toBe("Conversation");
  expect(onArrival.pillWidth).toBe(onArrival.tabWidth);
  expect(onArrival.pillWidth).toBeGreaterThan(0);
});

test("should keep the selected tab filled across a reload mid-run", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("tab", { name: "Terminal" }).click();

  await page.reload();
  await page.getByRole("tablist", { name: "Session view" }).waitFor();

  // The tab resets to Conversation, the pill must be on it and its size.
  const afterReload = await selectedTabPill(page);
  expect(afterReload.label).toBe("Conversation");
  expect(afterReload.pillWidth).toBe(afterReload.tabWidth);
});

test("should move the pill onto every tab it is sent to", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("tablist", { name: "Session view" }).waitFor();

  for (const label of ["Terminal", "Evidence", "Conversation"]) {
    await page.getByRole("tab", { name: label }).click();
    await expect(async () => {
      const pill = await selectedTabPill(page);
      expect(pill.label).toBe(label);
      expect(pill.pillWidth).toBe(pill.tabWidth);
    }).toPass({ timeout: 2_000 });
  }
});
