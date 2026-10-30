import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbOrTx } from "@/server/db";
import { branches, extras as extrasTable, pricingRules, vehicleCategories, vehicles } from "@/server/db/schema";
import { AppError, toResult, type Result } from "@/server/lib/errors";
import { assertRentalWindow } from "@/server/reservations/policy";
import { calculateQuote, type ExtraSelection, type PricingRuleData, type Quote } from "./engine";

export const extrasInputSchema = z
  .array(z.object({ extraId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(10) }))
  .max(20)
  .default([]);

export const rentalRequestSchema = z.object({
  vehicleId: z.string().uuid(),
  pickupBranchId: z.string().uuid(),
  returnBranchId: z.string().uuid(),
  pickupAt: z.coerce.date(),
  returnAt: z.coerce.date(),
  extras: extrasInputSchema,
});

export type RentalRequest = z.input<typeof rentalRequestSchema>;
export type ParsedRentalRequest = z.output<typeof rentalRequestSchema>;

export async function loadActivePricingRules(db: DbOrTx): Promise<PricingRuleData[]> {
  return db.select().from(pricingRules).where(eq(pricingRules.isActive, true));
}

/**
 * Loads everything needed to price a rental and returns the server-side quote.
 * Validates the branches, vehicle (not retired, located at the pick-up branch)
 * and extras. Does NOT check availability.
 */
export async function priceRental(db: DbOrTx, req: ParsedRentalRequest, opts: { now?: Date; skipWindowCheck?: boolean } = {}) {
  if (!opts.skipWindowCheck) assertRentalWindow(req.pickupAt, req.returnAt, opts.now);

  const [row] = await db
    .select({ vehicle: vehicles, category: vehicleCategories })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(eq(vehicles.id, req.vehicleId));
  if (!row) throw new AppError("NOT_FOUND", "Vehicle not found.");
  if (row.vehicle.status === "RETIRED") throw new AppError("UNAVAILABLE", "This vehicle is no longer available.");

  const branchIds = [...new Set([req.pickupBranchId, req.returnBranchId])];
  const branchRows = await db.select().from(branches).where(inArray(branches.id, branchIds));
  const pickupBranch = branchRows.find((b) => b.id === req.pickupBranchId);
  const returnBranch = branchRows.find((b) => b.id === req.returnBranchId);
  if (!pickupBranch?.isActive || !returnBranch?.isActive) throw new AppError("INVALID", "Choose an open pick-up and return branch.");
  if (row.vehicle.branchId !== pickupBranch.id) {
    throw new AppError("INVALID", "This vehicle is not available at the selected pick-up branch.");
  }

  const selections: ExtraSelection[] = [];
  const merged = new Map<string, number>();
  for (const e of req.extras) merged.set(e.extraId, (merged.get(e.extraId) ?? 0) + e.quantity);
  if (merged.size) {
    const extraRows = await db
      .select()
      .from(extrasTable)
      .where(and(inArray(extrasTable.id, [...merged.keys()]), eq(extrasTable.isActive, true)));
    for (const [extraId, quantity] of merged) {
      const ex = extraRows.find((x) => x.id === extraId);
      if (!ex) throw new AppError("INVALID", "One of the selected extras is not available.");
      if (quantity > ex.maxQuantity) throw new AppError("INVALID", `At most ${ex.maxQuantity} × ${ex.name}.`);
      selections.push({
        extraId,
        code: ex.code,
        name: ex.name,
        pricingType: ex.pricingType,
        priceMinor: ex.priceMinor,
        maxTotalMinor: ex.maxTotalMinor,
        quantity,
      });
    }
  }

  const quote = calculateQuote({
    pickupAt: req.pickupAt,
    returnAt: req.returnAt,
    timezone: pickupBranch.timezone,
    categoryId: row.category.id,
    pickupBranchId: pickupBranch.id,
    returnBranchId: returnBranch.id,
    baseDailyRateMinor: row.vehicle.dailyRateMinor ?? row.category.dailyRateMinor,
    depositMinor: row.category.depositMinor,
    locationFeeMinor: pickupBranch.locationFeeMinor,
    rules: await loadActivePricingRules(db),
    extras: selections,
  });

  return { quote, vehicle: row.vehicle, category: row.category, pickupBranch, returnBranch };
}

/** Public: price a prospective rental (no availability check; use searchVehicles/isVehicleAvailable for that). */
export async function quoteRental(input: RentalRequest): Promise<Result<{ quote: Quote }>> {
  return toResult(async () => {
    const req = rentalRequestSchema.parse(input);
    const { quote } = await priceRental(getDb(), req);
    return { quote };
  }, { op: "quoteRental" });
}
