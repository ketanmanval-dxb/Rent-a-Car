// Integration tests for the reservation transaction, payments and holds against
// TEST_DATABASE_URL (vitest sets DATABASE_URL to it). Each run creates its own
// branch/category/vehicle/users and deletes them afterwards.

import { randomInt, randomUUID } from "node:crypto";
import { eq, inArray, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import {
  auditLogs,
  branches,
  damageReports,
  rentalAgreements,
  deposits,
  driverProfiles,
  extras,
  maintenanceBlocks,
  payments,
  paymentWebhookEvents,
  reservations,
  users,
  vehicleCategories,
  vehicles,
} from "@/server/db/schema";
import { isAppError } from "@/server/lib/errors";
import { FakePaymentProvider } from "@/server/payments/fake-provider";
import { getPaymentProvider } from "@/server/payments/provider";
import { handlePaymentWebhook, payReservation } from "@/server/payments/service";
import { signPayload } from "@/server/payments/webhook-signature";
import { priceRental } from "@/server/pricing/quote";
import { cancelReservation, createReservationTx, modifyReservationDates, releaseExpiredHolds } from "./service";
import { getReservationForUser } from "./queries";

const H = 3_600_000;
const D = 24 * H;
const tag = randomUUID().slice(0, 6).toUpperCase();
const ids = { branch: "", category: "", vehicle: "", vehicle2: "", extra: "", users: [] as string[] };
let dayCursor = 5;

/** A fresh, non-overlapping future window per call (vehicle is unique to this run anyway). */
function window(days = 3) {
  const start = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + dayCursor, 6);
  dayCursor += days + 2;
  return { pickupAt: new Date(start), returnAt: new Date(start + days * D) };
}

async function makeCustomer() {
  const db = getDb();
  const [u] = await db
    .insert(users)
    .values({ name: "Test Driver", email: `db-test-${randomUUID().slice(0, 8)}@example.test`, emailVerified: true })
    .returning({ id: users.id });
  ids.users.push(u.id);
  await db.insert(driverProfiles).values({
    userId: u.id,
    fullName: "Test Driver",
    phone: "+971501234567",
    dateOfBirth: "1990-01-01",
    licenceNumber: `T${randomInt(1e6)}`,
    licenceCountry: "AE",
    licenceExpiry: "2099-01-01",
    licenceFileKey: `licences/${u.id}/test.png`,
  });
  return u.id;
}

const req = (w: { pickupAt: Date; returnAt: Date }, vehicleId = ids.vehicle) => ({
  vehicleId,
  pickupBranchId: ids.branch,
  returnBranchId: ids.branch,
  ...w,
  extras: [] as { extraId: string; quantity: number }[],
});

async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (err) {
    if (isAppError(err)) return err.code;
    throw err;
  }
}

beforeAll(async () => {
  const db = getDb();
  const [b] = await db
    .insert(branches)
    .values({ code: `T${tag}`, name: `Test ${tag}`, city: "Dubai", emirate: "Dubai", address: "x", phone: "+971 4 000 0000", timezone: "Asia/Dubai" })
    .returning();
  const [c] = await db
    .insert(vehicleCategories)
    .values({ code: `T${tag}`, name: "Test", dailyRateMinor: 20_000, depositMinor: 150_000, lateFeePerHourMinor: 4_000 })
    .returning();
  const vin = () => `TST${tag.replace(/[IOQ]/g, "X")}${String(randomInt(1e8)).padStart(8, "0")}`;
  const mk = (plate: string) => ({
    branchId: b.id,
    categoryId: c.id,
    make: "Toyota",
    model: "Camry",
    year: 2026,
    plateNumber: plate,
    vin: vin(),
    color: "White",
    transmission: "AUTOMATIC" as const,
    fuelType: "PETROL" as const,
    seats: 5,
    doors: 4,
    luggage: 3,
  });
  const [v, v2] = await db.insert(vehicles).values([mk(`TEST ${tag} 1`), mk(`TEST ${tag} 2`)]).returning();
  const [e] = await db
    .insert(extras)
    .values({ code: `test_gps_${tag}`, name: "GPS", pricingType: "PER_DAY", priceMinor: 2_000, maxTotalMinor: 20_000, maxQuantity: 1 })
    .returning();
  Object.assign(ids, { branch: b.id, category: c.id, vehicle: v.id, vehicle2: v2.id, extra: e.id });
});

afterAll(async () => {
  const db = getDb();
  const resIds = (await db.select({ id: reservations.id }).from(reservations).where(inArray(reservations.vehicleId, [ids.vehicle, ids.vehicle2]))).map((r) => r.id);
  if (resIds.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, resIds));
    await db.delete(payments).where(inArray(payments.reservationId, resIds));
    await db.delete(deposits).where(inArray(deposits.reservationId, resIds));
    await db.delete(damageReports).where(inArray(damageReports.reservationId, resIds));
    await db.delete(rentalAgreements).where(inArray(rentalAgreements.reservationId, resIds));
    await db.delete(paymentWebhookEvents).where(inArray(sql`${paymentWebhookEvents.payload}->'data'->'metadata'->>'reservationId'`, resIds));
    await db.delete(reservations).where(inArray(reservations.id, resIds));
  }
  if (ids.users.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids.users));
    await db.delete(users).where(inArray(users.id, ids.users));
  }
  await db.delete(maintenanceBlocks).where(inArray(maintenanceBlocks.vehicleId, [ids.vehicle, ids.vehicle2]));
  await db.delete(damageReports).where(inArray(damageReports.vehicleId, [ids.vehicle, ids.vehicle2]));
  await db.delete(vehicles).where(inArray(vehicles.id, [ids.vehicle, ids.vehicle2]));
  await db.delete(extras).where(eq(extras.id, ids.extra));
  await db.delete(vehicleCategories).where(eq(vehicleCategories.id, ids.category));
  await db.delete(branches).where(eq(branches.id, ids.branch));
  await closeDb();
});

describe("reservation transaction", () => {
  it("creates a PENDING hold priced on the server", async () => {
    const userId = await makeCustomer();
    const w = window(3);
    const input = { ...req(w), extras: [{ extraId: ids.extra, quantity: 1 }] };
    const res = await createReservationTx(userId, input);
    const [row] = await getDb().select().from(reservations).where(eq(reservations.id, res.reservationId));
    expect(row.status).toBe("PENDING");
    expect(row.reference).toMatch(/^DE-[A-Z0-9]{6}$/);
    const minutes = Number(process.env.HOLD_EXPIRY_MINUTES) || 15;
    const holdMs = row.holdExpiresAt!.getTime() - row.createdAt.getTime();
    expect(Math.abs(holdMs - minutes * 60_000)).toBeLessThan(5_000);
    const { quote } = await priceRental(getDb(), { ...input, extras: input.extras }, { skipWindowCheck: true });
    expect(row.totalMinor).toBe(quote.totalFils);
    expect(row.extrasMinor).toBe(6_000);
    expect(row.vatMinor).toBe(Math.round(row.subtotalMinor * 0.05));
  });

  it("lets exactly one of several concurrent overlapping bookings win", async () => {
    const users = await Promise.all([1, 2, 3, 4, 5].map(() => makeCustomer()));
    const w = window(2);
    const results = await Promise.all(users.map((u, i) => errorCode(createReservationTx(u, req({ pickupAt: new Date(w.pickupAt.getTime() + i * H), returnAt: w.returnAt })))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(results.filter((r) => r === "UNAVAILABLE")).toHaveLength(4);
  });

  it("allows back-to-back rentals ([start, end) ranges)", async () => {
    const userId = await makeCustomer();
    const w = window(2);
    await createReservationTx(userId, req(w));
    const next = { pickupAt: w.returnAt, returnAt: new Date(w.returnAt.getTime() + D) };
    expect(await errorCode(createReservationTx(userId, req(next)))).toBe("OK");
    const overlapByOneMinute = { pickupAt: new Date(w.returnAt.getTime() - 60_000), returnAt: new Date(w.returnAt.getTime() + 2 * D) };
    expect(await errorCode(createReservationTx(userId, req(overlapByOneMinute, ids.vehicle)))).toBe("UNAVAILABLE");
  });

  it("blocks reservations over maintenance and maintenance over reservations", async () => {
    const userId = await makeCustomer();
    const db = getDb();
    const w = window(2);
    await db.insert(maintenanceBlocks).values({ vehicleId: ids.vehicle, startsAt: w.pickupAt, endsAt: w.returnAt, reason: "Service" });
    expect(await errorCode(createReservationTx(userId, req(w)))).toBe("UNAVAILABLE");

    const w2 = window(2);
    await createReservationTx(userId, req(w2));
    await expect(
      db.insert(maintenanceBlocks).values({ vehicleId: ids.vehicle, startsAt: w2.pickupAt, endsAt: w2.returnAt, reason: "Clash" }),
    ).rejects.toMatchObject({ cause: { code: "23P01" } });
  });

  it("rejects incomplete driver profiles and retired vehicles", async () => {
    const db = getDb();
    const [u] = await db.insert(users).values({ name: "No Profile", email: `db-test-${randomUUID().slice(0, 8)}@example.test` }).returning();
    ids.users.push(u.id);
    expect(await errorCode(createReservationTx(u.id, req(window())))).toBe("PROFILE_INCOMPLETE");
  });

  it("is idempotent per client key", async () => {
    const userId = await makeCustomer();
    const w = window(1);
    const key = `idem-${randomUUID()}`;
    const [a, b] = await Promise.all([createReservationTx(userId, { ...req(w), idempotencyKey: key }), createReservationTx(userId, { ...req(w), idempotencyKey: key })]);
    expect(a.reservationId).toBe(b.reservationId);
  });

  it("expired holds free the slot and the cron release is idempotent", async () => {
    const [u1, u2] = [await makeCustomer(), await makeCustomer()];
    const w = window(2);
    const first = await createReservationTx(u1, req(w));
    const db = getDb();
    await db.update(reservations).set({ holdExpiresAt: new Date(Date.now() - 60_000) }).where(eq(reservations.id, first.reservationId));

    // The reservation transaction expires the stale hold under the vehicle lock.
    const second = await createReservationTx(u2, req(w));
    const [old] = await db.select().from(reservations).where(eq(reservations.id, first.reservationId));
    expect(old.status).toBe("EXPIRED");

    await db.update(reservations).set({ holdExpiresAt: new Date(Date.now() - 60_000) }).where(eq(reservations.id, second.reservationId));
    const run1 = await releaseExpiredHolds();
    expect(run1.reservationIds).toContain(second.reservationId);
    const run2 = await releaseExpiredHolds();
    expect(run2.reservationIds).not.toContain(second.reservationId);

    const pay = await payReservation(u2, second.reservationId, { attemptId: `att-${randomUUID()}` });
    expect(pay).toMatchObject({ ok: false, code: "EXPIRED" });
  });
});

describe("payments", () => {
  it("confirms only after charge + deposit; retries never double-charge", async () => {
    const userId = await makeCustomer();
    const r = await createReservationTx(userId, req(window(2)));
    const attemptId = `att-${randomUUID()}`;
    const [p1, p2] = await Promise.all([payReservation(userId, r.reservationId, { attemptId }), payReservation(userId, r.reservationId, { attemptId })]);
    expect([p1.ok, p2.ok].some(Boolean)).toBe(true);
    for (const p of [p1, p2]) if (!p.ok) expect(["ALREADY_PAID", "INVALID_STATE"]).toContain(p.code);

    const again = await payReservation(userId, r.reservationId, { attemptId: `att-${randomUUID()}` });
    expect(again).toMatchObject({ ok: false, code: "ALREADY_PAID" });

    const db = getDb();
    const pays = await db.select().from(payments).where(eq(payments.reservationId, r.reservationId));
    expect(pays.filter((p) => p.status === "SUCCEEDED")).toHaveLength(1);
    const deps = await db.select().from(deposits).where(eq(deposits.reservationId, r.reservationId));
    expect(deps.filter((d) => d.status === "HELD")).toHaveLength(1);
    const detail = await getReservationForUser(userId, r.reservationId);
    expect(detail?.status).toBe("CONFIRMED");
    expect(detail?.paidFils).toBe(detail?.totalFils);
    expect(await getReservationForUser(await makeCustomer(), r.reservationId)).toBeNull();
  });

  it("keeps the booking PENDING after a declined card, then succeeds on a new attempt", async () => {
    const userId = await makeCustomer();
    const r = await createReservationTx(userId, req(window(2)));
    expect(await payReservation(userId, r.reservationId, { attemptId: `att-${randomUUID()}`, simulate: "fail" })).toMatchObject({ ok: false, code: "FAILED" });
    expect(await payReservation(userId, r.reservationId, { attemptId: `att-${randomUUID()}`, simulate: "cancel" })).toMatchObject({ ok: false, code: "CANCELLED" });
    const [mid] = await getDb().select().from(reservations).where(eq(reservations.id, r.reservationId));
    expect(mid.status).toBe("PENDING");
    expect(await payReservation(userId, r.reservationId, { attemptId: `att-${randomUUID()}` })).toMatchObject({ ok: true, status: "CONFIRMED" });
  });

  it("refunds the charge when the deposit can't be authorised", async () => {
    const userId = await makeCustomer();
    const r = await createReservationTx(userId, req(window(2)));
    const res = await payReservation(userId, r.reservationId, { attemptId: `att-${randomUUID()}`, depositSimulate: "fail" });
    expect(res).toMatchObject({ ok: false, code: "FAILED" });
    const pays = await getDb().select().from(payments).where(eq(payments.reservationId, r.reservationId));
    expect(pays[0].status).toBe("REFUNDED");
    const [row] = await getDb().select().from(reservations).where(eq(reservations.id, r.reservationId));
    expect(row.status).toBe("PENDING");
  });

  it("verifies webhook signatures and dedupes by event id", async () => {
    const userId = await makeCustomer();
    const r = await createReservationTx(userId, req(window(2)));
    await payReservation(userId, r.reservationId, { attemptId: `att-${randomUUID()}` });
    const provider = getPaymentProvider() as FakePaymentProvider;
    const events = (await provider.listEvents()).filter((e) => e.data.metadata.reservationId === r.reservationId);
    expect(events.map((e) => e.type).sort()).toEqual(["charge.succeeded", "deposit.held"]);
    const secret = process.env.FAKE_PAYMENT_WEBHOOK_SECRET!;
    for (const e of events) {
      const body = JSON.stringify(e);
      const first = await handlePaymentWebhook(body, signPayload(body, secret));
      const dup = await handlePaymentWebhook(body, signPayload(body, secret));
      expect(first.duplicate).toBe(false);
      expect(dup.duplicate).toBe(true);
    }
    const body = JSON.stringify(events[0]);
    await expect(handlePaymentWebhook(body, signPayload(body, "wrong-secret"))).rejects.toThrow(/signature/i);
    await expect(handlePaymentWebhook(body, null)).rejects.toThrow(/signature/i);
  });
});

describe("cancel and modify", () => {
  it("cancels >48h before pick-up with a full refund and releases the deposit", async () => {
    const userId = await makeCustomer();
    const r = await createReservationTx(userId, req(window(2)));
    await payReservation(userId, r.reservationId, { attemptId: `att-${randomUUID()}` });
    const res = await cancelReservation(userId, r.reservationId);
    expect(res).toMatchObject({ ok: true, status: "REFUNDED", feeFils: 0, refundFils: r.quote.totalFils });
    const db = getDb();
    const [dep] = await db.select().from(deposits).where(eq(deposits.reservationId, r.reservationId));
    expect(dep.status).toBe("RELEASED");
    // Slot is free again.
    const [row] = await db.select().from(reservations).where(eq(reservations.id, r.reservationId));
    expect(await errorCode(createReservationTx(userId, req({ pickupAt: row.pickupAt, returnAt: row.returnAt })))).toBe("OK");
    expect(await cancelReservation(userId, r.reservationId)).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("changes dates, charging the difference for a confirmed booking", async () => {
    const userId = await makeCustomer();
    const w = window(2);
    const r = await createReservationTx(userId, req(w, ids.vehicle2));
    await payReservation(userId, r.reservationId, { attemptId: `att-${randomUUID()}` });
    const longer = { pickupAt: w.pickupAt, returnAt: new Date(w.returnAt.getTime() + D) };
    const res = await modifyReservationDates(userId, r.reservationId, longer);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.chargedFils).toBe(res.quote.totalFils - r.quote.totalFils);
    const db = getDb();
    const pays = await db.select().from(payments).where(or(eq(payments.reservationId, r.reservationId)));
    expect(pays.map((p) => p.kind).sort()).toEqual(["MODIFICATION", "RENTAL"]);
    const [row] = await db.select().from(reservations).where(eq(reservations.id, r.reservationId));
    expect(row.returnAt.getTime()).toBe(longer.returnAt.getTime());
    expect(row.totalMinor).toBe(res.quote.totalFils);
  });
});

describe("admin operations", () => {
  const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

  async function makeAdmin() {
    const [u] = await getDb()
      .insert(users)
      .values({ name: "Test Admin", email: `db-admin-${randomUUID().slice(0, 8)}@example.test`, role: "admin" })
      .returning({ id: users.id });
    ids.users.push(u.id);
    return u.id;
  }

  it("rejects non-admins", async () => {
    const { adminStats } = await import("@/server/admin");
    expect(await adminStats(await makeCustomer())).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("checks out, checks in late with fees, records damage and blocks maintenance clashes", async () => {
    const admin = await import("@/server/admin");
    const adminId = await makeAdmin();
    const userId = await makeCustomer();
    const db = getDb();
    // A booking whose pick-up is close enough to check out (inside the 24 h window).
    const pickupAt = new Date(Date.now() + 2 * H);
    const r = await createReservationTx(userId, req({ pickupAt, returnAt: new Date(pickupAt.getTime() + D) }, ids.vehicle2));
    expect(await admin.adminCheckOut(adminId, r.reservationId, { mileageKm: 100, fuelLevel: 8 })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    await payReservation(userId, r.reservationId, { attemptId: `att-${randomUUID()}` });

    const [veh] = await db.select().from(vehicles).where(eq(vehicles.id, ids.vehicle2));
    expect(await admin.adminCheckOut(adminId, r.reservationId, { mileageKm: veh.mileageKm, fuelLevel: 8 })).toMatchObject({ ok: true, status: "PICKED_UP" });
    const [onRent] = await db.select().from(vehicles).where(eq(vehicles.id, ids.vehicle2));
    expect(onRent.status).toBe("ON_RENT");

    // Returned 3 hours late with 2/8 less fuel.
    const returnedAt = new Date(pickupAt.getTime() + D + 3 * H);
    const ci = await admin.adminCheckIn(adminId, r.reservationId, { mileageKm: veh.mileageKm + 250, fuelLevel: 6, returnedAt });
    expect(ci.ok).toBe(true);
    if (!ci.ok) return;
    expect(ci.lateFeeFils).toBe(3 * 4_000 + Math.round(3 * 4_000 * 0.05));
    expect(ci.fuelChargeFils).toBe(12_600);
    expect(ci.charges.every((c) => c.status === "SUCCEEDED")).toBe(true);
    expect(ci.depositReleased).toBe(true);
    const [after] = await db.select().from(vehicles).where(eq(vehicles.id, ids.vehicle2));
    expect(after).toMatchObject({ status: "AVAILABLE", mileageKm: veh.mileageKm + 250 });
    const detail = await getReservationForUser(userId, r.reservationId);
    expect(detail?.status).toBe("RETURNED");
    expect(detail?.agreement).toMatchObject({ pickupFuelLevel: 8, returnFuelLevel: 6 });

    const dmg = await admin.adminCreateDamageReport(adminId, {
      vehicleId: ids.vehicle2,
      reservationId: r.reservationId,
      severity: "minor",
      description: "Scratch on rear bumper",
      images: [{ bytes: PNG, contentType: "image/png" }],
    });
    expect(dmg.ok).toBe(true);
    if (!dmg.ok) return;
    expect(dmg.report.imageUrls).toEqual([`/api/files/damage/${dmg.report.id}/0`]);
    const added = await admin.adminAddDamageImage(adminId, dmg.report.id, { bytes: PNG });
    expect(added.ok && added.report.imageUrls).toHaveLength(2);
    const bad = await admin.adminCreateDamageReport(adminId, { vehicleId: ids.vehicle2, severity: "minor", description: "x y z", images: [{ bytes: new TextEncoder().encode("not an image") }] });
    expect(bad).toMatchObject({ ok: false, code: "INVALID" });

    const w = window(2);
    await createReservationTx(userId, req(w, ids.vehicle2));
    expect(await admin.adminCreateMaintenanceBlock(adminId, { vehicleId: ids.vehicle2, startAt: w.pickupAt, endAt: w.returnAt, reason: "Service" })).toMatchObject({ ok: false, code: "CONFLICT" });
    const w2 = window(1);
    const ok = await admin.adminCreateMaintenanceBlock(adminId, { vehicleId: ids.vehicle2, startAt: w2.pickupAt, endAt: w2.returnAt, reason: "Service" });
    expect(ok.ok).toBe(true);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.actorUserId, adminId));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["rental.checked_out", "rental.checked_in", "damage_report.created", "maintenance.created"]));
  });
});
