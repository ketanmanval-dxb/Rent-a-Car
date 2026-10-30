import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbOrTx } from "@/server/db";
import { auditLogs, deposits, payments, paymentWebhookEvents, reservations } from "@/server/db/schema";
import { AppError, toResult, type Result } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { getPaymentProvider } from "./provider";
import type { Charge, ChargeStatus, DepositHold, DepositStatus, PaymentEvent, SimulatedOutcome } from "./types";

// Payment + deposit orchestration on top of PaymentProvider.
//
// Rules:
// - Every provider call carries an idempotency key derived from (reservation, attempt),
//   and the same key is stored UNIQUE on payments/deposits, so a retried request
//   (double click, network retry) never creates a second charge or hold.
// - Our payment/deposit rows only take statuses read back from the provider
//   (getCharge/getDeposit), either right after the call or when a signed webhook
//   arrives. Webhooks are verified and deduped by event id (payment_webhook_events).
// - A reservation is CONFIRMED only when the paid amount covers its total AND the
//   deposit is HELD (tryConfirmReservation, under a row lock).

const log = logger.child({ module: "payments" });

type PaymentRow = typeof payments.$inferSelect;
type DepositRow = typeof deposits.$inferSelect;
type PaymentStatus = PaymentRow["status"];
type DepositRowStatus = DepositRow["status"];

const CHARGE_STATUS: Record<ChargeStatus, PaymentStatus> = {
  succeeded: "SUCCEEDED",
  failed: "FAILED",
  cancelled: "CANCELLED",
  refunded: "REFUNDED",
  partially_refunded: "PARTIALLY_REFUNDED",
};

const DEPOSIT_STATUS: Record<DepositStatus, DepositRowStatus> = {
  held: "HELD",
  released: "RELEASED",
  captured: "CAPTURED",
  failed: "FAILED",
  expired: "EXPIRED",
};

/** Statuses where money was actually taken (net = amount - refunded). */
const COLLECTED: PaymentStatus[] = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"];

// ---------------------------------------------------------------------------
// Sync rows from provider truth
// ---------------------------------------------------------------------------

async function applyCharge(db: DbOrTx, paymentId: string, charge: Charge): Promise<PaymentRow> {
  const [row] = await db
    .update(payments)
    .set({
      providerPaymentId: charge.id,
      status: CHARGE_STATUS[charge.status],
      refundedMinor: charge.refundedMinor,
      failureReason: charge.failureReason ?? null,
    })
    .where(eq(payments.id, paymentId))
    .returning();
  return row;
}

async function applyDeposit(db: DbOrTx, depositId: string, hold: DepositHold): Promise<DepositRow> {
  const [row] = await db
    .update(deposits)
    .set({
      providerDepositId: hold.id,
      status: DEPOSIT_STATUS[hold.status],
      capturedMinor: hold.capturedMinor,
      failureReason: hold.failureReason ?? null,
    })
    .where(eq(deposits.id, depositId))
    .returning();
  return row;
}

/** Re-read a charge from the provider (verification) and store its status. */
export async function syncPayment(db: DbOrTx, payment: PaymentRow): Promise<PaymentRow> {
  if (!payment.providerPaymentId) return payment;
  const charge = await getPaymentProvider().getCharge(payment.providerPaymentId);
  return charge ? applyCharge(db, payment.id, charge) : payment;
}

export async function syncDeposit(db: DbOrTx, deposit: DepositRow): Promise<DepositRow> {
  if (!deposit.providerDepositId) return deposit;
  const hold = await getPaymentProvider().getDeposit(deposit.providerDepositId);
  return hold ? applyDeposit(db, deposit.id, hold) : deposit;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Net amount collected for the rental itself (RENTAL + MODIFICATION charges, minus refunds). */
export async function netRentalPaid(db: DbOrTx, reservationId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<string>`coalesce(sum(${payments.amountMinor} - ${payments.refundedMinor}), 0)` })
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, reservationId),
        inArray(payments.kind, ["RENTAL", "MODIFICATION"]),
        inArray(payments.status, COLLECTED),
      ),
    );
  return Number(r.n);
}

export async function latestPayment(db: DbOrTx, reservationId: string): Promise<PaymentRow | null> {
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), eq(payments.kind, "RENTAL")))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return row ?? null;
}

export async function activeDeposit(db: DbOrTx, reservationId: string): Promise<DepositRow | null> {
  const rows = await db.select().from(deposits).where(eq(deposits.reservationId, reservationId)).orderBy(desc(deposits.createdAt));
  return rows.find((d) => d.status === "HELD") ?? rows.find((d) => d.status === "CAPTURED") ?? rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

export type ConfirmOutcome = "CONFIRMED" | "ALREADY_CONFIRMED" | "NOT_READY" | "NOT_PENDING";

/**
 * Confirm a PENDING reservation iff the net rental payment covers the total and a
 * deposit hold covers the deposit. Serialised by a row lock on the reservation, so
 * concurrent webhook + synchronous paths can't double-confirm or race the cron.
 */
export async function tryConfirmReservation(reservationId: string, db: DbOrTx = getDb()): Promise<ConfirmOutcome> {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
    if (!r) throw new AppError("NOT_FOUND", "Reservation not found.");
    if (r.status === "CONFIRMED" || r.status === "PICKED_UP" || r.status === "RETURNED") return "ALREADY_CONFIRMED";
    if (r.status !== "PENDING") return "NOT_PENDING";

    const paid = await netRentalPaid(tx, r.id);
    const held = await tx
      .select({ amount: deposits.amountMinor })
      .from(deposits)
      .where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "HELD")));
    const depositOk = r.depositMinor === 0 || held.some((d) => d.amount >= r.depositMinor);
    if (paid < r.totalMinor || !depositOk) return "NOT_READY";

    await tx.update(reservations).set({ status: "CONFIRMED", confirmedAt: new Date() }).where(eq(reservations.id, r.id));
    await tx.insert(auditLogs).values({
      actorUserId: null,
      action: "reservation.confirmed",
      entityType: "reservation",
      entityId: r.id,
      data: { paidFils: paid, depositFils: r.depositMinor },
    });
    log.info("reservation confirmed", { reservationId: r.id, reference: r.reference });
    return "CONFIRMED";
  });
}

// ---------------------------------------------------------------------------
// Refunds, deposits, extra charges
// ---------------------------------------------------------------------------

/**
 * Refund up to `amountFils` of the reservation's collected rental charges through the
 * provider, newest charge first. Idempotent per (keyBase, payment). Returns refunded fils.
 */
export async function refundReservation(
  reservationId: string,
  amountFils: number,
  keyBase: string,
  actorUserId: string | null = null,
): Promise<number> {
  if (amountFils <= 0) return 0;
  const db = getDb();
  const provider = getPaymentProvider();
  const rows = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, reservationId),
        inArray(payments.kind, ["RENTAL", "MODIFICATION"]),
        inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED"]),
      ),
    )
    .orderBy(desc(payments.createdAt));

  let remaining = amountFils;
  for (const p of rows) {
    if (remaining <= 0) break;
    const refundable = p.amountMinor - p.refundedMinor;
    if (refundable <= 0 || !p.providerPaymentId) continue;
    const amount = Math.min(refundable, remaining);
    const charge = await provider.refundCharge(p.providerPaymentId, { idempotencyKey: `${keyBase}:${p.id}`, amountMinor: amount });
    await applyCharge(db, p.id, charge);
    remaining -= amount;
  }
  const refunded = amountFils - remaining;
  if (refunded > 0) {
    await db
      .update(reservations)
      .set({ refundedMinor: sql`${reservations.refundedMinor} + ${refunded}` })
      .where(eq(reservations.id, reservationId));
    await db.insert(auditLogs).values({
      actorUserId,
      action: "payment.refunded",
      entityType: "reservation",
      entityId: reservationId,
      data: { refundedFils: refunded, requestedFils: amountFils },
    });
    log.info("refund issued", { reservationId, refundedFils: refunded });
  }
  return refunded;
}

/** Release any HELD deposit for the reservation (no-op if none). */
export async function releaseDeposit(reservationId: string, actorUserId: string | null = null): Promise<boolean> {
  const db = getDb();
  const held = await db.select().from(deposits).where(and(eq(deposits.reservationId, reservationId), eq(deposits.status, "HELD")));
  for (const d of held) {
    if (!d.providerDepositId) continue;
    const hold = await getPaymentProvider().releaseDeposit(d.providerDepositId);
    await applyDeposit(db, d.id, hold);
    await db.insert(auditLogs).values({ actorUserId, action: "deposit.released", entityType: "reservation", entityId: reservationId, data: { depositId: d.id, amountFils: d.amountMinor } });
  }
  return held.length > 0;
}

/** Capture part of the HELD deposit (damage etc.); the provider releases the rest. Returns captured fils. */
export async function captureDeposit(reservationId: string, amountFils: number, actorUserId: string | null): Promise<number> {
  const db = getDb();
  const [d] = await db.select().from(deposits).where(and(eq(deposits.reservationId, reservationId), eq(deposits.status, "HELD")));
  if (!d?.providerDepositId) throw new AppError("INVALID_STATE", "There is no held deposit to capture.");
  const amount = Math.min(amountFils, d.amountMinor);
  const hold = await getPaymentProvider().captureDeposit(d.providerDepositId, amount);
  await applyDeposit(db, d.id, hold);
  await db.insert(auditLogs).values({ actorUserId, action: "deposit.captured", entityType: "reservation", entityId: reservationId, data: { depositId: d.id, capturedFils: amount } });
  return amount;
}

/** Charge an additional amount (late return, fuel, modification) to the customer. Idempotent per key. */
export async function chargeAdditional(args: {
  reservationId: string;
  kind: "MODIFICATION" | "LATE_RETURN" | "FUEL" | "DAMAGE";
  amountFils: number;
  idempotencyKey: string;
  actorUserId: string | null;
  simulate?: SimulatedOutcome;
}): Promise<PaymentRow> {
  const db = getDb();
  const provider = getPaymentProvider();
  await db
    .insert(payments)
    .values({ reservationId: args.reservationId, kind: args.kind, provider: provider.name, idempotencyKey: args.idempotencyKey, amountMinor: args.amountFils })
    .onConflictDoNothing({ target: payments.idempotencyKey });
  const [row] = await db.select().from(payments).where(eq(payments.idempotencyKey, args.idempotencyKey));
  if (row.reservationId !== args.reservationId) throw new AppError("CONFLICT", "Idempotency key reused for another reservation.");
  if (row.status !== "PENDING") return row;
  const charge = await provider.createCharge({
    amountMinor: args.amountFils,
    currency: "AED",
    idempotencyKey: args.idempotencyKey,
    metadata: { reservationId: args.reservationId, paymentId: row.id, kind: args.kind },
    simulate: args.simulate,
  });
  const verified = (await provider.getCharge(charge.id)) ?? charge;
  const updated = await applyCharge(db, row.id, verified);
  await db.insert(auditLogs).values({
    actorUserId: args.actorUserId,
    action: `payment.${args.kind.toLowerCase()}_${updated.status === "SUCCEEDED" ? "charged" : "failed"}`,
    entityType: "reservation",
    entityId: args.reservationId,
    data: { paymentId: row.id, amountFils: args.amountFils, status: updated.status },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Customer checkout
// ---------------------------------------------------------------------------

export const payReservationSchema = z.object({
  /** Test-mode outcome for the charge (fake provider only). */
  simulate: z.enum(["succeed", "fail", "cancel"]).optional(),
  /** Test-mode outcome for the deposit hold (fake provider only). */
  depositSimulate: z.enum(["succeed", "fail", "cancel"]).optional(),
  /** One id per checkout attempt (generate once per page render / button press). Retries reuse it. */
  attemptId: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
});

export type PayReservationInput = z.input<typeof payReservationSchema>;

/**
 * Charge the rental total and authorise the deposit, then confirm.
 * Same attemptId = same provider calls (idempotent); a new attemptId after a
 * failure is a new attempt. Never charges twice for the same reservation.
 */
export async function payReservation(
  userId: string,
  reservationId: string,
  input: PayReservationInput,
): Promise<Result<{ reservationId: string; status: "CONFIRMED" }>> {
  return toResult(async () => {
    const { simulate, depositSimulate, attemptId } = payReservationSchema.parse(input);
    const db = getDb();
    const provider = getPaymentProvider();

    const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId));
    if (!r || r.userId !== userId) throw new AppError("NOT_FOUND", "Reservation not found.");
    if (r.status === "CONFIRMED" || r.status === "PICKED_UP" || r.status === "RETURNED") {
      throw new AppError("ALREADY_PAID", "This booking is already paid and confirmed.");
    }
    if (r.status === "EXPIRED") throw new AppError("EXPIRED", "Your hold on this car expired. Please search again.");
    if (r.status !== "PENDING") throw new AppError("INVALID_STATE", "This booking can no longer be paid.");

    const base = `pay:${r.id}:${attemptId}`;
    const plog = log.child({ reservationId: r.id, attemptId });

    // An earlier attempt's unrefunded charge counts (e.g. crash between charge and deposit),
    // so a new attempt never charges the rental twice.
    const alreadyPaid = await netRentalPaid(db, r.id);
    if (alreadyPaid < r.totalMinor) {
      if (r.holdExpiresAt && r.holdExpiresAt.getTime() <= Date.now()) {
        await db
          .update(reservations)
          .set({ status: "EXPIRED" })
          .where(and(eq(reservations.id, r.id), eq(reservations.status, "PENDING")));
        throw new AppError("EXPIRED", "Your hold on this car expired. Please search again.");
      }

      await db
        .insert(payments)
        .values({ reservationId: r.id, kind: "RENTAL", provider: provider.name, idempotencyKey: `${base}:charge`, amountMinor: r.totalMinor - alreadyPaid })
        .onConflictDoNothing({ target: payments.idempotencyKey });
      let [payment] = await db.select().from(payments).where(eq(payments.idempotencyKey, `${base}:charge`));
      if (payment.reservationId !== r.id) throw new AppError("CONFLICT", "Invalid payment attempt.");

      if (payment.status === "PENDING") {
        const charge = await provider.createCharge({
          amountMinor: payment.amountMinor,
          currency: "AED",
          idempotencyKey: payment.idempotencyKey,
          metadata: { reservationId: r.id, paymentId: payment.id, kind: "RENTAL", reference: r.reference },
          simulate,
        });
        const verified = (await provider.getCharge(charge.id)) ?? charge;
        payment = await applyCharge(db, payment.id, verified);
        plog.info("charge result", { paymentId: payment.id, status: payment.status });
      }
      if (payment.status === "FAILED") {
        throw new AppError("FAILED", "Your card was declined. Please try again or use another card.");
      }
      if (payment.status === "CANCELLED") throw new AppError("CANCELLED", "Payment was cancelled. You can try again.");
      if (payment.status !== "SUCCEEDED") throw new AppError("INVALID_STATE", "This payment attempt was already refunded. Please try again.");
    }

    // Deposit authorisation.
    if (r.depositMinor > 0) {
      const existingHeld = await db.select().from(deposits).where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "HELD")));
      if (!existingHeld.length) {
        await db
          .insert(deposits)
          .values({ reservationId: r.id, provider: provider.name, idempotencyKey: `${base}:deposit`, amountMinor: r.depositMinor })
          .onConflictDoNothing({ target: deposits.idempotencyKey });
        let [dep] = await db.select().from(deposits).where(eq(deposits.idempotencyKey, `${base}:deposit`));
        if (dep.status === "PENDING") {
          const hold = await provider.holdDeposit({
            amountMinor: dep.amountMinor,
            currency: "AED",
            idempotencyKey: dep.idempotencyKey,
            metadata: { reservationId: r.id, depositId: dep.id, reference: r.reference },
            simulate: depositSimulate,
          });
          const verified = (await provider.getDeposit(hold.id)) ?? hold;
          dep = await applyDeposit(db, dep.id, verified);
          plog.info("deposit result", { depositId: dep.id, status: dep.status });
        }
        if (dep.status !== "HELD") {
          // Don't keep the customer's money for a booking we can't confirm.
          await refundReservation(r.id, await netRentalPaid(db, r.id), `${base}:deposit-failed`);
          throw new AppError("FAILED", "We couldn't authorise the security deposit, so your payment was refunded. Please try again with another card.");
        }
      }
    }

    const outcome = await tryConfirmReservation(r.id);
    if (outcome === "CONFIRMED" || outcome === "ALREADY_CONFIRMED") return { reservationId: r.id, status: "CONFIRMED" as const };
    if (outcome === "NOT_PENDING") {
      // Expired or cancelled while paying: give everything back.
      await refundReservation(r.id, await netRentalPaid(db, r.id), `${base}:not-pending`);
      await releaseDeposit(r.id);
      throw new AppError("EXPIRED", "Your hold expired before payment completed. Any payment has been refunded.");
    }
    throw new AppError("INVALID_STATE", "Payment is still processing. Please refresh in a moment.");
  }, { op: "payReservation", reservationId });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface WebhookOutcome {
  duplicate: boolean;
  eventId: string;
  type: string;
  reservationId: string | null;
  confirm: ConfirmOutcome | null;
}

/**
 * Verify, dedupe and apply a provider webhook. The event row and the status sync
 * commit together, so a failure rolls back the dedupe marker and a redelivery retries.
 * Throws on bad signatures (caller returns 400).
 */
export async function handlePaymentWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookOutcome> {
  const provider = getPaymentProvider();
  const event: PaymentEvent = provider.verifyWebhook(rawBody, signatureHeader);
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(paymentWebhookEvents)
      .values({ provider: provider.name, eventId: event.id, type: event.type, payload: event })
      .onConflictDoNothing({ target: paymentWebhookEvents.eventId })
      .returning({ id: paymentWebhookEvents.id });
    if (!inserted.length) return { duplicate: true, reservationId: null as string | null };

    const data = event.data;
    if (event.type.startsWith("charge.")) {
      const [p] = await tx
        .select()
        .from(payments)
        .where(or(eq(payments.providerPaymentId, data.id), eq(payments.idempotencyKey, data.idempotencyKey)))
        .for("update");
      if (!p) {
        log.warn("webhook for unknown charge", { eventId: event.id, chargeId: data.id });
        return { duplicate: false, reservationId: null };
      }
      // Re-read the provider's current state (handles out-of-order events).
      const charge = (await provider.getCharge(data.id)) ?? (data as Charge);
      await applyCharge(tx, p.id, charge);
      return { duplicate: false, reservationId: p.reservationId };
    }
    const [d] = await tx
      .select()
      .from(deposits)
      .where(or(eq(deposits.providerDepositId, data.id), eq(deposits.idempotencyKey, data.idempotencyKey)))
      .for("update");
    if (!d) {
      log.warn("webhook for unknown deposit", { eventId: event.id, depositId: data.id });
      return { duplicate: false, reservationId: null };
    }
    const hold = (await provider.getDeposit(data.id)) ?? (data as DepositHold);
    await applyDeposit(tx, d.id, hold);
    return { duplicate: false, reservationId: d.reservationId };
  });

  let confirm: ConfirmOutcome | null = null;
  if (!result.duplicate && result.reservationId && (event.type === "charge.succeeded" || event.type === "deposit.held")) {
    confirm = await tryConfirmReservation(result.reservationId);
  }
  log.info("webhook processed", { eventId: event.id, type: event.type, duplicate: result.duplicate, reservationId: result.reservationId, confirm });
  return { duplicate: result.duplicate, eventId: event.id, type: event.type, reservationId: result.reservationId, confirm };
}
