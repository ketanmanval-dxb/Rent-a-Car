import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Migrations use a direct (non-pooled) connection when one is provided.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
