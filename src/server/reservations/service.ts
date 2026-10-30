import { randomInt } from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbOrTx, type Tx } from "@/server/db";
import {
  auditLogs,
  reservationExtras,
  reservations,
  vehicleOccupancy,
  vehicles,
} from "@/server/db/schema";
import {
  AppError,
  pgConstraint,
  pgErrorCode,
  PG_EXCLUSION_VIOLATION,
  PG_UNIQUE_VIOLATION,
  toResult,
  type Result,
} from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import {
  chargeAdditional,
  netRentalPaid,
  refundReservation,
  releaseDeposit,
} from "@/server/payments/service";
import type { Quote } from "@/server/pricing/engine";
import { priceRental, rentalRequestSchema, type ParsedRentalRequest, type RentalRequest } from "@/server/pricing/quote";
import { getDriverProfile } from "@/server/profile";
import { assertRentalWindow, cancellationTerms, canModifyDates } from "./policy";

const log = logger.child({ module: "reservations" });

export const DEFAULT_HOLD_EXPIRY_MINUTES = 15;

export function holdExpiryMinutes(): number {
  const n = Number(process.env.HOLD_EXPIRY_MINUTES);
  return Number.isInteger(n) && n > 0 && n <= 24 * 60 ? n : DEFAULT_HOLD_EXPIRY_MINUTES;
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function generateReference(): string {
  let s = "DE-";
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return s;
}

const rangeSql = (start: Date, end: Date) =>
  sql`tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`;

/** Lock the vehicle row for the rest of the transaction (serialises bookings per vehicle). */
async function lockVehicle(tx: Tx, vehicleId: string) {
  const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)).for("update");
  if (!v) throw new AppError("NOT_FOUND", "Vehicle not found.");
  if (v.status === "RETIRED") throw new AppError("UNAVAILABLE", "This vehicle is no longer available.");
  return v;
}

/** Flip this vehicle's PENDING holds whose expiry has passed to EXPIRED (frees their occupancy). */
async function expireStaleHolds(tx: Tx, vehicleId: string): Promise<string[]> {
  const rows = await tx
    .update(reservations)
    .set({ status: "EXPIRED" })
    .where(and(eq(reservations.vehicleId, vehicleId), eq(reservations.status, "PENDING"), lte(reservations.holdExpiresAt, sql`now()`)))
    .returning({ id: reservations.id });
  if (rows.length) {
    await tx.insert(auditLogs).values(
      rows.map((r) => ({ action: "reservation.expired", entityType: "reservation", entityId: r.id, data: { by: "reservation_tx" } })),
    );
  }
  return rows.map((r) => r.id);
}

/** Anything (other than `excludeReservationId`) occupying the vehicle during [start, end)? */
async function hasOverlap(tx: Tx, vehicleId: string, start: Date, end: Date, excludeReservationId?: string): Promise<boolean> {
  const rows = await tx
    .select({ id: vehicleOccupancy.id })
    .from(vehicleOccupancy)
    .where(
      and(
        eq(vehicleOccupancy.vehicleId, vehicleId),
        sql`${vehicleOccupancy.period} && ${rangeSql(start, end)}`,
        excludeReservationId ? sql`${vehicleOccupancy.reservationId} IS DISTINCT FROM ${excludeReservationId}::uuid` : undefined,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

function isOverlapError(err: unknown): boolean {
  return pgErrorCode(err) === PG_EXCLUSION_VIOLATION;
}

function snapshot(q: Quote) {
  return {
    rentalDays: q.days,
    dailyRateMinor: q.dailyRateFils,
    rentalMinor: q.baseFils,
    discountMinor: q.discountFils,
    extrasMinor: q.extrasFils,
    oneWayFeeMinor: q.oneWayFeeFils,
    locationFeeMinor: q.locationFeeFils,
    subtotalMinor: q.subtotalFils,
    vatMinor: q.vatFils,
    totalMinor: q.totalFils,
    depositMinor: q.depositFils,
    pricingBreakdown: q,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const createReservationSchema = rentalRequestSchema.extend({
  /** Optional client key: retrying the same request returns the same reservation. */
  idempotencyKey: z.string().min(8).max(100).optional(),
});
export type CreateReservationInput = RentalRequest & { idempotencyKey?: string };

export interface CreatedReservation {
  reservationId: string;
  reference: string;
  holdExpiresAt: Date;
  quote: Quote;
}

/**
 * The reservation transaction:
 *  1 BEGIN; 2 SELECT vehicle FOR UPDATE; 3 expire stale holds + check no overlapping
 *  reservation/maintenance; 4-6 price on the server and insert a PENDING reservation
 *  with hold_expires_at = now() + HOLD_EXPIRY_MINUTES (the hold); 7 COMMIT.
 *  The vehicle_occupancy exclusion constraint backs this up at the database level.
 *  Confirmation happens later, only after verified payment + deposit (payments/service).
 */
export async function createReservationTx(
  userId: string,
  input: CreateReservationInput,
  opts: { now?: Date; db?: DbOrTx } = {},
): Promise<CreatedReservation> {
  const req = createReservationSchema.parse(input);
  const db = opts.db ?? getDb();
  assertRentalWindow(req.pickupAt, req.returnAt, opts.now);

  if (req.idempotencyKey) {
    const existing = await findByIdempotencyKey(db, userId, req.idempotencyKey);
    if (existing) return existing;
  }

  const profile = await getDriverProfile(userId, db);
  if (!profile?.complete) {
    throw new AppError("PROFILE_INCOMPLETE", "Complete your driver details and upload your licence before booking.", {
      missing: profile?.missing ?? ["profile"],
    });
  }

  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await lockVehicle(tx, req.vehicleId);
        // A concurrent request with the same key may have committed while we waited for the lock.
        if (req.idempotencyKey) {
          const existing = await findByIdempotencyKey(tx, userId, req.idempotencyKey);
          if (existing) return existing;
        }
        await expireStaleHolds(tx, req.vehicleId);
        if (await hasOverlap(tx, req.vehicleId, req.pickupAt, req.returnAt)) {
          throw new AppError("UNAVAILABLE", "Sorry, this car was just booked for those dates. Please pick another car or time.");
        }
        const { quote } = await priceRental(tx, req, { now: opts.now, skipWindowCheck: true });
        const minutes = holdExpiryMinutes();
        const [row] = await tx
          .insert(reservations)
          .values({
            reference: generateReference(),
            userId,
            vehicleId: req.vehicleId,
            pickupBranchId: req.pickupBranchId,
            returnBranchId: req.returnBranchId,
            driverProfileId: profile.id,
            pickupAt: req.pickupAt,
            returnAt: req.returnAt,
            status: "PENDING",
            holdExpiresAt: sql`now() + make_interval(mins => ${minutes})`,
            idempotencyKey: req.idempotencyKey ?? null,
            ...snapshot(quote),
          })
          .returning({ id: reservations.id, reference: reservations.reference, holdExpiresAt: reservations.holdExpiresAt });
        if (quote.extras.length) {
          await tx.insert(reservationExtras).values(
            quote.extras.map((e) => ({
              reservationId: row.id,
              extraId: e.extraId,
              quantity: e.quantity,
              pricingType: e.pricingType,
              unitPriceMinor: e.unitFils,
              totalMinor: e.totalFils,
            })),
          );
        }
        await tx.insert(auditLogs).values({
          actorUserId: userId,
          action: "reservation.created",
          entityType: "reservation",
          entityId: row.id,
          data: { reference: row.reference, vehicleId: req.vehicleId, totalFils: quote.totalFils, holdMinutes: minutes },
        });
        log.info("reservation held", { reservationId: row.id, reference: row.reference, vehicleId: req.vehicleId, userId });
        return { reservationId: row.id, reference: row.reference, holdExpiresAt: row.holdExpiresAt!, quote };
      });
    } catch (err) {
      if (isOverlapError(err)) {
        throw new AppError("UNAVAILABLE", "Sorry, this car was just booked for those dates. Please pick another car or time.");
      }
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        const c = pgConstraint(err) ?? "";
        if (c.includes("idempotency") && req.idempotencyKey) {
          const existing = await findByIdempotencyKey(db, userId, req.idempotencyKey);
          if (existing) return existing;
        }
        if (c.includes("reference") && attempt < 3) continue; // reference collision: retry
      }
      throw err;
    }
  }
}

async function findByIdempotencyKey(db: DbOrTx, userId: string, key: string): Promise<CreatedReservation | null> {
  const [r] = await db.select().from(reservations).where(eq(reservations.idempotencyKey, key));
  if (!r) return null;
  if (r.userId !== userId) throw new AppError("CONFLICT", "Invalid request key.");
  return { reservationId: r.id, reference: r.reference, holdExpiresAt: r.holdExpiresAt ?? r.createdAt, quote: r.pricingBreakdown as Quote };
}

/** Public: place a hold (PENDING reservation). */
export async function createReservation(userId: string, input: CreateReservationInput): Promise<Result<CreatedReservation>> {
  return toResult(() => createReservationTx(userId, input), { op: "createReservation", userId });
}

// ---------------------------------------------------------------------------
// Modify dates
// ---------------------------------------------------------------------------

const dateChangeSchema = z.object({ pickupAt: z.coerce.date(), returnAt: z.coerce.date() });
export type DateChangeInput = z.input<typeof dateChangeSchema>;

async function loadOwned(db: DbOrTx, userId: string | null, reservationId: string) {
  if (!z.string().uuid().safeParse(reservationId).success) throw new AppError("NOT_FOUND", "Booking not found.");
  const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId));
  if (!r || (userId !== null && r.userId !== userId)) throw new AppError("NOT_FOUND", "Booking not found.");
  return r;
}

async function requestFor(db: DbOrTx, r: typeof reservations.$inferSelect, change: { pickupAt: Date; returnAt: Date }): Promise<ParsedRentalRequest> {
  const ex = await db.select().from(reservationExtras).where(eq(reservationExtras.reservationId, r.id));
  return {
    vehicleId: r.vehicleId,
    pickupBranchId: r.pickupBranchId,
    returnBranchId: r.returnBranchId,
    pickupAt: change.pickupAt,
    returnAt: change.returnAt,
    extras: ex.map((e) => ({ extraId: e.extraId, quantity: e.quantity })),
  };
}

export interface DateChangePreview {
  quote: Quote;
  available: boolean;
  /** New total - current total (positive = customer pays more). */
  differenceFils: number;
  /** What will actually move now: charge (positive) or refund (negative). 0 for unpaid bookings. */
  dueNowFils: number;
}

async function preview(db: DbOrTx, userId: string | null, reservationId: string, input: DateChangeInput, now = new Date()): Promise<DateChangePreview> {
  const change = dateChangeSchema.parse(input);
  const r = await loadOwned(db, userId, reservationId);
  const m = canModifyDates(r.status, r.pickupAt, now);
  if (!m.allowed) throw new AppError("INVALID_STATE", m.reason);
  assertRentalWindow(change.pickupAt, change.returnAt, now);
  const { quote } = await priceRental(db, await requestFor(db, r, change), { skipWindowCheck: true });
  const { isVehicleAvailable } = await import("@/server/catalog");
  const available = await isVehicleAvailable(db, r.vehicleId, change.pickupAt, change.returnAt, { excludeReservationId: r.id });
  const differenceFils = quote.totalFils - r.totalMinor;
  const dueNowFils = r.status === "CONFIRMED" ? quote.totalFils - (await netRentalPaid(db, r.id)) : 0;
  return { quote, available, differenceFils, dueNowFils };
}

export async function previewDateChange(userId: string, reservationId: string, input: DateChangeInput): Promise<Result<DateChangePreview>> {
  return toResult(() => preview(getDb(), userId, reservationId, input), { op: "previewDateChange", reservationId });
}

/**
 * Change pick-up/return times. Re-checks availability under the vehicle lock and
 * re-prices on the server. For confirmed bookings, a higher price is charged
 * (idempotent per idempotencyKey) BEFORE the change commits, and a lower price is
 * refunded after it commits.
 */
export async function modifyReservationDatesTx(
  actorUserId: string,
  reservationId: string,
  input: DateChangeInput,
  opts: { asAdmin?: boolean; idempotencyKey?: string; now?: Date } = {},
): Promise<{ quote: Quote; chargedFils: number; refundedFils: number }> {
  const db = getDb();
  const owner = opts.asAdmin ? null : actorUserId;
  const p = await preview(db, owner, reservationId, input, opts.now);
  if (!p.available) throw new AppError("UNAVAILABLE", "The car isn't available for the new dates.");
  const change = dateChangeSchema.parse(input);
  const key = opts.idempotencyKey ?? `${reservationId}:${change.pickupAt.toISOString()}:${change.returnAt.toISOString()}`;

  let chargedFils = 0;
  let chargePaymentId: string | null = null;
  if (p.dueNowFils > 0) {
    const payment = await chargeAdditional({
      reservationId,
      kind: "MODIFICATION",
      amountFils: p.dueNowFils,
      idempotencyKey: `modify:${key}`,
      actorUserId,
    });
    if (payment.status !== "SUCCEEDED") throw new AppError("FAILED", "We couldn't charge the price difference. Your booking was not changed.");
    chargedFils = p.dueNowFils;
    chargePaymentId = payment.id;
  }

  let quote: Quote;
  try {
    quote = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
      if (!r || !canModifyDates(r.status, r.pickupAt, opts.now).allowed) throw new AppError("INVALID_STATE", "This booking can no longer be changed.");
      await lockVehicle(tx, r.vehicleId);
      await expireStaleHolds(tx, r.vehicleId);
      if (await hasOverlap(tx, r.vehicleId, change.pickupAt, change.returnAt, r.id)) {
        throw new AppError("UNAVAILABLE", "The car isn't available for the new dates.");
      }
      const { quote } = await priceRental(tx, await requestFor(tx, r, change), { skipWindowCheck: true });
      await tx
        .update(reservations)
        .set({ pickupAt: change.pickupAt, returnAt: change.returnAt, ...snapshot(quote) })
        .where(eq(reservations.id, r.id));
      for (const e of quote.extras) {
        await tx
          .update(reservationExtras)
          .set({ totalMinor: e.totalFils, unitPriceMinor: e.unitFils })
          .where(and(eq(reservationExtras.reservationId, r.id), eq(reservationExtras.extraId, e.extraId)));
      }
      await tx.insert(auditLogs).values({
        actorUserId,
        action: "reservation.dates_changed",
        entityType: "reservation",
        entityId: r.id,
        data: {
          from: { pickupAt: r.pickupAt, returnAt: r.returnAt, totalFils: r.totalMinor },
          to: { pickupAt: change.pickupAt, returnAt: change.returnAt, totalFils: quote.totalFils },
          asAdmin: !!opts.asAdmin,
        },
      });
      return quote;
    });
  } catch (err) {
    // Undo the extra charge if the change didn't go through.
    if (chargePaymentId) await refundReservation(reservationId, chargedFils, `modify-undo:${key}`, actorUserId).catch((e) => log.error("modify undo refund failed", { err: e, reservationId }));
    if (isOverlapError(err)) throw new AppError("UNAVAILABLE", "The car isn't available for the new dates.");
    throw err;
  }

  let refundedFils = 0;
  if (p.dueNowFils < 0) {
    refundedFils = await refundReservation(reservationId, -p.dueNowFils, `modify-refund:${key}`, actorUserId);
  }
  log.info("reservation dates changed", { reservationId, chargedFils, refundedFils });
  return { quote, chargedFils, refundedFils };
}

export async function modifyReservationDates(
  userId: string,
  reservationId: string,
  input: DateChangeInput & { idempotencyKey?: string },
): Promise<Result<{ quote: Quote; chargedFils: number; refundedFils: number }>> {
  return toResult(() => modifyReservationDatesTx(userId, reservationId, input, { idempotencyKey: input.idempotencyKey }), {
    op: "modifyReservationDates",
    reservationId,
  });
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelReservationTx(
  actorUserId: string,
  reservationId: string,
  opts: { asAdmin?: boolean; reason?: string; waiveFee?: boolean; now?: Date } = {},
): Promise<{ status: "CANCELLED" | "REFUNDED"; refundFils: number; feeFils: number }> {
  const db = getDb();
  const owner = opts.asAdmin ? null : actorUserId;
  await loadOwned(db, owner, reservationId);

  const decided = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
    const paid = await netRentalPaid(tx, r.id);
    const terms = cancellationTerms({ status: r.status, pickupAt: r.pickupAt, paidFils: paid, dailyRateFils: r.dailyRateMinor, now: opts.now });
    if (!terms.eligible && !(opts.asAdmin && r.status === "CONFIRMED")) throw new AppError("INVALID_STATE", terms.reason);
    // Unpaid holds: refund anything that slipped through. Admin may waive the fee.
    const feeFils = r.status === "PENDING" || opts.waiveFee ? 0 : terms.feeFils;
    const refundFils = paid - feeFils;
    await tx
      .update(reservations)
      .set({ status: "CANCELLED", cancelledAt: new Date(), cancellationFeeMinor: feeFils, cancellationReason: opts.reason ?? null })
      .where(eq(reservations.id, r.id));
    await tx.insert(auditLogs).values({
      actorUserId,
      action: "reservation.cancelled",
      entityType: "reservation",
      entityId: r.id,
      data: { previousStatus: r.status, paidFils: paid, feeFils, refundFils, asAdmin: !!opts.asAdmin, reason: opts.reason ?? null },
    });
    return { refundFils, feeFils };
  });

  // Money moves after the slot is released; provider calls are idempotent per key.
  let refunded = 0;
  try {
    refunded = await refundReservation(reservationId, decided.refundFils, `cancel:${reservationId}`, actorUserId);
    await releaseDeposit(reservationId, actorUserId);
  } catch (err) {
    log.error("cancellation refund failed", { err, reservationId });
    await db.insert(auditLogs).values({ actorUserId, action: "payment.refund_failed", entityType: "reservation", entityId: reservationId, data: { amountFils: decided.refundFils } });
    throw new AppError("INTERNAL", "Your booking was cancelled but the refund could not be processed yet. Our team will complete it.");
  }
  const status = refunded > 0 ? ("REFUNDED" as const) : ("CANCELLED" as const);
  if (status === "REFUNDED") {
    await db.update(reservations).set({ status: "REFUNDED" }).where(eq(reservations.id, reservationId));
  }
  log.info("reservation cancelled", { reservationId, refundFils: refunded, feeFils: decided.feeFils });
  return { status, refundFils: refunded, feeFils: decided.feeFils };
}

export async function cancelReservation(
  userId: string,
  reservationId: string,
  opts: { reason?: string } = {},
): Promise<Result<{ status: "CANCELLED" | "REFUNDED"; refundFils: number; feeFils: number }>> {
  return toResult(() => cancelReservationTx(userId, reservationId, { reason: opts.reason }), { op: "cancelReservation", reservationId });
}

// ---------------------------------------------------------------------------
// Expiry (cron)
// ---------------------------------------------------------------------------

/**
 * Expire every PENDING hold past its expiry. Idempotent: a second run finds nothing.
 * Also refunds any payment that completed on a hold that expired (rare race).
 */
export async function releaseExpiredHolds(opts: { db?: DbOrTx } = {}): Promise<{ expired: number; reservationIds: string[]; refunded: number }> {
  const db = opts.db ?? getDb();
  const rows = await db
    .update(reservations)
    .set({ status: "EXPIRED" })
    .where(and(eq(reservations.status, "PENDING"), lte(reservations.holdExpiresAt, sql`now()`)))
    .returning({ id: reservations.id, reference: reservations.reference });
  if (rows.length) {
    await db.insert(auditLogs).values(rows.map((r) => ({ action: "reservation.expired", entityType: "reservation", entityId: r.id, data: { by: "cron" } })));
  }
  let refunded = 0;
  for (const r of rows) {
    const paid = await netRentalPaid(db, r.id);
    if (paid > 0) {
      refunded += await refundReservation(r.id, paid, `expired:${r.id}`);
      await releaseDeposit(r.id);
    }
  }
  if (rows.length) log.info("expired holds released", { count: rows.length, refundedFils: refunded });
  return { expired: rows.length, reservationIds: rows.map((r) => r.id), refunded };
}
