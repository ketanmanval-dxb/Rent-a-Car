import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export { schema };
export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** A transaction handle (same query API as Db). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything you can run queries on. */
export type DbOrTx = Db | Tx;

// One pool per process. Cached on globalThis so Next.js dev HMR doesn't leak pools.
const globalForDb = globalThis as unknown as { __driveeasyPool?: Pool; __driveeasyDb?: Db };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  // timestamptz values round-trip as JS Dates (absolute instants), so the session time zone
  // never matters to the app; avoid time-zone-dependent SQL (date_trunc etc.) on timestamptz.
  return pool;
}

/** Lazily-created Drizzle client (so importing modules never needs DATABASE_URL at build time). */
export function getDb(): Db {
  if (!globalForDb.__driveeasyDb) {
    globalForDb.__driveeasyPool ??= createPool();
    globalForDb.__driveeasyDb = drizzle({ client: globalForDb.__driveeasyPool, schema });
  }
  return globalForDb.__driveeasyDb;
}

/** Close the pool (scripts/tests). */
export async function closeDb(): Promise<void> {
  const pool = globalForDb.__driveeasyPool;
  globalForDb.__driveeasyPool = undefined;
  globalForDb.__driveeasyDb = undefined;
  await pool?.end();
}
