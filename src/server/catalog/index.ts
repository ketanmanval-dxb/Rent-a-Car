import { and, asc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbOrTx } from "@/server/db";
import {
  branches,
  extras,
  maintenanceBlocks,
  reservations,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicleOccupancy,
  vehicles,
} from "@/server/db/schema";
import { AppError, toResult, type Result } from "@/server/lib/errors";
import { addDays, isLocalDate, zonedTimeToUtc } from "@/server/lib/time";
import { calculateQuote } from "@/server/pricing/engine";
import { loadActivePricingRules } from "@/server/pricing/quote";
import { assertRentalWindow } from "@/server/reservations/policy";
import {
  toBranch,
  toCategory,
  toExtra,
  toVehicleSummary,
  type Branch,
  type Category,
  type Extra,
  type VehicleDetail,
  type VehicleSummary,
} from "./dto";

export * from "./dto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export async function listBranches(opts: { includeInactive?: boolean } = {}): Promise<Branch[]> {
  const rows = await getDb()
    .select()
    .from(branches)
    .where(opts.includeInactive ? undefined : eq(branches.isActive, true))
    .orderBy(asc(branches.name));
  return rows.map(toBranch);
}

export async function getBranch(idOrCode: string): Promise<Branch | null> {
  const cond = UUID_RE.test(idOrCode) ? eq(branches.id, idOrCode) : eq(branches.code, idOrCode.toUpperCase());
  const [row] = await getDb().select().from(branches).where(cond);
  return row ? toBranch(row) : null;
}

export async function listCategories(): Promise<Category[]> {
  const rows = await getDb().select().from(vehicleCategories).orderBy(asc(vehicleCategories.sortOrder), asc(vehicleCategories.name));
  return rows.map(toCategory);
}

export async function listExtras(opts: { includeInactive?: boolean } = {}): Promise<Extra[]> {
  const rows = await getDb()
    .select()
    .from(extras)
    .where(opts.includeInactive ? undefined : eq(extras.isActive, true))
    .orderBy(asc(extras.name));
  return rows.map(toExtra);
}

export async function listFeatures(): Promise<{ id: string; code: string; name: string }[]> {
  return getDb().select({ id: vehicleFeatures.id, code: vehicleFeatures.code, name: vehicleFeatures.name }).from(vehicleFeatures).orderBy(asc(vehicleFeatures.name));
}

async function featureNamesFor(db: DbOrTx, vehicleIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!vehicleIds.length) return map;
  const rows = await db
    .select({ vehicleId: vehicleFeatureMap.vehicleId, name: vehicleFeatures.name })
    .from(vehicleFeatureMap)
    .innerJoin(vehicleFeatures, eq(vehicleFeatures.id, vehicleFeatureMap.featureId))
    .where(inArray(vehicleFeatureMap.vehicleId, vehicleIds))
    .orderBy(asc(vehicleFeatures.name));
  for (const r of rows) map.set(r.vehicleId, [...(map.get(r.vehicleId) ?? []), r.name]);
  return map;
}

export async function getVehicle(id: string): Promise<VehicleDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const db = getDb();
  const [row] = await db
    .select({ vehicle: vehicles, category: vehicleCategories, branch: branches })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(eq(vehicles.id, id));
  if (!row) return null;
  const features = (await featureNamesFor(db, [id])).get(id) ?? [];
  return {
    ...toVehicleSummary(row.vehicle, row.category, features),
    description: row.vehicle.description || row.category.description,
    branch: toBranch(row.branch),
    depositFils: row.category.depositMinor,
    plateNumber: row.vehicle.plateNumber,
    color: row.vehicle.color,
  };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

const rangeSql = (start: Date, end: Date) => sql`tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`;

/**
 * SQL condition: "vehicle `vehicleIdCol` has nothing occupying [start, end)".
 * Expired-but-not-yet-released PENDING holds don't count (they'll be expired by
 * the reservation transaction before it inserts).
 */
export function vehicleIsFreeSql(vehicleIdCol: SQL | typeof vehicles.id, start: Date, end: Date, excludeReservationId?: string): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${vehicleOccupancy} o
    LEFT JOIN ${reservations} r ON r.id = o.reservation_id
    WHERE o.vehicle_id = ${vehicleIdCol}
      AND o.period && ${rangeSql(start, end)}
      AND NOT COALESCE(r.status = 'PENDING' AND r.hold_expires_at <= now(), false)
      ${excludeReservationId ? sql`AND o.reservation_id IS DISTINCT FROM ${excludeReservationId}::uuid` : sql``}
  )`;
}

export async function isVehicleAvailable(
  db: DbOrTx,
  vehicleId: string,
  pickupAt: Date,
  returnAt: Date,
  opts: { excludeReservationId?: string } = {},
): Promise<boolean> {
  const rows = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), ne(vehicles.status, "RETIRED"), vehicleIsFreeSql(vehicles.id, pickupAt, returnAt, opts.excludeReservationId)));
  return rows.length > 0;
}

export const searchSchema = z.object({
  pickupBranchId: z.string().uuid(),
  returnBranchId: z.string().uuid().optional(),
  pickupAt: z.coerce.date(),
  returnAt: z.coerce.date(),
  categoryId: z.string().uuid().optional(),
  transmission: z.enum(["automatic", "manual"]).optional(),
  minSeats: z.coerce.number().int().min(1).max(60).optional(),
  fuelType: z.enum(["petrol", "diesel", "hybrid", "electric"]).optional(),
  minDailyFils: z.coerce.number().int().min(0).optional(),
  maxDailyFils: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["price_asc", "price_desc"]).default("price_asc"),
});
export type SearchParams = z.input<typeof searchSchema>;

export interface SearchResult {
  vehicle: VehicleSummary;
  /** Average daily rate for these dates (after seasonal/weekend rules). */
  dailyRateFils: number;
  /** Rental before discount/extras/fees. */
  baseFils: number;
  discountFils: number;
  oneWayFeeFils: number;
  locationFeeFils: number;
  /** Total incl. VAT without extras. */
  totalFils: number;
  depositFils: number;
}

/** Vehicles at the pick-up branch that are free for [pickupAt, returnAt), priced for those dates. */
export async function searchVehicles(params: SearchParams): Promise<Result<{ days: number; results: SearchResult[] }>> {
  return toResult(async () => {
    const p = searchSchema.parse(params);
    assertRentalWindow(p.pickupAt, p.returnAt);
    const returnBranchId = p.returnBranchId ?? p.pickupBranchId;
    const db = getDb();

    const branchRows = await db.select().from(branches).where(inArray(branches.id, [...new Set([p.pickupBranchId, returnBranchId])]));
    const pickupBranch = branchRows.find((b) => b.id === p.pickupBranchId);
    if (!pickupBranch?.isActive || !branchRows.find((b) => b.id === returnBranchId)?.isActive) {
      throw new AppError("INVALID", "Choose an open pick-up and return branch.");
    }

    const conds: SQL[] = [
      eq(vehicles.branchId, p.pickupBranchId),
      ne(vehicles.status, "RETIRED"),
      vehicleIsFreeSql(vehicles.id, p.pickupAt, p.returnAt),
    ];
    if (p.categoryId) conds.push(eq(vehicles.categoryId, p.categoryId));
    if (p.transmission) conds.push(eq(vehicles.transmission, p.transmission.toUpperCase() as "AUTOMATIC" | "MANUAL"));
    if (p.fuelType) conds.push(eq(vehicles.fuelType, p.fuelType.toUpperCase() as "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC"));
    if (p.minSeats) conds.push(gte(vehicles.seats, p.minSeats));

    const rows = await db
      .select({ vehicle: vehicles, category: vehicleCategories })
      .from(vehicles)
      .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
      .where(and(...conds));

    const rules = await loadActivePricingRules(db);
    const features = await featureNamesFor(db, rows.map((r) => r.vehicle.id));
    let days = 0;
    let results: SearchResult[] = rows.map(({ vehicle, category }) => {
      const q = calculateQuote({
        pickupAt: p.pickupAt,
        returnAt: p.returnAt,
        timezone: pickupBranch.timezone,
        categoryId: category.id,
        pickupBranchId: p.pickupBranchId,
        returnBranchId,
        baseDailyRateMinor: vehicle.dailyRateMinor ?? category.dailyRateMinor,
        depositMinor: category.depositMinor,
        locationFeeMinor: pickupBranch.locationFeeMinor,
        rules,
        extras: [],
      });
      days = q.days;
      return {
        vehicle: toVehicleSummary(vehicle, category, features.get(vehicle.id) ?? []),
        dailyRateFils: q.dailyRateFils,
        baseFils: q.baseFils,
        discountFils: q.discountFils,
        oneWayFeeFils: q.oneWayFeeFils,
        locationFeeFils: q.locationFeeFils,
        totalFils: q.totalFils,
        depositFils: q.depositFils,
      };
    });
    if (p.minDailyFils !== undefined) results = results.filter((r) => r.dailyRateFils >= p.minDailyFils!);
    if (p.maxDailyFils !== undefined) results = results.filter((r) => r.dailyRateFils <= p.maxDailyFils!);
    results.sort((a, b) => (p.sort === "price_desc" ? b.dailyRateFils - a.dailyRateFils : a.dailyRateFils - b.dailyRateFils));
    if (!days) days = Math.max(1, Math.ceil((p.returnAt.getTime() - p.pickupAt.getTime() - 59 * 60_000) / 86_400_000));
    return { days, results };
  }, { op: "searchVehicles" });
}

export type CalendarDayStatus = "available" | "booked" | "maintenance";

/**
 * Per-day availability for a vehicle between two local dates (inclusive, max 120 days),
 * in the vehicle's branch time zone. A day is "booked"/"maintenance" if anything
 * occupies any part of it (maintenance wins if both).
 */
export async function getAvailabilityCalendar(
  vehicleId: string,
  fromDate: string,
  toDate: string,
): Promise<{ date: string; status: CalendarDayStatus }[]> {
  if (!UUID_RE.test(vehicleId) || !isLocalDate(fromDate) || !isLocalDate(toDate) || toDate < fromDate) {
    throw new AppError("INVALID", "Invalid calendar range.");
  }
  const db = getDb();
  const [v] = await db
    .select({ tz: branches.timezone })
    .from(vehicles)
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(eq(vehicles.id, vehicleId));
  if (!v) throw new AppError("NOT_FOUND", "Vehicle not found.");

  const dates: string[] = [];
  for (let d = fromDate; d <= toDate && dates.length < 120; d = addDays(d, 1)) dates.push(d);
  const rangeStart = zonedTimeToUtc(dates[0], "00:00", v.tz);
  const rangeEnd = zonedTimeToUtc(addDays(dates[dates.length - 1], 1), "00:00", v.tz);

  const busy = await db
    .select({
      kind: sql<"reservation" | "maintenance">`CASE WHEN ${vehicleOccupancy.reservationId} IS NULL THEN 'maintenance' ELSE 'reservation' END`,
      start: sql<Date>`lower(${vehicleOccupancy.period})`.mapWith((v: string | Date) => new Date(v)),
      end: sql<Date>`upper(${vehicleOccupancy.period})`.mapWith((v: string | Date) => new Date(v)),
    })
    .from(vehicleOccupancy)
    .leftJoin(reservations, eq(reservations.id, vehicleOccupancy.reservationId))
    .where(
      and(
        eq(vehicleOccupancy.vehicleId, vehicleId),
        sql`${vehicleOccupancy.period} && ${rangeSql(rangeStart, rangeEnd)}`,
        sql`NOT COALESCE(${reservations.status} = 'PENDING' AND ${reservations.holdExpiresAt} <= now(), false)`,
      ),
    );

  return dates.map((date) => {
    const s = zonedTimeToUtc(date, "00:00", v.tz).getTime();
    const e = zonedTimeToUtc(addDays(date, 1), "00:00", v.tz).getTime();
    const hits = busy.filter((b) => b.start.getTime() < e && b.end.getTime() > s);
    const status: CalendarDayStatus = hits.some((h) => h.kind === "maintenance") ? "maintenance" : hits.length ? "booked" : "available";
    return { date, status };
  });
}

/** Busy periods for a vehicle (admin views / detailed calendars). */
export async function listVehicleBusyPeriods(vehicleId: string, from: Date, to: Date) {
  const db = getDb();
  const res = await db
    .select({ id: reservations.id, reference: reservations.reference, status: reservations.status, start: reservations.pickupAt, end: reservations.returnAt })
    .from(reservations)
    .where(
      and(
        eq(reservations.vehicleId, vehicleId),
        inArray(reservations.status, ["PENDING", "CONFIRMED", "PICKED_UP"]),
        lte(reservations.pickupAt, to),
        gte(reservations.returnAt, from),
      ),
    );
  const blocks = await db
    .select({ id: maintenanceBlocks.id, reason: maintenanceBlocks.reason, status: maintenanceBlocks.status, start: maintenanceBlocks.startsAt, end: maintenanceBlocks.endsAt })
    .from(maintenanceBlocks)
    .where(and(eq(maintenanceBlocks.vehicleId, vehicleId), ne(maintenanceBlocks.status, "CANCELLED"), lte(maintenanceBlocks.startsAt, to), gte(maintenanceBlocks.endsAt, from)));
  return { reservations: res, maintenance: blocks };
}

