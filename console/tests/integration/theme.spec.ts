import { expect, test } from "@playwright/test";

const toggle = "button[aria-label='Dark theme']";
const theme = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.dataset.theme);

test("should follow the system theme until one is picked", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  expect(await theme(page)).toBe("dark");
  await expect(page.locator(toggle)).toHaveAttribute("aria-checked", "true");

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => theme(page)).toBe("light");
  await expect(page.locator(toggle)).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(() => window.localStorage.getItem("impl.theme"))).toBeNull();
});

test("should keep the picked theme across reloads, whatever the system says", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.locator(toggle).click();
  expect(await theme(page)).toBe("dark");
  expect(await page.evaluate(() => window.localStorage.getItem("impl.theme"))).toBe("dark");

  await page.reload();
  expect(await theme(page)).toBe("dark");
  await expect(page.locator(toggle)).toHaveAttribute("aria-checked", "true");

  await page.locator(toggle).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  expect(await theme(page)).toBe("light");
});

test("should paint the dark surfaces from the first frame", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("impl.theme", "dark"));
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(16, 20, 18)");
});
