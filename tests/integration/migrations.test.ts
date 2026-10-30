import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, hasMigrations, q, tableExists } from "../helpers/test-db";

// Schema checks on driveeasy_test after migrations (global-setup applies them;
// `QA_FRESH_DB=1 pnpm test` proves they apply on a clean database).
// Column-name agnostic where possible so they survive schema iterations.

const DOMAIN_TABLES = [
  "driver_profiles", "branches", "vehicle_categories", "vehicles", "vehicle_features", "vehicle_feature_map",
  "pricing_rules", "extras", "reservations", "reservation_extras", "payments", "deposits", "rental_agreements",
  "damage_reports", "maintenance_blocks", "audit_logs",
];

describe.skipIf(!process.env.TEST_DATABASE_URL || !hasMigrations())("migrations (driveeasy_test)", () => {
  it("applied every migration in the drizzle journal", async () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
    const [{ n }] = await q<{ n: string }>("SELECT count(*) AS n FROM drizzle.__drizzle_migrations");
    expect(Number(n)).toBe(journal.entries.length);
  });

  it("creates all domain tables and a users table", async () => {
    const missing: string[] = [];
    for (const t of DOMAIN_TABLES) if (!(await tableExists(t))) missing.push(t);
    expect(missing).toEqual([]);
    expect((await tableExists("users")) || (await tableExists("user"))).toBe(true);
  });

  it("uses uuid primary keys on domain tables", async () => {
    const rows = await q<{ table_name: string; data_type: string }>(`
      SELECT tc.table_name, c.data_type
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_name = tc.table_name
      JOIN information_schema.columns c ON c.table_name = k.table_name AND c.column_name = k.column_name AND c.table_schema = 'public'
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = ANY($1)`, [DOMAIN_TABLES]);
    // Join tables may use composite keys of uuids; every PK column must be uuid.
    expect(rows.filter((r) => r.data_type !== "uuid")).toEqual([]);
  });

  it("has exclusion constraints preventing overlaps on reservations and maintenance_blocks", async () => {
    const rows = await q<{ tbl: string; def: string }>(`
      SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE contype = 'x' AND connamespace = 'public'::regnamespace`);
    const tables = rows.map((r) => r.tbl.replace(/^public\./, ""));
    // Either directly on both tables, or on a shared occupancy table fed by triggers.
    const direct = tables.includes("reservations") && tables.includes("maintenance_blocks");
    const shared = tables.some((t) => /occupanc/.test(t));
    expect(direct || shared, `exclusion constraints found on: ${tables.join(", ") || "none"}`).toBe(true);
    for (const r of rows) expect(r.def).toMatch(/gist/i);
    for (const r of rows) expect(r.def).toMatch(/&&/);
  });

  it("enforces unique plate, VIN and branch code", async () => {
    const rows = await q<{ tbl: string; cols: string }>(`
      SELECT i.indrelid::regclass::text AS tbl, string_agg(a.attname, ',') AS cols
      FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indisunique AND i.indrelid::regclass::text IN ('vehicles','branches','public.vehicles','public.branches')
      GROUP BY i.indexrelid, i.indrelid`);
    const uniq = rows.map((r) => `${r.tbl.replace(/^public\./, "")}:${r.cols}`);
    expect(uniq.some((u) => /^vehicles:.*plate/.test(u))).toBe(true);
    expect(uniq.some((u) => /^vehicles:.*vin/i.test(u))).toBe(true);
    expect(uniq.some((u) => /^branches:.*code/.test(u))).toBe(true);
  });

  it("defines status enums for vehicles, reservations, payments and deposits", async () => {
    const rows = await q<{ typname: string }>(`SELECT typname FROM pg_type WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace`);
    const names = rows.map((r) => r.typname).join(" ");
    for (const kind of ["vehicle", "reservation", "payment", "deposit"]) expect(names).toMatch(new RegExp(`${kind}\\w*status|status\\w*${kind}`));
  });

  it("stores money as integers (no float/numeric money columns)", async () => {
    const rows = await q<{ table_name: string; column_name: string; data_type: string }>(`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name ~ '(price|amount|fee|rate|total|deposit|tax|charge|minor|fils)'
        AND data_type IN ('real','double precision','numeric','money')`);
    expect(rows).toEqual([]);
  });

  it("stores all timestamps as timestamptz", async () => {
    const rows = await q<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`);
    expect(rows).toEqual([]);
  });

  it("has foreign keys from reservations to vehicles and users", async () => {
    const rows = await q<{ target: string }>(`
      SELECT confrelid::regclass::text AS target FROM pg_constraint
      WHERE contype = 'f' AND conrelid = 'public.reservations'::regclass`);
    const targets = rows.map((r) => r.target.replace(/^public\./, "").replace(/"/g, ""));
    expect(targets).toContain("vehicles");
    expect(targets.some((t) => t === "users" || t === "user")).toBe(true);
  });

  it("indexes every foreign key column on reservations (lookup performance)", async () => {
    const rows = await q<{ col: string; indexed: boolean }>(`
      SELECT a.attname AS col,
        EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]) AS indexed
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.conrelid = 'public.reservations'::regclass`);
    // vehicle_id is covered by the exclusion constraint's gist index (leading column).
    const gist = await q<{ def: string }>(`SELECT indexdef AS def FROM pg_indexes WHERE tablename = 'reservations'`);
    const unindexed = rows.filter((r) => !r.indexed && !gist.some((g) => new RegExp(`\\(${r.col}\\b`).test(g.def)));
    expect(unindexed.map((r) => r.col)).toEqual([]);
  });
});
