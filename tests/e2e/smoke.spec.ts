import { expect, test } from "@playwright/test";

// Runs on desktop-chromium, mobile-chromium and desktop-webkit.

test("home page renders without console errors or horizontal overflow", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("banner").or(page.locator("header")).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("home page offers a search form with branch and dates", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel(/pick.?up (branch|location)/i).first()).toBeVisible();
  await expect(page.getByLabel(/pick.?up (date|time)/i).first()).toBeVisible();
  await expect(page.getByLabel(/return (date|time)/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /search/i })).toBeVisible();
});

test("protected pages redirect anonymous users to login", async ({ page }) => {
  for (const p of ["/account", "/rentals", "/admin"]) {
    await page.goto(p);
    await expect(page, p).toHaveURL(/login|sign-?in/);
  }
});
