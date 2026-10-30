import { expect, test } from "@playwright/test";
import { login, logout, register, uniqueEmail } from "./helpers";

test.describe("registration, login, logout", () => {
  test("a new customer can register, log out and log back in", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await expect(page.getByRole("button", { name: /log ?out|sign ?out/i }).or(page.getByRole("link", { name: /account|profile/i })).first()).toBeVisible();
    await logout(page);
    await login(page, email);
    await expect(page).not.toHaveURL(/login/);
  });

  test("login rejects a wrong password without revealing which field was wrong", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await logout(page);
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password/i).fill("WrongPassword!123");
    await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
    await expect(page.getByText(/invalid|incorrect/i).first()).toBeVisible();
    await expect(page).toHaveURL(/login/);
  });

  test("registration rejects a duplicate email", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await logout(page);
    await page.goto("/register");
    await page.getByLabel(/name/i).first().fill("QA Dupe");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password/i).first().fill("QaPassw0rd!234");
    await page.getByRole("button", { name: /register|sign ?up|create account/i }).click();
    await expect(page.getByText(/already|exists|in use/i).first()).toBeVisible();
  });

  test("a customer cannot open the admin area", async ({ page }) => {
    await register(page, uniqueEmail());
    const res = await page.goto("/admin");
    const url = page.url();
    expect(res?.status() === 403 || res?.status() === 404 || !/\/admin/.test(url) || (await page.getByText(/forbidden|not authori[sz]ed|access denied/i).count()) > 0).toBe(true);
  });
});
