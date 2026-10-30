import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { loadContracts, missing } from "../helpers/contracts";
import { createCustomer, createUser, pickVehicle, reserve, window } from "../helpers/fixtures";
import { q } from "../helpers/test-db";

// Q3 payments: success, failure, cancellation, retry, idempotency, refund, deposit hold/release.

const c = await loadContracts();
const need = missing(c, ["createReservation", "payReservation", "getReservationForUser", "upsertDriverProfile", "uploadLicence", "auth"]);

describe.skipIf(need.length > 0)(`payments ${need.length ? `(waiting on: ${need.join(", ")})` : ""}`, () => {
  let user: { id: string };
  beforeAll(async () => {
    user = await createCustomer(c);
  });

  async function pending(w = window(2)) {
    const { vehicle, branch } = await pickVehicle(c, w);
    const r = await reserve(c, user.id, vehicle.id, branch.id, w);
    expect(r.ok, r.message).toBe(true);
    return { id: r.reservationId as string, vehicle, branch, w };
  }
  const pay = (id: string, simulate: "succeed" | "fail" | "cancel", attemptId = randomUUID()) => c.payReservation!(user.id, id, { simulate, attemptId });
  const detail = (id: string) => c.getReservationForUser!(user.id, id);

  it("success confirms the reservation only after charge AND deposit hold", async () => {
    const { id } = await pending();
    expect((await pay(id, "succeed")).ok).toBe(true);
    const d = await detail(id);
    expect(d.status).toBe("CONFIRMED");
    expect(d.payment.status).toMatch(/succeeded/i);
    expect(d.deposit.status).toMatch(/held/i);
    expect(d.deposit.amountFils).toBe(d.quote.depositFils);
  });

  it("failure keeps the reservation PENDING (not confirmed) with a failure reason", async () => {
    const { id } = await pending();
    const r = await pay(id, "fail");
    expect(r).toMatchObject({ ok: false, code: "FAILED" });
    const d = await detail(id);
    expect(d.status).toBe("PENDING");
    expect(d.payment.status).toMatch(/failed/i);
  });

  it("cancellation at checkout does not confirm", async () => {
    const { id } = await pending();
    expect(await pay(id, "cancel")).toMatchObject({ ok: false, code: "CANCELLED" });
    expect((await detail(id)).status).not.toBe("CONFIRMED");
  });

  it("retry after failure with a new attempt succeeds", async () => {
    const { id } = await pending();
    await pay(id, "fail");
    expect((await pay(id, "succeed")).ok).toBe(true);
    expect((await detail(id)).status).toBe("CONFIRMED");
  });

  it("the same attempt submitted twice (double-click) charges once", async () => {
    const { id } = await pending();
    const attempt = randomUUID();
    const [a, b] = await Promise.all([pay(id, "succeed", attempt), pay(id, "succeed", attempt)]);
    expect(a.ok || b.ok).toBe(true);
    const [{ n }] = await q<{ n: string }>("SELECT count(*) AS n FROM payments WHERE reservation_id = $1 AND status = 'SUCCEEDED'", [id]);
    expect(Number(n)).toBe(1);
  });

  it("paying an already-paid reservation with a new attempt is refused (ALREADY_PAID)", async () => {
    const { id } = await pending();
    await pay(id, "succeed");
    expect(await pay(id, "succeed")).toMatchObject({ ok: false, code: "ALREADY_PAID" });
  });

  it("paying after the hold expired is refused (EXPIRED) and nothing is charged", async () => {
    const { id } = await pending();
    await q("UPDATE reservations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1", [id]);
    expect(await pay(id, "succeed")).toMatchObject({ ok: false, code: "EXPIRED" });
    const [{ n }] = await q<{ n: string }>("SELECT count(*) AS n FROM payments WHERE reservation_id = $1 AND status = 'SUCCEEDED'", [id]);
    expect(Number(n)).toBe(0);
  });

  it.skipIf(!c.cancelReservation)("cancelling a confirmed reservation refunds per policy and releases the deposit", async () => {
    const { id } = await pending();
    await pay(id, "succeed");
    const before = await detail(id);
    const r = await c.cancelReservation!(user.id, id);
    expect(r.ok).toBe(true);
    expect(r.refundFils).toBe(before.cancellation.refundFils);
    const d = await detail(id);
    expect(d.status).toMatch(/CANCELLED|REFUNDED/);
    expect(d.deposit.status).toMatch(/released/i);
    if (r.refundFils > 0) expect(d.payment.status).toMatch(/refunded/i);
    // Cancelling twice must not refund twice.
    const again = await c.cancelReservation!(user.id, id);
    expect(again.ok === false || again.refundFils === 0).toBe(true);
  });

  it.skipIf(!c.adminCheckOut || !c.adminCheckIn)("check-out then on-time check-in returns the car and releases the deposit", async () => {
    const admin = await createUser(c, "admin");
    // On time
    // Check-out needs a pick-up close to now.
    const soon = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 3_600_000);
    const onTime = await pending({ pickupAt: soon, returnAt: new Date(soon.getTime() + 86_400_000) });
    await pay(onTime.id, "succeed");
    const [{ km }] = await q<{ km: number }>("SELECT v.mileage_km AS km FROM vehicles v JOIN reservations r ON r.vehicle_id = v.id WHERE r.id = $1", [onTime.id]);
    const co = await c.adminCheckOut!(admin.id, onTime.id, { mileageKm: km + 10, fuelLevel: 8 });
    expect(co.ok, co.message).toBe(true);
    const ci = await c.adminCheckIn!(admin.id, onTime.id, { mileageKm: km + 210, fuelLevel: 8 });
    expect(ci.ok, ci.message).toBe(true);
    const d = await detail(onTime.id);
    expect(d.status).toBe("RETURNED");
    expect(d.deposit.status).toMatch(/released/i);
  });
});
