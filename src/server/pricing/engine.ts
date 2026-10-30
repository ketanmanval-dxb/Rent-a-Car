// Pure pricing engine: no I/O, integer fils only. Everything the customer pays
// is computed here on the server; client-side numbers are never trusted.

export const CURRENCY = "AED" as const;
/** UAE VAT 5 % in basis points. */
export const VAT_BPS = 500;
/** A rental "day" is 24 h; the first 59 minutes into a new day are free (grace). */
export const DAY_GRACE_MINUTES = 59;
/** Late returns within this many minutes are not charged. */
export const LATE_GRACE_MINUTES = 59;
/** Fallback one-way fee when no ONE_WAY_FEE rule matches the branch pair (AED 250). */
export const DEFAULT_ONE_WAY_FEE_MINOR = 25_000;
/** Refuelling charge per missing eighth of a tank at return (AED 60, before VAT). */
export const FUEL_CHARGE_PER_EIGHTH_MINOR = 6_000;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type PricingRuleKind = "SEASONAL" | "WEEKEND" | "DURATION_DISCOUNT" | "ONE_WAY_FEE";
export type ExtraPricingType = "PER_DAY" | "PER_RENTAL";

export interface PricingRuleData {
  id: string;
  name: string;
  kind: PricingRuleKind;
  categoryId: string | null;
  branchId: string | null;
  fromBranchId: string | null;
  toBranchId: string | null;
  /** YYYY-MM-DD, inclusive, branch-local. */
  validFrom: string | null;
  validTo: string | null;
  minDays: number | null;
  adjustmentBps: number | null;
  amountMinor: number | null;
  priority: number;
  isActive: boolean;
}

export interface ExtraSelection {
  extraId: string;
  code: string;
  name: string;
  pricingType: ExtraPricingType;
  priceMinor: number;
  maxTotalMinor: number | null;
  quantity: number;
}

export interface PricingInput {
  pickupAt: Date;
  returnAt: Date;
  /** IANA time zone of the pick-up branch (seasonal/weekend rules use local dates). */
  timezone: string;
  categoryId: string;
  pickupBranchId: string;
  returnBranchId: string;
  /** Vehicle override or category daily rate, fils. */
  baseDailyRateMinor: number;
  depositMinor: number;
  locationFeeMinor: number;
  rules: PricingRuleData[];
  extras: ExtraSelection[];
}

export interface DayRate {
  /** Local date (branch tz) the rental day starts on. */
  date: string;
  rateFils: number;
  adjustmentBps: number;
  rules: string[];
}

export interface QuoteExtraLine {
  extraId: string;
  code: string;
  name: string;
  pricingType: ExtraPricingType;
  quantity: number;
  unitFils: number;
  totalFils: number;
}

export interface Quote {
  currency: typeof CURRENCY;
  days: number;
  /** Base (unadjusted) daily rate of the vehicle. */
  baseDailyRateFils: number;
  /** Average charged daily rate = round(baseFils / days). */
  dailyRateFils: number;
  dayRates: DayRate[];
  /** Sum of day rates (before duration discount). */
  baseFils: number;
  discountFils: number;
  discountLabel: string | null;
  extras: QuoteExtraLine[];
  extrasFils: number;
  oneWayFeeFils: number;
  locationFeeFils: number;
  subtotalFils: number;
  vatBps: number;
  vatFils: number;
  totalFils: number;
  depositFils: number;
}

/** Percentage of an integer amount in basis points, rounded half away from zero. */
export function applyBps(amountMinor: number, bps: number): number {
  const v = (amountMinor * bps) / 10_000;
  return Math.sign(v) * Math.round(Math.abs(v));
}

export function vatOn(amountMinor: number): number {
  return applyBps(amountMinor, VAT_BPS);
}

/** Number of chargeable 24-hour days (minimum 1) with a 59-minute grace per extra day. */
export function rentalDays(pickupAt: Date, returnAt: Date): number {
  const minutes = Math.ceil((returnAt.getTime() - pickupAt.getTime()) / MINUTE);
  if (minutes <= 0) throw new RangeError("returnAt must be after pickupAt");
  return Math.max(1, Math.ceil((minutes - DAY_GRACE_MINUTES) / (24 * 60)));
}

/** YYYY-MM-DD of an instant in a time zone. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** 0 = Sunday ... 6 = Saturday, in a time zone. */
export function localWeekday(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

const appliesTo = (r: PricingRuleData, input: PricingInput) =>
  r.isActive && (r.categoryId === null || r.categoryId === input.categoryId) && (r.branchId === null || r.branchId === input.pickupBranchId);

export function calculateQuote(input: PricingInput): Quote {
  assertMinor(input.baseDailyRateMinor, "baseDailyRateMinor", true);
  assertMinor(input.depositMinor, "depositMinor");
  assertMinor(input.locationFeeMinor, "locationFeeMinor");

  const days = rentalDays(input.pickupAt, input.returnAt);
  const rules = input.rules.filter((r) => appliesTo(r, input));

  // 1. Day-by-day rate with seasonal + weekend adjustments (WEEKEND = Saturday/Sunday local days,
  //    the UAE weekend since 2022).
  const dayRates: DayRate[] = [];
  for (let i = 0; i < days; i++) {
    const start = new Date(input.pickupAt.getTime() + i * DAY);
    const date = localDate(start, input.timezone);
    const weekday = localWeekday(start, input.timezone);
    let bps = 0;
    const applied: string[] = [];
    for (const r of rules) {
      if (r.kind === "SEASONAL" && r.validFrom && r.validTo && date >= r.validFrom && date <= r.validTo) {
        bps += r.adjustmentBps ?? 0;
        applied.push(r.name);
      } else if (r.kind === "WEEKEND" && (weekday === 0 || weekday === 6)) {
        bps += r.adjustmentBps ?? 0;
        applied.push(r.name);
      }
    }
    bps = Math.max(bps, -9_000); // never below 10 % of the base rate
    const rateFils = input.baseDailyRateMinor + applyBps(input.baseDailyRateMinor, bps);
    dayRates.push({ date, rateFils, adjustmentBps: bps, rules: applied });
  }
  const baseFils = dayRates.reduce((s, d) => s + d.rateFils, 0);

  // 2. Best duration discount (highest priority, then biggest discount).
  const discountRule = rules
    .filter((r) => r.kind === "DURATION_DISCOUNT" && (r.minDays ?? Infinity) <= days && (r.adjustmentBps ?? 0) < 0)
    .sort((a, b) => b.priority - a.priority || (a.adjustmentBps ?? 0) - (b.adjustmentBps ?? 0))[0];
  const discountFils = discountRule ? Math.min(baseFils, applyBps(baseFils, -(discountRule.adjustmentBps ?? 0))) : 0;

  // 3. Extras.
  const extras: QuoteExtraLine[] = input.extras.map((e) => {
    if (!Number.isInteger(e.quantity) || e.quantity < 1) throw new RangeError(`Invalid quantity for ${e.code}`);
    assertMinor(e.priceMinor, `extra ${e.code} price`);
    let perUnit = e.pricingType === "PER_DAY" ? e.priceMinor * days : e.priceMinor;
    if (e.pricingType === "PER_DAY" && e.maxTotalMinor !== null) perUnit = Math.min(perUnit, e.maxTotalMinor);
    return {
      extraId: e.extraId,
      code: e.code,
      name: e.name,
      pricingType: e.pricingType,
      quantity: e.quantity,
      unitFils: e.priceMinor,
      totalFils: perUnit * e.quantity,
    };
  });
  const extrasFils = extras.reduce((s, e) => s + e.totalFils, 0);

  // 4. One-way fee.
  let oneWayFeeFils = 0;
  if (input.pickupBranchId !== input.returnBranchId) {
    const rule = input.rules
      .filter(
        (r) =>
          r.isActive &&
          r.kind === "ONE_WAY_FEE" &&
          r.fromBranchId === input.pickupBranchId &&
          r.toBranchId === input.returnBranchId &&
          (r.categoryId === null || r.categoryId === input.categoryId),
      )
      .sort((a, b) => b.priority - a.priority)[0];
    oneWayFeeFils = rule?.amountMinor ?? DEFAULT_ONE_WAY_FEE_MINOR;
  }

  const locationFeeFils = input.locationFeeMinor;
  const subtotalFils = baseFils - discountFils + extrasFils + oneWayFeeFils + locationFeeFils;
  const vatFils = vatOn(subtotalFils);

  return {
    currency: CURRENCY,
    days,
    baseDailyRateFils: input.baseDailyRateMinor,
    dailyRateFils: Math.round(baseFils / days),
    dayRates,
    baseFils,
    discountFils,
    discountLabel: discountRule ? discountRule.name : null,
    extras,
    extrasFils,
    oneWayFeeFils,
    locationFeeFils,
    subtotalFils,
    vatBps: VAT_BPS,
    vatFils,
    totalFils: subtotalFils + vatFils,
    depositFils: input.depositMinor,
  };
}

export interface LateFee {
  lateMinutes: number;
  chargeableHours: number;
  feeFils: number;
  vatFils: number;
  totalFils: number;
}

/**
 * Late-return charge: nothing within the 59-minute grace; otherwise every started
 * hour costs `lateFeePerHourMinor`, capped at one daily rate per started 24 h.
 */
export function calculateLateFee(args: {
  scheduledReturnAt: Date;
  actualReturnAt: Date;
  dailyRateMinor: number;
  lateFeePerHourMinor: number;
}): LateFee {
  const lateMinutes = Math.max(0, Math.ceil((args.actualReturnAt.getTime() - args.scheduledReturnAt.getTime()) / MINUTE));
  if (lateMinutes <= LATE_GRACE_MINUTES) return { lateMinutes, chargeableHours: 0, feeFils: 0, vatFils: 0, totalFils: 0 };
  const chargeableHours = Math.ceil(lateMinutes / 60);
  const fullDays = Math.floor(chargeableHours / 24);
  const remHours = chargeableHours % 24;
  const feeFils = fullDays * args.dailyRateMinor + Math.min(remHours * args.lateFeePerHourMinor, args.dailyRateMinor);
  const vatFils = vatOn(feeFils);
  return { lateMinutes, chargeableHours, feeFils, vatFils, totalFils: feeFils + vatFils };
}

/** Refuelling charge (incl. VAT) when the car comes back with less fuel than it left with. */
export function calculateFuelCharge(pickupEighths: number, returnEighths: number): { missingEighths: number; feeFils: number; vatFils: number; totalFils: number } {
  const missingEighths = Math.max(0, pickupEighths - returnEighths);
  const feeFils = missingEighths * FUEL_CHARGE_PER_EIGHTH_MINOR;
  const vatFils = vatOn(feeFils);
  return { missingEighths, feeFils, vatFils, totalFils: feeFils + vatFils };
}

function assertMinor(v: number, name: string, positive = false) {
  if (!Number.isInteger(v) || v < 0 || (positive && v === 0)) {
    throw new RangeError(`${name} must be a ${positive ? "positive" : "non-negative"} integer number of fils, got ${v}`);
  }
}
