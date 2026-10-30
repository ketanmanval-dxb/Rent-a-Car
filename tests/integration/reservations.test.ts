/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";
import { loadContracts, missing } from "../helpers/contracts";
import { createCustomer, DAY, HOUR, pickVehicle, plus, reserve, window } from "../helpers/fixtures";
import { q } from "../helpers/test-db";

// Q3: concurrency, back-to-back, expired holds. Written against the TASKS.md contract.

const c = await loadContracts();
const need = missing(c, ["createReservation", "listBranches", "searchVehicles", "upsertDriverProfile", "uploadLicence", "auth"]);

describe.skipIf(need.length > 0)(`reservations ${need.length ? `(waiting on: ${need.join(", ")})` : ""}`, () => {
  let alice: { id: string }, bob: { id: string };
  beforeAll(async () => {
    [alice, bob] = await Promise.all([createCustomer(c), createCustomer(c)]);
  });

  it("two sessions reserving the same vehicle for overlapping dates at the same time: exactly one wins", async () => {
    const { vehicle, branch, window: w } = await pickVehicle(c, window(3));
    const overlap = { pickupAt: plus(w.pickupAt, DAY), returnAt: plus(w.returnAt, DAY) };
    const [a, b] = await Promise.all([reserve(c, alice.id, vehicle.id, branch.id, w), reserve(c, bob.id, vehicle.id, branch.id, overlap)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.code).toBe("UNAVAILABLE");
  });

  it("ten parallel attempts for identical dates: exactly one succeeds, nine get UNAVAILABLE", async () => {
    const users = [alice, bob, ...(await Promise.all(Array.from({ length: 3 }, () => createCustomer(c))))];
    const { vehicle, branch, window: w } = await pickVehicle(c, window(2));
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => reserve(c, users[i % users.length].id, vehicle.id, branch.id, w)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => r.code === "UNAVAILABLE")).toBe(true);
    const [{ n }] = await q<{ n: string }>(
      "SELECT count(*) AS n FROM reservations WHERE vehicle_id = $1 AND status IN ('PENDING','CONFIRMED','PICKED_UP') AND period && tstzrange($2, $3, '[)')",
      [vehicle.id, w.pickupAt, w.returnAt],
    );
    expect(Number(n)).toBe(1);
  });

  it("back-to-back rentals (one ends exactly when the next begins) both succeed", async () => {
    const { vehicle, branch, window: w } = await pickVehicle(c, window(2));
    const next = { pickupAt: w.returnAt, returnAt: plus(w.returnAt, 2 * DAY) };
    const a = await reserve(c, alice.id, vehicle.id, branch.id, w);
    const b = await reserve(c, bob.id, vehicle.id, branch.id, next);
    expect(a.ok, a.message).toBe(true);
    expect(b.ok, b.message).toBe(true);
  });

  it("back-to-back submitted concurrently both succeed", async () => {
    const { vehicle, branch, window: w } = await pickVehicle(c, window(2));
    const next = { pickupAt: w.returnAt, returnAt: plus(w.returnAt, 2 * DAY) };
    const [a, b] = await Promise.all([reserve(c, alice.id, vehicle.id, branch.id, w), reserve(c, bob.id, vehicle.id, branch.id, next)]);
    expect([a.ok, b.ok]).toEqual([true, true]);
  });

  it("an overlap of a single minute is rejected", async () => {
    const { vehicle, branch, window: w } = await pickVehicle(c, window(2));
    expect((await reserve(c, alice.id, vehicle.id, branch.id, w)).ok).toBe(true);
    const r = await reserve(c, bob.id, vehicle.id, branch.id, { pickupAt: plus(w.returnAt, -60_000), returnAt: plus(w.returnAt, DAY) });
    expect(r).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });

  it("rejects invalid periods (return before pick-up, zero length, in the past)", async () => {
    const { vehicle, branch, window: w } = await pickVehicle(c, window(2));
    for (const bad of [
      { pickupAt: w.returnAt, returnAt: w.pickupAt },
      { pickupAt: w.pickupAt, returnAt: w.pickupAt },
      { pickupAt: new Date(Date.now() - 3 * DAY), returnAt: new Date(Date.now() - DAY) },
    ]) {
      const r = await reserve(c, alice.id, vehicle.id, branch.id, bad);
      expect(r.ok).toBe(false);
    }
  });

  it("a reservation is created PENDING with a hold expiry ~HOLD_EXPIRY_MINUTES ahead", async () => {
    const { vehicle, branch, window: w } = await pickVehicle(c, window(2));
    const r = await reserve(c, alice.id, vehicle.id, branch.id, w);
    expect(r.ok).toBe(true);
    expect(r.reference).toBeTruthy();
    // Same fallback as the service (DEFAULT_HOLD_EXPIRY_MINUTES); see B2 for the malformed .env.local line.
    const mins = Number(process.env.HOLD_EXPIRY_MINUTES) || 15;
    const delta = new Date(r.holdExpiresAt).getTime() - Date.now();
    expect(delta).toBeGreaterThan((mins - 1) * 60_000);
    expect(delta).toBeLessThanOrEqual(mins * 60_000 + 5_000);
    const [row] = await q<{ status: string }>("SELECT status FROM reservations WHERE id = $1", [r.reservationId]);
    expect(row.status).toBe("PENDING");
  });

  it("an expired (not yet released) hold does not block a new booking", async () => {
    const { vehicle, branch, window: w } = await pickVehicle(c, window(2));
    const a = await reserve(c, alice.id, vehicle.id, branch.id, w);
    expect(a.ok).toBe(true);
    await q("UPDATE reservations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1", [a.reservationId]);
    const b = await reserve(c, bob.id, vehicle.id, branch.id, w);
    expect(b.ok, b.message).toBe(true);
    const [row] = await q<{ status: string }>("SELECT status FROM reservations WHERE id = $1", [a.reservationId]);
    expect(row.status).toBe("EXPIRED");
  });

  it.skipIf(!c.releaseExpiredHolds)("releaseExpiredHolds expires stale holds and is idempotent", async () => {
    const { vehicle, branch, window: w } = await pickVehicle(c, window(2));
    const a = await reserve(c, alice.id, vehicle.id, branch.id, w);
    await q("UPDATE reservations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1", [a.reservationId]);
    await c.releaseExpiredHolds!();
    const [row] = await q<{ status: string }>("SELECT status FROM reservations WHERE id = $1", [a.reservationId]);
    expect(row.status).toBe("EXPIRED");
    await c.releaseExpiredHolds!(); // second run: no error, no change
    const [again] = await q<{ status: string }>("SELECT status FROM reservations WHERE id = $1", [a.reservationId]);
    expect(again.status).toBe("EXPIRED");
    // Vehicle is free again for the same window.
    expect((await reserve(c, bob.id, vehicle.id, branch.id, w)).ok).toBe(true);
  });

  it.skipIf(!c.releaseExpiredHolds)("releaseExpiredHolds leaves unexpired holds alone", async () => {
    const { vehicle, branch, window: w } = await pickVehicle(c, window(2));
    const a = await reserve(c, alice.id, vehicle.id, branch.id, w);
    await c.releaseExpiredHolds!();
    const [row] = await q<{ status: string }>("SELECT status FROM reservations WHERE id = $1", [a.reservationId]);
    expect(row.status).toBe("PENDING");
  });

  it.skipIf(!c.searchVehicles)("search excludes a vehicle held for the window and shows it again for a later window", async () => {
    const { vehicle, branch, window: w } = await pickVehicle(c, window(2));
    expect((await reserve(c, alice.id, vehicle.id, branch.id, w)).ok).toBe(true);
    const during = await c.searchVehicles!({ pickupBranchId: branch.id, returnBranchId: branch.id, ...w });
    expect(during.results.map((r: any) => r.vehicle.id)).not.toContain(vehicle.id);
    const after = await c.searchVehicles!({ pickupBranchId: branch.id, returnBranchId: branch.id, pickupAt: w.returnAt, returnAt: plus(w.returnAt, DAY) });
    expect(after.results.map((r: any) => r.vehicle.id)).toContain(vehicle.id);
  });

  it.skipIf(!c.getAvailabilityCalendar)("availability calendar marks booked days", async () => {
    const { vehicle, branch, window: w } = await pickVehicle(c, window(2));
    expect((await reserve(c, alice.id, vehicle.id, branch.id, w)).ok).toBe(true);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const cal = await c.getAvailabilityCalendar!(vehicle.id, day(w.pickupAt), day(plus(w.returnAt, 3 * DAY)));
    const byDate = Object.fromEntries(cal.map((d: any) => [d.date, d.status]));
    expect(byDate[day(w.pickupAt)]).toBe("booked");
    // Days after the return are inside pickVehicle's free margin.
    expect(byDate[day(plus(w.returnAt, 2 * DAY))]).toBe("available");
  });

  it.skipIf(!c.adminCreateMaintenanceBlock)("a maintenance block makes the vehicle unavailable, and blocks overlapping a booking conflict", async () => {
    const { vehicle, branch, window: w } = await pickVehicle(c, window(2));
    const admin = await (await import("../helpers/fixtures")).createUser(c, "admin");
    const blk = await c.adminCreateMaintenanceBlock!(admin.id, { vehicleId: vehicle.id, startAt: w.pickupAt, endAt: w.returnAt, reason: "QA service" });
    expect(blk.ok ?? true).toBe(true);
    expect(await reserve(c, alice.id, vehicle.id, branch.id, w)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    const later = { pickupAt: plus(w.returnAt, DAY), returnAt: plus(w.returnAt, 3 * DAY) };
    expect((await reserve(c, alice.id, vehicle.id, branch.id, later)).ok).toBe(true);
    const clash = await c.adminCreateMaintenanceBlock!(admin.id, { vehicleId: vehicle.id, startAt: plus(later.pickupAt, HOUR), endAt: plus(later.pickupAt, 5 * HOUR), reason: "clash" });
    expect(clash).toMatchObject({ ok: false, code: "CONFLICT" });
  });
});
