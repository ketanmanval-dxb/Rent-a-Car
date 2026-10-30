import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// QA runs e2e against a production build on port 3100 so it never clashes with
// the dev server on 3000, and points that server at driveeasy_test (env vars beat .env.local):
//   pnpm build && DATABASE_URL=$TEST_DATABASE_URL DATABASE_URL_UNPOOLED=$TEST_DATABASE_URL pnpm start -p 3100
//   PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm test:e2e
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    // API/security specs are viewport-independent: run them once.
    { name: "api", testMatch: /api\/.*\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-chromium", testIgnore: /api\//, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", testIgnore: /api\//, use: { ...devices["Pixel 7"] } },
    { name: "desktop-webkit", testIgnore: /api\//, use: { ...devices["Desktop Safari"] } },
  ],
  // Without PLAYWRIGHT_BASE_URL, start (or reuse) the production server on 3100. Requires `pnpm build` first.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm start -p 3100",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
        env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "", DATABASE_URL_UNPOOLED: process.env.TEST_DATABASE_URL ?? "" },
      },
});
