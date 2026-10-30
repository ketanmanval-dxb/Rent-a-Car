// Test database helpers (QA). Only ever touch TEST_DATABASE_URL (driveeasy_test).
//
//   resetTestDb()        drop + recreate the public/drizzle schemas, re-create btree_gist
//   migrateTestDb()      apply ./drizzle migrations (idempotent)
//   seedTestDb()         run the seed script (scripts/seed.*) with DATABASE_URL = test DB
//   freshTestDb()        reset + migrate + seed, serialised with an advisory lock
//
// The CLI wrapper is tests/scripts/reset-test-db.mts.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const ROOT = path.resolve(__dirname, "../..");
export const MIGRATIONS_DIR = path.join(ROOT, "drizzle");
/** Arbitrary constant so concurrent test runs (qa + db) don't migrate/reset at the same time. */
const LOCK_KEY = 4_242_001;

export function loadEnv() {
  const envFile = path.join(ROOT, ".env.local");
  if (!process.env.TEST_DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
}

/** Returns TEST_DATABASE_URL, refusing anything that is not a *_test database. */
export function testDatabaseUrl(): string {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/_test$/.test(name)) throw new Error(`Refusing to use database "${name}": test helpers only run on *_test databases`);
  return url;
}

export function hasMigrations(): boolean {
  return existsSync(MIGRATIONS_DIR) && readdirSync(MIGRATIONS_DIR).some((f) => f.endsWith(".sql"));
}

export function seedScript(): string | undefined {
  const dir = path.join(ROOT, "scripts");
  if (!existsSync(dir)) return undefined;
  const f = readdirSync(dir).find((n) => /^seed\.(mts|ts|mjs|js)$/.test(n));
  return f ? path.join(dir, f) : undefined;
}

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function withLock<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await c.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await c.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  }
}

async function dropEverything(c: Client) {
  await c.query(`
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  `);
}

async function applyMigrations() {
  if (!hasMigrations()) return false;
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const db = drizzle(testDatabaseUrl());
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await db.$client.end();
  }
  return true;
}

export async function resetTestDb() {
  await withClient((c) => withLock(c, () => dropEverything(c)));
}

export async function migrateTestDb(): Promise<boolean> {
  return withClient((c) => withLock(c, applyMigrations));
}

/** Runs the db agent's seed script in a child process against the test DB. */
export function seedTestDb(): boolean {
  const script = seedScript();
  if (!script) return false;
  const tsx = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const res = spawnSync(`"${tsx}" "${script}"`, {
    cwd: ROOT,
    // Node's --env-file never overrides variables already set, so DATABASE_URL stays on the test DB.
    env: { ...process.env, DATABASE_URL: testDatabaseUrl(), DATABASE_URL_UNPOOLED: testDatabaseUrl() },
    encoding: "utf8",
    shell: true,
  });
  if (res.status !== 0) throw new Error(`Seed failed (${res.status}):\n${res.stdout}\n${res.stderr}`);
  return true;
}

/** Clean database -> migrations -> seed. Returns what was done. */
export async function freshTestDb(opts: { seed?: boolean } = {}) {
  return withClient((c) =>
    withLock(c, async () => {
      await dropEverything(c);
      const migrated = await applyMigrations();
      const seeded = migrated && opts.seed !== false ? seedTestDb() : false;
      return { migrated, seeded };
    }),
  );
}

/** One-off query against the test DB. */
export async function q<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return withClient(async (c) => (await c.query<T>(sql, params)).rows);
}

export async function tableExists(name: string) {
  const rows = await q<{ ok: boolean }>("SELECT to_regclass($1) IS NOT NULL AS ok", [`public.${name}`]);
  return rows[0].ok;
}
