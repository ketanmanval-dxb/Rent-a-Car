import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // "server-only" throws outside RSC; server modules are tested directly here.
    alias: { "server-only": path.resolve("tests/helpers/empty-module.ts") },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    // Migrates driveeasy_test before the run; QA_FRESH_DB=1 resets it from clean + seeds.
    globalSetup: ["tests/global-setup.ts"],
    // Temp dirs for fake payment state + uploads; no webhook POSTs during vitest.
    setupFiles: ["tests/setup-env.ts"],
    // Integration tests hit a real database and race transactions on purpose.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // Tests must never touch the dev database.
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "", DATABASE_URL_UNPOOLED: process.env.TEST_DATABASE_URL ?? "" },
  },
});
