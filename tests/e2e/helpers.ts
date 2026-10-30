import { expect, type Page } from "@playwright/test";

// Selectors use accessible names (labels/roles) so they stay stable across styling changes.
// Adjust here once app's auth pages land (A2).

export const PASSWORD = "QaPassw0rd!234";
export const uniqueEmail = (tag = "cust") => `qa-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

export async function register(page: Page, email: string, password = PASSWORD) {
  await page.goto("/register");
  await page.getByLabel(/name/i).first().fill("QA Customer");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password/i).first().fill(password);
  const confirm = page.getByLabel(/confirm/i);
  if (await confirm.count()) await confirm.fill(password);
  await page.getByRole("button", { name: /register|sign ?up|create account/i }).click();
  await expect(page).not.toHaveURL(/register/);
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
  await expect(page).not.toHaveURL(/login/);
}

export async function logout(page: Page) {
  const btn = page.getByRole("button", { name: /log ?out|sign ?out/i });
  if (!(await btn.isVisible())) {
    // Mobile: logout may live behind a menu toggle.
    await page.getByRole("button", { name: /menu|account/i }).first().click();
  }
  await page.getByRole("button", { name: /log ?out|sign ?out/i }).click();
  await expect(page.getByRole("link", { name: /log ?in|sign ?in/i }).first()).toBeVisible();
}
