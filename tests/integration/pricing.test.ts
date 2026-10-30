/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";
import { loadContracts, missing } from "../helpers/contracts";
import { createCustomer, DAY, HOUR, pickVehicle, plus, reserve, window } from "../helpers/fixtures";

// Q3 pricing: server-side quote invariants (daily rate, days, extras, one-way fee, VAT 5%, deposit).

const c = await loadContracts();
const need = missing(c, ["quoteRental", "listBranches", "searchVehicles", "listExtras"]);

const isInt = (n: unknown) => Number.isInteger(n);
const vatOf = (subtotal: number) => Math.round((subtotal * 500) / 10_000);

describe.skipIf(need.length > 0)(`pricing ${need.length ? `(waiting on: ${need.join(", ")})` : ""}`, () => {
  let ctx: Awaited<ReturnType<typeof pickVehicle>>;
  let extras: any[];
  beforeAll(async () => {
    ctx = await pickVehicle(c, window(3), 0);
    extras = await c.listExtras!();
  });
  const quote = (over: Record<string, unknown> = {}) =>
    c.quoteRental!({ vehicleId: ctx.vehicle.id, pickupBranchId: ctx.branch.id, returnBranchId: ctx.branch.id, ...ctx.window, extras: [], ...over });

  it("3-day same-branch quote: base = days x daily, VAT 5% of subtotal, integer fils throughout", async () => {
    const r = await quote();
    expect(r.ok).toBe(true);
    const qt = r.quote;
    expect(qt.days).toBe(3);
    expect(qt.baseFils).toBe(qt.days * qt.dailyRateFils);
    expect(qt.oneWayFeeFils).toBe(0);
    expect(qt.subtotalFils).toBe(qt.baseFils + qt.extrasFils + qt.oneWayFeeFils);
    expect(qt.vatBps).toBe(500);
    expect(qt.vatFils).toBe(vatOf(qt.subtotalFils));
    expect(qt.totalFils).toBe(qt.subtotalFils + qt.vatFils);
    expect(qt.depositFils).toBeGreaterThan(0);
    for (const k of ["days", "dailyRateFils", "baseFils", "extrasFils", "oneWayFeeFils", "subtotalFils", "vatFils", "totalFils", "depositFils"]) {
      expect(isInt(qt[k]), k).toBe(true);
    }
  });

  it("charges by started 24h period: 24h = 1 day, 48h = 2 days, 49h > 2 days or within a declared grace", async () => {
    const start = ctx.window.pickupAt;
    expect((await quote({ returnAt: plus(start, DAY) })).quote.days).toBe(1);
    expect((await quote({ returnAt: plus(start, 2 * DAY) })).quote.days).toBe(2);
    expect((await quote({ returnAt: plus(start, 2 * DAY + 3 * HOUR) })).quote.days).toBe(3);
  });

  it("matches the price shown in search for the same window", async () => {
    const r = await quote();
    const hit = ctx.search.results.find((x: any) => x.vehicle.id === ctx.vehicle.id);
    expect(hit.dailyRateFils).toBe(r.quote.dailyRateFils);
    expect(hit.baseFils).toBe(r.quote.baseFils);
  });

  it("per-day extras scale with days and quantity; per-rental extras do not scale with days", async () => {
    const perDay = extras.find((e) => String(e.pricing).toLowerCase() === "per_day");
    const perRental = extras.find((e) => String(e.pricing).toLowerCase() === "per_rental");
    expect(perDay, "seed should include a per_day extra").toBeTruthy();
    const r = await quote({ extras: [{ extraId: perDay.id, quantity: Math.min(2, perDay.maxQuantity) }, ...(perRental ? [{ extraId: perRental.id, quantity: 1 }] : [])] });
    const qt = r.quote;
    const lineDay = qt.extras.find((l: any) => l.extraId === perDay.id);
    expect(lineDay.totalFils).toBe(perDay.priceFils * lineDay.quantity * qt.days);
    if (perRental) expect(qt.extras.find((l: any) => l.extraId === perRental.id).totalFils).toBe(perRental.priceFils);
    expect(qt.extrasFils).toBe(qt.extras.reduce((s: number, l: any) => s + l.totalFils, 0));
    expect(qt.vatFils).toBe(vatOf(qt.subtotalFils));
  });

  it("rejects extras over maxQuantity, zero/negative quantities and unknown extras", async () => {
    const e = extras[0];
    for (const bad of [
      [{ extraId: e.id, quantity: e.maxQuantity + 1 }],
      [{ extraId: e.id, quantity: 0 }],
      [{ extraId: e.id, quantity: -1 }],
      [{ extraId: "00000000-0000-0000-0000-000000000000", quantity: 1 }],
    ]) {
      expect((await quote({ extras: bad })).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("adds a one-way fee when the return branch differs", async () => {
    const other = ctx.branches.find((b: any) => b.id !== ctx.branch.id);
    expect(other, "seed should include 2+ branches").toBeTruthy();
    const r = await quote({ returnBranchId: other.id });
    expect(r.quote.oneWayFeeFils).toBeGreaterThan(0);
    expect(r.quote.subtotalFils).toBe(r.quote.baseFils + r.quote.extrasFils + r.quote.oneWayFeeFils);
  });

  it.skipIf(!c.createReservation || !c.getReservationForUser || !c.upsertDriverProfile)(
    "the reservation stores the server-computed quote (client cannot inject prices)",
    async () => {
      const u = await createCustomer(c);
      const w = window(2);
      const { vehicle, branch } = await pickVehicle(c, w, 0);
      const expected = (await c.quoteRental!({ vehicleId: vehicle.id, pickupBranchId: branch.id, returnBranchId: branch.id, ...w, extras: [] })).quote;
      const r = await reserve(c, u.id, vehicle.id, branch.id, w, { totalFils: 1, dailyRateFils: 1, priceFils: 1 });
      expect(r.ok).toBe(true);
      const d = await c.getReservationForUser!(u.id, r.reservationId);
      expect(d.quote.totalFils).toBe(expected.totalFils);
    },
  );
});
