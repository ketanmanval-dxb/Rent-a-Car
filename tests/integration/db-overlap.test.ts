import { randomInt, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasMigrations, testDatabaseUrl } from "../helpers/test-db";

// Database-level no-overlap guarantee (D2), independent of app code: real parallel
// transactions on separate connections against reservations / maintenance_blocks
// (mirrored into vehicle_occupancy by triggers, see drizzle/0001_occupancy_exclusion.sql).

const enabled = !!process.env.TEST_DATABASE_URL && hasMigrations();
const DAY = 86_400_000;

describe.skipIf(!enabled)("DB no-overlap constraint (parallel transactions)", () => {
  const admin = new Client({ connectionString: enabled ? testDatabaseUrl() : "" });
  let userId: string, branchId: string, vehicleId: string, vehicle2Id: string;

  const tag = () => randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const vin = () => Array.from({ length: 17 }, () => "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"[randomInt(0, 33)]).join("");

  async function vehicle(categoryId: string) {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO vehicles (branch_id, category_id, make, model, year, plate_number, vin, color, transmission, fuel_type, seats, doors, luggage)
       VALUES ($1,$2,'QA','Probe',2026,$3,$4,'White','AUTOMATIC','PETROL',5,4,2) RETURNING id`,
      [branchId, categoryId, `QA-${tag()}`, vin()],
    );
    return rows[0].id;
  }

  /** Far-future window so runs never collide with each other or with seed data. */
  const win = (days = 2, offset = 0) => {
    const s = Date.UTC(2031 + randomInt(0, 60), randomInt(0, 12), randomInt(1, 28), 6) + offset * DAY;
    return [new Date(s), new Date(s + days * DAY)] as const;
  };

  const insertRes = (c: Client, vid: string, [from, to]: readonly [Date, Date], status = "PENDING") =>
    c.query<{ id: string }>(
      `INSERT INTO reservations (reference, user_id, vehicle_id, pickup_branch_id, return_branch_id, pickup_at, return_at, status, hold_expires_at,
         rental_days, daily_rate_minor, rental_minor, subtotal_minor, vat_minor, total_minor, deposit_minor, pricing_breakdown)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7, now() + interval '15 minutes', 2, 10000, 20000, 20000, 1000, 21000, 100000, '{}'::jsonb)
       RETURNING id`,
      [`DE-${tag()}`, userId, vid, branchId, from, to, status],
    );

  beforeAll(async () => {
    await admin.connect();
    const t = tag();
    userId = (await admin.query(`INSERT INTO users (name, email) VALUES ('QA Probe', $1) RETURNING id`, [`qa-probe-${t.toLowerCase()}@example.test`])).rows[0].id;
    branchId = (await admin.query(`INSERT INTO branches (code, name, city, emirate, address, phone) VALUES ($1,'QA Branch','Dubai','Dubai','QA St','+97140000000') RETURNING id`, [`QA${t.slice(0, 6)}`])).rows[0].id;
    const cat = (await admin.query(`INSERT INTO vehicle_categories (code, name, daily_rate_minor, deposit_minor, late_fee_per_hour_minor) VALUES ($1,'QA',10000,100000,2000) RETURNING id`, [`qa-${t.toLowerCase()}`])).rows[0].id;
    vehicleId = await vehicle(cat);
    vehicle2Id = await vehicle(cat);
  });
  afterAll(() => admin.end());

  it("two parallel transactions booking overlapping periods: exactly one commits, the other gets 23P01", async () => {
    const [a, b] = [new Client({ connectionString: testDatabaseUrl() }), new Client({ connectionString: testDatabaseUrl() })];
    await Promise.all([a.connect(), b.connect()]);
    try {
      const w = win(3);
      const overlap = [new Date(w[0].getTime() + DAY), new Date(w[1].getTime() + DAY)] as const;
      await Promise.all([a.query("BEGIN"), b.query("BEGIN")]);
      // Both insert before either commits: the second insert blocks on the first's index entry.
      const attempt = async (c: Client, period: readonly [Date, Date]) => {
        try {
          await insertRes(c, vehicleId, period);
          await c.query("SELECT pg_sleep(0.2)");
          await c.query("COMMIT");
          return "committed";
        } catch (e) {
          await c.query("ROLLBACK");
          return (e as { code?: string }).code;
        }
      };
      const results = await Promise.all([attempt(a, w), attempt(b, overlap)]);
      // The loser is rejected either by the exclusion check (23P01) or, when both index entries
      // race, by Postgres deadlock detection (40P01). Either way exactly one booking commits.
      // (The app avoids the deadlock path by locking the vehicle row first: see reservations.test.ts.)
      results.sort();
      expect(results[1]).toBe("committed");
      expect(["23P01", "40P01"]).toContain(results[0]);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });

  it("allows back-to-back periods (end == next start)", async () => {
    const w = win(2);
    await insertRes(admin, vehicleId, w);
    await insertRes(admin, vehicleId, [w[1], new Date(w[1].getTime() + DAY)]);
  });

  it("allows the same period on a different vehicle", async () => {
    const w = win(2);
    await insertRes(admin, vehicleId, w);
    await insertRes(admin, vehicle2Id, w);
  });

  it("cancelled / expired reservations free the slot; reactivating into a clash fails", async () => {
    const w = win(2);
    const { rows } = await insertRes(admin, vehicleId, w);
    await admin.query(`UPDATE reservations SET status = 'EXPIRED' WHERE id = $1`, [rows[0].id]);
    await insertRes(admin, vehicleId, w);
    await expect(admin.query(`UPDATE reservations SET status = 'PENDING' WHERE id = $1`, [rows[0].id])).rejects.toMatchObject({ code: "23P01" });
  });

  it("moving a reservation's dates into another booking fails", async () => {
    const w = win(2);
    await insertRes(admin, vehicleId, w);
    const later = await insertRes(admin, vehicleId, [w[1], new Date(w[1].getTime() + 2 * DAY)]);
    await expect(
      admin.query(`UPDATE reservations SET pickup_at = pickup_at - interval '1 hour' WHERE id = $1`, [later.rows[0].id]),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("maintenance blocks conflict with reservations and with each other", async () => {
    const w = win(2);
    await insertRes(admin, vehicleId, w);
    await expect(
      admin.query(`INSERT INTO maintenance_blocks (vehicle_id, starts_at, ends_at, reason) VALUES ($1,$2,$3,'QA')`, [vehicleId, w[0], w[1]]),
    ).rejects.toMatchObject({ code: "23P01" });
    const m = win(1);
    await admin.query(`INSERT INTO maintenance_blocks (vehicle_id, starts_at, ends_at, reason) VALUES ($1,$2,$3,'QA')`, [vehicleId, m[0], m[1]]);
    await expect(insertRes(admin, vehicleId, m)).rejects.toMatchObject({ code: "23P01" });
  });

  it("rejects zero-length and inverted periods", async () => {
    const [s] = win(1);
    await expect(insertRes(admin, vehicleId, [s, s])).rejects.toMatchObject({ code: "23514" });
    // Inverted bounds fail in the generated tstzrange column (22000) before the CHECK: either is a rejection.
    await expect(insertRes(admin, vehicleId, [new Date(s.getTime() + DAY), s])).rejects.toHaveProperty("code", expect.stringMatching(/^(23514|22000)$/));
  });
});
