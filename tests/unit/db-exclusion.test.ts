import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Smoke test that the test database supports the overlapping-rental rule:
// btree_gist + an exclusion constraint on (vehicle, time range).
// Uses a temp table, so it leaves no trace.

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PostgreSQL exclusion constraint (driveeasy_test)", () => {
  const client = new Client({ connectionString: url });
  const car = "00000000-0000-0000-0000-000000000001";

  beforeAll(async () => {
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE booking_probe (
        vehicle_id uuid NOT NULL,
        period tstzrange NOT NULL,
        EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)
      )`);
  });
  afterAll(() => client.end());

  it("rejects an overlapping period for the same vehicle", async () => {
    await client.query(`INSERT INTO booking_probe VALUES ($1, tstzrange('2027-01-01 10:00Z','2027-01-03 10:00Z','[)'))`, [car]);
    await expect(
      client.query(`INSERT INTO booking_probe VALUES ($1, tstzrange('2027-01-02 10:00Z','2027-01-04 10:00Z','[)'))`, [car]),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("allows back-to-back periods (end == next start) with half-open ranges", async () => {
    await client.query(`INSERT INTO booking_probe VALUES ($1, tstzrange('2027-01-03 10:00Z','2027-01-05 10:00Z','[)'))`, [car]);
  });
});
