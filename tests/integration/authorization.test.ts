/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { loadContracts, missing } from "../helpers/contracts";
import { createCustomer, DAY, pickVehicle, plus, reserve, window } from "../helpers/fixtures";

// Q4: a customer cannot read or change another customer's reservations; customers can't call admin functions.

const c = await loadContracts();
const need = missing(c, ["createReservation", "getReservationForUser", "upsertDriverProfile", "uploadLicence", "auth"]);

describe.skipIf(need.length > 0)(`authorization ${need.length ? `(waiting on: ${need.join(", ")})` : ""}`, () => {
  let owner: { id: string }, intruder: { id: string }, resId: string;
  let w: { pickupAt: Date; returnAt: Date };
  beforeAll(async () => {
    [owner, intruder] = await Promise.all([createCustomer(c), createCustomer(c)]);
    const ctx = await pickVehicle(c, window(2));
    w = ctx.window;
    const r = await reserve(c, owner.id, ctx.vehicle.id, ctx.branch.id, w);
    expect(r.ok).toBe(true);
    resId = r.reservationId;
  });

  it("owner can read the reservation; another user gets nothing", async () => {
    expect(await c.getReservationForUser!(owner.id, resId)).toBeTruthy();
    expect(await c.getReservationForUser!(intruder.id, resId)).toBeNull();
  });

  it.skipIf(!c.listReservationsForUser)("listing shows only the user's own reservations", async () => {
    const mine = await c.listReservationsForUser!(intruder.id);
    expect(mine.map((r: any) => r.id)).not.toContain(resId);
  });

  it.skipIf(!c.cancelReservation)("another user cannot cancel it", async () => {
    expect((await c.cancelReservation!(intruder.id, resId)).ok).toBe(false);
    expect((await c.getReservationForUser!(owner.id, resId)).status).not.toBe("CANCELLED");
  });

  it.skipIf(!c.modifyReservationDates)("another user cannot change its dates", async () => {
    const r = await c.modifyReservationDates!(intruder.id, resId, { pickupAt: plus(w.pickupAt, DAY), returnAt: plus(w.returnAt, DAY) });
    expect(r.ok).toBe(false);
  });

  it.skipIf(!c.payReservation)("another user cannot pay for it", async () => {
    expect((await c.payReservation!(intruder.id, resId, { simulate: "succeed", attemptId: randomUUID() })).ok).toBe(false);
  });

  it.skipIf(!c.adminCheckOut)("a customer cannot call admin functions", async () => {
    const calls: [string, () => Promise<any>][] = [
      ["adminCheckOut", () => c.adminCheckOut!(owner.id, resId, { mileageKm: 1, fuelLevel: 8 })],
      ...(c.adminCheckIn ? [["adminCheckIn", () => c.adminCheckIn!(owner.id, resId, { mileageKm: 2, fuelLevel: 8 })] as [string, () => Promise<any>]] : []),
      ...(c.adminListReservations ? [["adminListReservations", () => c.adminListReservations!(owner.id, {})] as [string, () => Promise<any>]] : []),
    ];
    for (const [name, call] of calls) {
      const outcome = await call().then((r) => r, (e) => ({ thrown: e }));
      const denied = "thrown" in outcome || outcome?.ok === false;
      expect(denied, `${name} should be denied for a customer`).toBe(true);
    }
  });
});
