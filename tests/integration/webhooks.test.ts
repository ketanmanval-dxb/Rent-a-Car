/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { loadContracts, missing } from "../helpers/contracts";
import { createCustomer, pickVehicle, reserve, window } from "../helpers/fixtures";
import { q } from "../helpers/test-db";

// Q3 duplicate webhook delivery: call the real route handler (POST /api/webhooks/payments)
// with events recorded by the fake provider, delivered several times (same event id),
// sequentially and in parallel. Side effects must happen once.

const c = await loadContracts();
const need = missing(c, ["createReservation", "payReservation", "cancelReservation", "getReservationForUser", "upsertDriverProfile", "uploadLicence", "auth"]);
const route = await import("@/app/api/webhooks/payments/route").catch(() => null);
const { getPaymentProvider } = await import("@/server/payments");
const { signPayload, SIGNATURE_HEADER } = await import("@/server/payments/webhook-signature");

describe.skipIf(need.length > 0 || !route)("payment webhook route: verification + dedupe", () => {
  let user: { id: string };
  beforeAll(async () => {
    user = await createCustomer(c);
  });

  const post = (body: string, sig: string | null = signPayload(body, process.env.FAKE_PAYMENT_WEBHOOK_SECRET!)) =>
    route!.POST(new Request("http://localhost/api/webhooks/payments", {
      method: "POST",
      headers: { "content-type": "application/json", ...(sig ? { [SIGNATURE_HEADER]: sig } : {}) },
      body,
    }));

  async function paidReservation() {
    const w = window(2);
    const { vehicle, branch } = await pickVehicle(c, w);
    const r = await reserve(c, user.id, vehicle.id, branch.id, w);
    expect(r.ok, r.message).toBe(true);
    expect((await c.payReservation!(user.id, r.reservationId, { simulate: "succeed", attemptId: randomUUID() })).ok).toBe(true);
    return r.reservationId as string;
  }
  const eventsFor = async (reservationId: string, type: string) =>
    ((await (getPaymentProvider() as any).listEvents()) as any[]).filter((e) => e.type === type && e.data.metadata?.reservationId === reservationId);

  it("rejects unsigned and forged deliveries with 400 and records nothing", async () => {
    const body = JSON.stringify({ id: `evt_qa_${randomUUID()}`, type: "charge.succeeded", createdAt: new Date().toISOString(), data: {} });
    expect((await post(body, null)).status).toBe(400);
    expect((await post(body, signPayload(body, "not-the-secret"))).status).toBe(400);
    const [{ n }] = await q<{ n: string }>("SELECT count(*) AS n FROM payment_webhook_events WHERE event_id = $1", [JSON.parse(body).id]);
    expect(Number(n)).toBe(0);
  });

  it("charge.succeeded delivered 5x (3 in parallel) is processed once; reservation stays CONFIRMED with one payment", async () => {
    const id = await paidReservation();
    const [evt] = await eventsFor(id, "charge.succeeded");
    expect(evt, "fake provider recorded a charge.succeeded event for the reservation").toBeTruthy();
    const body = JSON.stringify(evt);
    const first = await (await post(body)).json();
    const parallel = await Promise.all([post(body), post(body), post(body)]);
    const last = await (await post(body)).json();
    expect(parallel.map((r) => r.status)).toEqual([200, 200, 200]);
    const dupFlags = [first, ...(await Promise.all(parallel.map((r) => r.json()))), last].map((j) => j.duplicate);
    expect(dupFlags.filter((d) => d === false).length).toBeLessThanOrEqual(1);
    const [{ n }] = await q<{ n: string }>("SELECT count(*) AS n FROM payment_webhook_events WHERE event_id = $1", [evt.id]);
    expect(Number(n)).toBe(1);
    const [{ p }] = await q<{ p: string }>("SELECT count(*) AS p FROM payments WHERE reservation_id = $1 AND status = 'SUCCEEDED'", [id]);
    expect(Number(p)).toBe(1);
    expect((await c.getReservationForUser!(user.id, id)).status).toBe("CONFIRMED");
  });

  it("a duplicated charge.refunded event does not refund twice", async () => {
    const id = await paidReservation();
    const cancel = await c.cancelReservation!(user.id, id);
    expect(cancel.ok, cancel.message).toBe(true);
    const before = await q<{ refunded_minor: number }>("SELECT refunded_minor FROM reservations WHERE id = $1", [id]);
    const refunds = await eventsFor(id, "charge.refunded");
    if (cancel.refundFils > 0) expect(refunds.length).toBeGreaterThan(0);
    for (const evt of refunds) {
      const body = JSON.stringify(evt);
      await Promise.all([post(body), post(body)]);
      await post(body);
    }
    const after = await q<{ refunded_minor: number }>("SELECT refunded_minor FROM reservations WHERE id = $1", [id]);
    expect(after[0].refunded_minor).toBe(before[0].refunded_minor);
    const [{ s }] = await q<{ s: string }>("SELECT coalesce(sum(refunded_minor),0) AS s FROM payments WHERE reservation_id = $1", [id]);
    expect(Number(s)).toBe(before[0].refunded_minor);
  });

  it("deposit.released redelivered keeps the deposit RELEASED (no error, no state flip)", async () => {
    const id = await paidReservation();
    await c.cancelReservation!(user.id, id);
    const released = await eventsFor(id, "deposit.released");
    expect(released.length).toBeGreaterThan(0);
    for (const evt of released) {
      const body = JSON.stringify(evt);
      expect((await post(body)).status).toBe(200);
      expect((await post(body)).status).toBe(200);
    }
    const [dep] = await q<{ status: string }>("SELECT status FROM deposits WHERE reservation_id = $1 ORDER BY created_at DESC LIMIT 1", [id]);
    expect(dep.status).toBe("RELEASED");
  });
});
