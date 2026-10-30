import { z } from "zod";
import { DEFAULT_TIMEZONE, addDaysToDateString, zonedParts, zonedToUtc } from "./format";

// URL contract for search + booking:
//   /search?pickup=<branchId>&return=<branchId>&pd=YYYY-MM-DD&pt=HH:mm&rd=YYYY-MM-DD&rt=HH:mm
//           &category=<id>&transmission=automatic|manual&seats=<min>&fuel=petrol|...&maxPrice=<AED/day>&sort=price_asc|price_desc
// Dates/times are wall-clock in the PICK-UP branch's time zone (return in the return branch's zone).

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const pre = <T extends z.ZodType>(schema: T) => z.preprocess((v) => emptyToUndef(first(v)), schema);

export const tripSchema = z.object({
  pickup: pre(z.string().uuid("Choose a pick-up branch")),
  return: pre(z.string().uuid("Choose a return branch").optional()),
  pd: pre(dateStr),
  pt: pre(timeStr.default("10:00")),
  rd: pre(dateStr),
  rt: pre(timeStr.default("10:00")),
});

export const filterSchema = z.object({
  category: pre(z.string().uuid().optional()).catch(undefined),
  transmission: pre(z.enum(["automatic", "manual"]).optional()).catch(undefined),
  seats: pre(z.coerce.number().int().min(1).max(60).optional()).catch(undefined),
  fuel: pre(z.enum(["petrol", "diesel", "hybrid", "electric"]).optional()).catch(undefined),
  maxPrice: pre(z.coerce.number().int().min(1).max(100000).optional()).catch(undefined),
  sort: pre(z.enum(["price_asc", "price_desc"]).optional()).catch(undefined),
});

export type TripParams = {
  pickupBranchId: string;
  returnBranchId: string;
  pd: string;
  pt: string;
  rd: string;
  rt: string;
};

export type FilterParams = z.infer<typeof filterSchema>;

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Parse trip params; returns field errors instead of throwing. */
export function parseTrip(raw: RawSearchParams):
  | { ok: true; trip: TripParams }
  | { ok: false; errors: Record<string, string>; partial: Partial<TripParams> } {
  const result = tripSchema.safeParse(raw);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "form");
      errors[key] ??= issue.message;
    }
    return {
      ok: false,
      errors,
      partial: {
        pickupBranchId: typeof first(raw.pickup) === "string" ? (first(raw.pickup) as string) : undefined,
        returnBranchId: typeof first(raw.return) === "string" ? (first(raw.return) as string) : undefined,
        pd: first(raw.pd) as string | undefined,
        pt: first(raw.pt) as string | undefined,
        rd: first(raw.rd) as string | undefined,
        rt: first(raw.rt) as string | undefined,
      },
    };
  }
  const t = result.data;
  return {
    ok: true,
    trip: { pickupBranchId: t.pickup, returnBranchId: t.return ?? t.pickup, pd: t.pd, pt: t.pt, rd: t.rd, rt: t.rt },
  };
}

export function parseFilters(raw: RawSearchParams): FilterParams {
  return filterSchema.parse(raw);
}

/** Resolve trip wall-clock values to UTC instants using each branch's time zone, and validate ordering. */
export function resolveTripInstants(
  trip: TripParams,
  pickupTz: string,
  returnTz: string,
  now: Date,
): { ok: true; pickupAt: Date; returnAt: Date } | { ok: false; message: string } {
  const pickupAt = zonedToUtc(trip.pd, trip.pt, pickupTz);
  const returnAt = zonedToUtc(trip.rd, trip.rt, returnTz);
  if (!pickupAt || !returnAt) return { ok: false, message: "Please enter valid dates and times." };
  if (pickupAt.getTime() < now.getTime()) return { ok: false, message: "Pick-up time must be in the future." };
  if (returnAt.getTime() <= pickupAt.getTime()) return { ok: false, message: "Return must be after pick-up." };
  if (returnAt.getTime() - pickupAt.getTime() > 30 * 24 * 3600 * 1000)
    return { ok: false, message: "Rentals can be at most 30 days." };
  return { ok: true, pickupAt, returnAt };
}

export function tripToQuery(trip: TripParams): Record<string, string> {
  return {
    pickup: trip.pickupBranchId,
    return: trip.returnBranchId,
    pd: trip.pd,
    pt: trip.pt,
    rd: trip.rd,
    rt: trip.rt,
  };
}

export function toQueryString(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Default trip: tomorrow 10:00 -> +3 days 10:00 (Dubai wall clock). */
export function defaultTripDates(now: Date, timeZone: string = DEFAULT_TIMEZONE) {
  const today = zonedParts(now, timeZone).date;
  return { pd: addDaysToDateString(today, 1), pt: "10:00", rd: addDaysToDateString(today, 4), rt: "10:00", today };
}

/** Half-hour time slots for selects. */
export const TIME_SLOTS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  return `${h}:${i % 2 ? "30" : "00"}`;
});
