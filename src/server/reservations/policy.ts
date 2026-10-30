import { AppError } from "@/server/lib/errors";
import { vatOn } from "@/server/pricing/engine";

// Booking-window, modification and cancellation rules. Pure functions so they
// can be unit tested and shown to customers verbatim.

const HOUR = 3_600_000;

/** Pick-up must be at least this far in the future. */
export const MIN_LEAD_MINUTES = 60;
/** Shortest bookable rental. */
export const MIN_RENTAL_MINUTES = 60;
/** Longest bookable rental. */
export const MAX_RENTAL_DAYS = 30;
/** How far ahead customers can book (BOOKING_MAX_ADVANCE_DAYS overrides, e.g. for tests using far-future windows). */
export const DEFAULT_MAX_ADVANCE_DAYS = 365;
export function maxAdvanceDays(): number {
  const n = Number(process.env.BOOKING_MAX_ADVANCE_DAYS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_ADVANCE_DAYS;
}
/** Free cancellation up to this many hours before pick-up. */
export const FREE_CANCELLATION_HOURS = 48;
/** Date changes allowed up to this many hours before the original pick-up. */
export const MODIFY_CUTOFF_HOURS = 24;

export const CANCELLATION_POLICY_TEXT =
  `Free cancellation up to ${FREE_CANCELLATION_HOURS} hours before pick-up: the full amount is refunded and the deposit hold is released. ` +
  `Cancelling less than ${FREE_CANCELLATION_HOURS} hours before pick-up costs one day's rental (plus 5% VAT), deducted from the refund. ` +
  `Unpaid (pending) bookings can be cancelled free at any time. Bookings cannot be cancelled online after the pick-up time. ` +
  `Dates can be changed up to ${MODIFY_CUTOFF_HOURS} hours before pick-up, subject to availability; any price difference is charged or refunded.`;

export const LATE_RETURN_POLICY_TEXT =
  "Returns up to 59 minutes late are free. After that, each started hour is charged at the category's hourly late fee, capped at one day's rate per 24 hours, plus 5% VAT.";

/** Validates a requested rental window; throws AppError("INVALID"). */
export function assertRentalWindow(pickupAt: Date, returnAt: Date, now = new Date()): void {
  if (Number.isNaN(pickupAt.getTime()) || Number.isNaN(returnAt.getTime())) {
    throw new AppError("INVALID", "Choose valid pick-up and return times.");
  }
  if (pickupAt.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) {
    throw new AppError("INVALID", `Pick-up must be at least ${MIN_LEAD_MINUTES} minutes from now.`, {
      fieldErrors: { pickupAt: "Too soon" },
    });
  }
  if (pickupAt.getTime() > now.getTime() + maxAdvanceDays() * 24 * HOUR) {
    throw new AppError("INVALID", `Bookings can be made up to ${maxAdvanceDays()} days ahead.`, {
      fieldErrors: { pickupAt: "Too far ahead" },
    });
  }
  const minutes = (returnAt.getTime() - pickupAt.getTime()) / 60_000;
  if (minutes < MIN_RENTAL_MINUTES) {
    throw new AppError("INVALID", "Return must be at least 1 hour after pick-up.", { fieldErrors: { returnAt: "Too early" } });
  }
  if (minutes > MAX_RENTAL_DAYS * 24 * 60) {
    throw new AppError("INVALID", `Rentals can be at most ${MAX_RENTAL_DAYS} days.`, { fieldErrors: { returnAt: "Too long" } });
  }
}

export type CancellableStatus = "PENDING" | "CONFIRMED";

export interface CancellationTerms {
  eligible: boolean;
  /** Why not eligible / which rule applies. */
  reason: string;
  feeFils: number;
  refundFils: number;
  free: boolean;
}

/**
 * @param paidFils net amount the customer has paid for the rental (charges - refunds)
 * @param dailyRateFils average daily rate of the booking (fee basis)
 */
export function cancellationTerms(args: {
  status: string;
  pickupAt: Date;
  paidFils: number;
  dailyRateFils: number;
  now?: Date;
}): CancellationTerms {
  const now = args.now ?? new Date();
  if (args.status === "PENDING") {
    return { eligible: true, reason: "Unpaid booking: free cancellation.", feeFils: 0, refundFils: 0, free: true };
  }
  if (args.status !== "CONFIRMED") {
    return { eligible: false, reason: `A ${args.status.toLowerCase().replace("_", " ")} booking cannot be cancelled.`, feeFils: 0, refundFils: 0, free: false };
  }
  const hoursBefore = (args.pickupAt.getTime() - now.getTime()) / HOUR;
  if (hoursBefore <= 0) {
    return { eligible: false, reason: "The pick-up time has passed; please contact the branch.", feeFils: 0, refundFils: 0, free: false };
  }
  if (hoursBefore >= FREE_CANCELLATION_HOURS) {
    return {
      eligible: true,
      reason: `More than ${FREE_CANCELLATION_HOURS} hours before pick-up: full refund.`,
      feeFils: 0,
      refundFils: args.paidFils,
      free: true,
    };
  }
  const feeFils = Math.min(args.paidFils, args.dailyRateFils + vatOn(args.dailyRateFils));
  return {
    eligible: true,
    reason: `Less than ${FREE_CANCELLATION_HOURS} hours before pick-up: one day's rental plus VAT is kept.`,
    feeFils,
    refundFils: args.paidFils - feeFils,
    free: false,
  };
}

export function canModifyDates(status: string, pickupAt: Date, now = new Date()): { allowed: boolean; reason: string } {
  if (status !== "PENDING" && status !== "CONFIRMED") {
    return { allowed: false, reason: "Only pending or confirmed bookings can be changed." };
  }
  if (pickupAt.getTime() - now.getTime() < MODIFY_CUTOFF_HOURS * HOUR) {
    return { allowed: false, reason: `Dates can be changed up to ${MODIFY_CUTOFF_HOURS} hours before pick-up.` };
  }
  return { allowed: true, reason: "" };
}
