import { describe, expect, it } from "vitest";
import { cancellationTerms, canModifyDates, assertRentalWindow } from "@/server/reservations/policy";
import {
  applyBps,
  calculateFuelCharge,
  calculateLateFee,
  calculateQuote,
  DEFAULT_ONE_WAY_FEE_MINOR,
  rentalDays,
  type PricingInput,
  type PricingRuleData,
} from "./engine";

const H = 3_600_000;
const D = 24 * H;
// Tuesday 2030-03-05 10:00 Asia/Dubai (06:00Z)
const TUE = new Date("2030-03-05T06:00:00Z");

const rule = (r: Partial<PricingRuleData> & Pick<PricingRuleData, "kind">): PricingRuleData => ({
  id: crypto.randomUUID(),
  name: r.kind,
  categoryId: null,
  branchId: null,
  fromBranchId: null,
  toBranchId: null,
  validFrom: null,
  validTo: null,
  minDays: null,
  adjustmentBps: null,
  amountMinor: null,
  priority: 0,
  isActive: true,
  ...r,
});

const base = (over: Partial<PricingInput> = {}): PricingInput => ({
  pickupAt: TUE,
  returnAt: new Date(TUE.getTime() + 3 * D),
  timezone: "Asia/Dubai",
  categoryId: "cat",
  pickupBranchId: "A",
  returnBranchId: "A",
  baseDailyRateMinor: 10_000,
  depositMinor: 100_000,
  locationFeeMinor: 0,
  rules: [],
  extras: [],
  ...over,
});

describe("rentalDays", () => {
  it("charges a minimum of one day", () => {
    expect(rentalDays(TUE, new Date(TUE.getTime() + H))).toBe(1);
  });
  it("counts 24h periods with a 59-minute grace", () => {
    expect(rentalDays(TUE, new Date(TUE.getTime() + D))).toBe(1);
    expect(rentalDays(TUE, new Date(TUE.getTime() + D + 59 * 60_000))).toBe(1);
    expect(rentalDays(TUE, new Date(TUE.getTime() + D + 60 * 60_000))).toBe(2);
    expect(rentalDays(TUE, new Date(TUE.getTime() + 7 * D))).toBe(7);
  });
  it("rejects non-positive periods", () => {
    expect(() => rentalDays(TUE, TUE)).toThrow(RangeError);
  });
});

describe("calculateQuote", () => {
  it("computes base, VAT 5% and total in integer fils", () => {
    const q = calculateQuote(base());
    expect(q.days).toBe(3);
    expect(q.baseFils).toBe(30_000);
    expect(q.subtotalFils).toBe(30_000);
    expect(q.vatBps).toBe(500);
    expect(q.vatFils).toBe(1_500);
    expect(q.totalFils).toBe(31_500);
    expect(q.depositFils).toBe(100_000);
    for (const v of [q.baseFils, q.vatFils, q.totalFils, q.dailyRateFils]) expect(Number.isInteger(v)).toBe(true);
  });

  it("rounds VAT half away from zero", () => {
    // subtotal 10_010 -> VAT 500.5 -> 501
    const q = calculateQuote(base({ baseDailyRateMinor: 10_010, returnAt: new Date(TUE.getTime() + D) }));
    expect(q.vatFils).toBe(501);
    expect(applyBps(10_010, 500)).toBe(501);
  });

  it("applies weekend surcharge to days starting Sat/Sun in the branch time zone", () => {
    // Fri 2030-03-08 10:00 local -> Fri, Sat, Sun, Mon
    const fri = new Date("2030-03-08T06:00:00Z");
    const q = calculateQuote(base({ pickupAt: fri, returnAt: new Date(fri.getTime() + 4 * D), rules: [rule({ kind: "WEEKEND", adjustmentBps: 1_000 })] }));
    expect(q.dayRates.map((d) => d.rateFils)).toEqual([10_000, 11_000, 11_000, 10_000]);
    expect(q.baseFils).toBe(42_000);
    expect(q.dailyRateFils).toBe(10_500);
  });

  it("uses the local date for seasonal rules (late-evening UTC is next day in Dubai)", () => {
    // 2030-03-09 21:00Z = 2030-03-10 01:00 Dubai
    const p = new Date("2030-03-09T21:00:00Z");
    const q = calculateQuote(
      base({ pickupAt: p, returnAt: new Date(p.getTime() + D), rules: [rule({ kind: "SEASONAL", validFrom: "2030-03-10", validTo: "2030-03-10", adjustmentBps: 2_500 })] }),
    );
    expect(q.dayRates[0].date).toBe("2030-03-10");
    expect(q.baseFils).toBe(12_500);
  });

  it("ignores rules for other categories, branches and inactive rules", () => {
    const q = calculateQuote(
      base({
        rules: [
          rule({ kind: "SEASONAL", validFrom: "2030-01-01", validTo: "2030-12-31", adjustmentBps: 5_000, categoryId: "other" }),
          rule({ kind: "SEASONAL", validFrom: "2030-01-01", validTo: "2030-12-31", adjustmentBps: 5_000, branchId: "B" }),
          rule({ kind: "SEASONAL", validFrom: "2030-01-01", validTo: "2030-12-31", adjustmentBps: 5_000, isActive: false }),
        ],
      }),
    );
    expect(q.baseFils).toBe(30_000);
  });

  it("applies the highest-priority duration discount that qualifies", () => {
    const rules = [
      rule({ kind: "DURATION_DISCOUNT", minDays: 7, adjustmentBps: -1_000, priority: 1, name: "weekly" }),
      rule({ kind: "DURATION_DISCOUNT", minDays: 21, adjustmentBps: -2_000, priority: 2, name: "monthly" }),
    ];
    const week = calculateQuote(base({ returnAt: new Date(TUE.getTime() + 7 * D), rules }));
    expect(week.discountLabel).toBe("weekly");
    expect(week.discountFils).toBe(7_000);
    const month = calculateQuote(base({ returnAt: new Date(TUE.getTime() + 21 * D), rules }));
    expect(month.discountLabel).toBe("monthly");
    expect(month.discountFils).toBe(42_000);
    const short = calculateQuote(base({ rules }));
    expect(short.discountFils).toBe(0);
  });

  it("prices extras per day (with cap) and per rental, times quantity", () => {
    const q = calculateQuote(
      base({
        returnAt: new Date(TUE.getTime() + 12 * D),
        extras: [
          { extraId: "1", code: "child_seat", name: "Child seat", pricingType: "PER_DAY", priceMinor: 2_500, maxTotalMinor: 25_000, quantity: 2 },
          { extraId: "2", code: "gps", name: "GPS", pricingType: "PER_DAY", priceMinor: 2_000, maxTotalMinor: null, quantity: 1 },
          { extraId: "3", code: "additional_driver", name: "Driver", pricingType: "PER_RENTAL", priceMinor: 7_500, maxTotalMinor: null, quantity: 1 },
        ],
      }),
    );
    expect(q.extras.map((e) => e.totalFils)).toEqual([50_000, 24_000, 7_500]);
    expect(q.extrasFils).toBe(81_500);
  });

  it("adds a one-way fee from a matching rule, else the default", () => {
    const rules = [rule({ kind: "ONE_WAY_FEE", fromBranchId: "A", toBranchId: "B", amountMinor: 7_500 })];
    expect(calculateQuote(base({ returnBranchId: "B", rules })).oneWayFeeFils).toBe(7_500);
    expect(calculateQuote(base({ returnBranchId: "C", rules })).oneWayFeeFils).toBe(DEFAULT_ONE_WAY_FEE_MINOR);
    expect(calculateQuote(base({ rules })).oneWayFeeFils).toBe(0);
  });

  it("sums subtotal = base - discount + extras + one-way + location; VAT on subtotal", () => {
    const q = calculateQuote(
      base({
        returnAt: new Date(TUE.getTime() + 7 * D),
        returnBranchId: "B",
        locationFeeMinor: 5_000,
        rules: [
          rule({ kind: "DURATION_DISCOUNT", minDays: 7, adjustmentBps: -1_000 }),
          rule({ kind: "ONE_WAY_FEE", fromBranchId: "A", toBranchId: "B", amountMinor: 25_000 }),
        ],
        extras: [{ extraId: "g", code: "gps", name: "GPS", pricingType: "PER_DAY", priceMinor: 2_000, maxTotalMinor: 20_000, quantity: 1 }],
      }),
    );
    // base 70_000 (Tue..Mon, no weekend rule), discount 7_000, extras 14_000, one-way 25_000, location 5_000
    expect(q.subtotalFils).toBe(70_000 - 7_000 + 14_000 + 25_000 + 5_000);
    expect(q.vatFils).toBe(Math.round(q.subtotalFils * 0.05));
    expect(q.totalFils).toBe(q.subtotalFils + q.vatFils);
  });

  it("rejects floats and invalid quantities", () => {
    expect(() => calculateQuote(base({ baseDailyRateMinor: 100.5 }))).toThrow(RangeError);
    expect(() =>
      calculateQuote(base({ extras: [{ extraId: "x", code: "x", name: "x", pricingType: "PER_RENTAL", priceMinor: 100, maxTotalMinor: null, quantity: 0 }] })),
    ).toThrow(RangeError);
  });
});

describe("calculateLateFee", () => {
  const sched = new Date("2030-03-05T06:00:00Z");
  const fee = (minutesLate: number) =>
    calculateLateFee({ scheduledReturnAt: sched, actualReturnAt: new Date(sched.getTime() + minutesLate * 60_000), dailyRateMinor: 20_000, lateFeePerHourMinor: 4_000 });

  it("is free within the 59-minute grace", () => {
    expect(fee(0).totalFils).toBe(0);
    expect(fee(59).totalFils).toBe(0);
    expect(fee(-30).totalFils).toBe(0);
  });
  it("charges per started hour plus VAT", () => {
    expect(fee(60)).toMatchObject({ chargeableHours: 1, feeFils: 4_000, vatFils: 200, totalFils: 4_200 });
    expect(fee(61)).toMatchObject({ chargeableHours: 2, feeFils: 8_000 });
  });
  it("caps at one daily rate per started 24h", () => {
    expect(fee(10 * 60).feeFils).toBe(20_000);
    expect(fee(26 * 60).feeFils).toBe(20_000 + 8_000);
  });
});

describe("calculateFuelCharge", () => {
  it("charges missing eighths plus VAT, nothing when returned fuller", () => {
    expect(calculateFuelCharge(8, 6)).toMatchObject({ missingEighths: 2, feeFils: 12_000, vatFils: 600, totalFils: 12_600 });
    expect(calculateFuelCharge(4, 8).totalFils).toBe(0);
  });
});

describe("cancellation policy", () => {
  const pickupAt = new Date("2030-03-10T06:00:00Z");
  const at = (hoursBefore: number) => new Date(pickupAt.getTime() - hoursBefore * H);

  it("pending bookings cancel free", () => {
    expect(cancellationTerms({ status: "PENDING", pickupAt, paidFils: 0, dailyRateFils: 20_000, now: at(1) })).toMatchObject({ eligible: true, feeFils: 0 });
  });
  it("full refund 48h or more before pick-up", () => {
    expect(cancellationTerms({ status: "CONFIRMED", pickupAt, paidFils: 63_000, dailyRateFils: 20_000, now: at(48) })).toMatchObject({
      eligible: true,
      free: true,
      feeFils: 0,
      refundFils: 63_000,
    });
  });
  it("keeps one day + VAT inside 48h", () => {
    expect(cancellationTerms({ status: "CONFIRMED", pickupAt, paidFils: 63_000, dailyRateFils: 20_000, now: at(47) })).toMatchObject({
      eligible: true,
      feeFils: 21_000,
      refundFils: 42_000,
    });
  });
  it("fee never exceeds what was paid", () => {
    expect(cancellationTerms({ status: "CONFIRMED", pickupAt, paidFils: 10_000, dailyRateFils: 20_000, now: at(2) }).refundFils).toBe(0);
  });
  it("not eligible after pick-up time or once picked up", () => {
    expect(cancellationTerms({ status: "CONFIRMED", pickupAt, paidFils: 1, dailyRateFils: 1, now: at(-1) }).eligible).toBe(false);
    expect(cancellationTerms({ status: "PICKED_UP", pickupAt, paidFils: 1, dailyRateFils: 1, now: at(100) }).eligible).toBe(false);
  });
  it("date changes allowed until 24h before pick-up", () => {
    expect(canModifyDates("CONFIRMED", pickupAt, at(25)).allowed).toBe(true);
    expect(canModifyDates("CONFIRMED", pickupAt, at(23)).allowed).toBe(false);
    expect(canModifyDates("CANCELLED", pickupAt, at(100)).allowed).toBe(false);
  });
  it("validates the booking window", () => {
    const now = new Date("2030-03-01T00:00:00Z");
    expect(() => assertRentalWindow(new Date(now.getTime() + 30 * 60_000), new Date(now.getTime() + D), now)).toThrow(/at least 60 minutes/);
    expect(() => assertRentalWindow(new Date(now.getTime() + 2 * H), new Date(now.getTime() + 2.5 * H), now)).toThrow(/at least 1 hour/);
    expect(() => assertRentalWindow(new Date(now.getTime() + 2 * H), new Date(now.getTime() + 32 * D), now)).toThrow(/at most 30 days/);
    expect(() => assertRentalWindow(new Date(now.getTime() + 2 * H), new Date(now.getTime() + 3 * D), now)).not.toThrow();
  });
});
