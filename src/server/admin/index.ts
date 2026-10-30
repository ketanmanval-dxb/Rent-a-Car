import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { toBranch, toCategory, toExtra, toVehicleSummary } from "@/server/catalog/dto";
import { getDb, type Tx } from "@/server/db";
import {
  auditLogs,
  branches,
  damageReports,
  extras,
  maintenanceBlocks,
  pricingRules,
  rentalAgreements,
  reservations,
  users,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicleOccupancy,
  vehicles,
} from "@/server/db/schema";
import { damageImageUrl } from "@/server/files";
import {
  AppError,
  pgConstraint,
  pgErrorCode,
  PG_EXCLUSION_VIOLATION,
  PG_FK_VIOLATION,
  PG_UNIQUE_VIOLATION,
  toResult,
  type Result,
} from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { captureDeposit, chargeAdditional, releaseDeposit } from "@/server/payments/service";
import { calculateFuelCharge, calculateLateFee } from "@/server/pricing/engine";
import { assertUpload, MAX_DAMAGE_IMAGE_BYTES } from "@/server/profile";
import { getReservationDetail, queryReservations, type ReservationStatus } from "@/server/reservations/queries";
import { cancelReservationTx, modifyReservationDatesTx, type DateChangeInput } from "@/server/reservations/service";
import { getStorage } from "@/server/storage";

// Admin server functions. Every function takes the acting admin's user id first,
// re-checks the role in the database, returns a Result, and writes audit_logs for
// every change. Call them from Server Actions after requireAdmin()/assertAdmin().

const log = logger.child({ module: "admin" });
const uuid = z.string().uuid();
const upper = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (typeof v === "string" ? v.toUpperCase() : v), z.enum(values));

async function assertIsAdmin(adminId: string): Promise<void> {
  if (!uuid.safeParse(adminId).success) throw new AppError("FORBIDDEN", "Admin access required.");
  const [u] = await getDb().select({ role: users.role }).from(users).where(eq(users.id, adminId));
  if (u?.role !== "admin") throw new AppError("FORBIDDEN", "Admin access required.");
}

function admin<T extends object>(adminId: string, op: string, fn: () => Promise<T>): Promise<Result<T>> {
  return toResult(async () => {
    await assertIsAdmin(adminId);
    try {
      return await fn();
    } catch (err) {
      const code = pgErrorCode(err);
      if (code === PG_UNIQUE_VIOLATION) {
        const c = pgConstraint(err) ?? "";
        const what = c.includes("plate") ? "plate number" : c.includes("vin") ? "VIN" : c.includes("code") ? "code" : "value";
        throw new AppError("CONFLICT", `That ${what} is already in use.`);
      }
      if (code === PG_EXCLUSION_VIOLATION) throw new AppError("CONFLICT", "That period overlaps an existing booking or maintenance block.");
      if (code === PG_FK_VIOLATION) throw new AppError("CONFLICT", "This record is still in use and can't be removed.");
      if (code === "23514") throw new AppError("INVALID", "Some values are out of range.");
      throw err;
    }
  }, { op, adminId });
}

async function audit(db: Tx | ReturnType<typeof getDb>, adminId: string, action: string, entityType: string, entityId: string | null, data: Record<string, unknown> = {}) {
  await db.insert(auditLogs).values({ actorUserId: adminId, action, entityType, entityId, data });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function adminStats(adminId: string) {
  return admin(adminId, "adminStats", async () => {
    const db = getDb();
    const [fleet] = await db.execute<Record<string, string>>(sql`
      SELECT count(*) FILTER (WHERE status = 'AVAILABLE') available,
             count(*) FILTER (WHERE status = 'RESERVED') reserved,
             count(*) FILTER (WHERE status = 'ON_RENT') on_rent,
             count(*) FILTER (WHERE status = 'MAINTENANCE') maintenance,
             count(*) FILTER (WHERE status = 'RETIRED') retired,
             count(*) total
      FROM vehicles`).then((r) => r.rows);
    const [res] = await db.execute<Record<string, string>>(sql`
      SELECT count(*) FILTER (WHERE status = 'PENDING') pending,
             count(*) FILTER (WHERE status = 'CONFIRMED') confirmed,
             count(*) FILTER (WHERE status = 'PICKED_UP') on_rent,
             count(*) FILTER (WHERE status = 'CONFIRMED' AND pickup_at < now() + interval '24 hours') pickups_next_24h,
             count(*) FILTER (WHERE status = 'PICKED_UP' AND return_at < now() + interval '24 hours') returns_next_24h,
             count(*) FILTER (WHERE status = 'PICKED_UP' AND return_at < now()) overdue
      FROM reservations`).then((r) => r.rows);
    const [rev] = await db.execute<{ n: string }>(sql`
      SELECT coalesce(sum(amount_minor - refunded_minor), 0) n FROM payments
      WHERE status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') AND created_at > now() - interval '30 days'`).then((r) => r.rows);
    const n = (v: string | undefined) => Number(v ?? 0);
    return {
      fleet: { available: n(fleet.available), reserved: n(fleet.reserved), onRent: n(fleet.on_rent), maintenance: n(fleet.maintenance), retired: n(fleet.retired), total: n(fleet.total) },
      reservations: {
        pending: n(res.pending),
        confirmed: n(res.confirmed),
        onRent: n(res.on_rent),
        pickupsNext24h: n(res.pickups_next_24h),
        returnsNext24h: n(res.returns_next_24h),
        overdue: n(res.overdue),
      },
      revenueLast30DaysFils: n(rev.n),
    };
  });
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

const branchSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, "2-12 letters, digits or dashes"),
  name: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(60),
  emirate: z.string().trim().min(2).max(60),
  address: z.string().trim().min(5).max(300),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().optional().nullable(),
  timezone: z
    .string()
    .trim()
    .default("Asia/Dubai")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown IANA time zone"),
  openingHours: z.string().trim().min(3).max(200).default("Daily 08:00-22:00"),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  locationFeeFils: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
export type BranchInput = z.input<typeof branchSchema>;

function branchValues(d: z.output<typeof branchSchema>) {
  return {
    code: d.code,
    name: d.name,
    city: d.city,
    emirate: d.emirate,
    address: d.address,
    phone: d.phone,
    email: d.email ?? null,
    timezone: d.timezone,
    openingHours: d.openingHours,
    latitude: d.latitude == null ? null : d.latitude.toFixed(6),
    longitude: d.longitude == null ? null : d.longitude.toFixed(6),
    locationFeeMinor: d.locationFeeFils,
    isActive: d.isActive,
  };
}

export async function adminListBranches(adminId: string) {
  return admin(adminId, "adminListBranches", async () => {
    const rows = await getDb().select().from(branches).orderBy(asc(branches.name));
    return { branches: rows.map(toBranch) };
  });
}

export async function adminCreateBranch(adminId: string, input: BranchInput) {
  return admin(adminId, "adminCreateBranch", async () => {
    const d = branchSchema.parse(input);
    const [row] = await getDb().insert(branches).values(branchValues(d)).returning();
    await audit(getDb(), adminId, "branch.created", "branch", row.id, { code: row.code });
    return { branch: toBranch(row) };
  });
}

export async function adminUpdateBranch(adminId: string, branchId: string, input: Partial<BranchInput>) {
  return admin(adminId, "adminUpdateBranch", async () => {
    const db = getDb();
    const [cur] = await db.select().from(branches).where(eq(branches.id, uuid.parse(branchId)));
    if (!cur) throw new AppError("NOT_FOUND", "Branch not found.");
    const d = branchSchema.parse({ ...toBranch(cur), ...input });
    const [row] = await db.update(branches).set(branchValues(d)).where(eq(branches.id, cur.id)).returning();
    await audit(db, adminId, "branch.updated", "branch", row.id, { changes: input });
    return { branch: toBranch(row) };
  });
}

export async function adminSetBranchActive(adminId: string, branchId: string, isActive: boolean) {
  return adminUpdateBranch(adminId, branchId, { isActive });
}

// ---------------------------------------------------------------------------
// Categories & extras
// ---------------------------------------------------------------------------

export async function adminListCategories(adminId: string) {
  return admin(adminId, "adminListCategories", async () => ({
    categories: (await getDb().select().from(vehicleCategories).orderBy(asc(vehicleCategories.sortOrder))).map(toCategory),
  }));
}

const categoryUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(500).optional(),
  dailyRateFils: z.coerce.number().int().positive().optional(),
  depositFils: z.coerce.number().int().min(0).optional(),
  lateFeePerHourFils: z.coerce.number().int().min(0).optional(),
});

export async function adminUpdateCategory(adminId: string, categoryId: string, input: z.input<typeof categoryUpdateSchema>) {
  return admin(adminId, "adminUpdateCategory", async () => {
    const d = categoryUpdateSchema.parse(input);
    const [row] = await getDb()
      .update(vehicleCategories)
      .set({ name: d.name, description: d.description, dailyRateMinor: d.dailyRateFils, depositMinor: d.depositFils, lateFeePerHourMinor: d.lateFeePerHourFils })
      .where(eq(vehicleCategories.id, uuid.parse(categoryId)))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "Category not found.");
    await audit(getDb(), adminId, "category.updated", "vehicle_category", row.id, d);
    return { category: toCategory(row) };
  });
}

export async function adminListExtras(adminId: string) {
  return admin(adminId, "adminListExtras", async () => ({ extras: (await getDb().select().from(extras).orderBy(asc(extras.name))).map(toExtra) }));
}

const extraUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(500).optional(),
  priceFils: z.coerce.number().int().min(0).optional(),
  maxTotalFils: z.coerce.number().int().positive().nullable().optional(),
  maxQuantity: z.coerce.number().int().min(1).max(10).optional(),
  isActive: z.boolean().optional(),
});

export async function adminUpdateExtra(adminId: string, extraId: string, input: z.input<typeof extraUpdateSchema>) {
  return admin(adminId, "adminUpdateExtra", async () => {
    const d = extraUpdateSchema.parse(input);
    const [row] = await getDb()
      .update(extras)
      .set({ name: d.name, description: d.description, priceMinor: d.priceFils, maxTotalMinor: d.maxTotalFils, maxQuantity: d.maxQuantity, isActive: d.isActive })
      .where(eq(extras.id, uuid.parse(extraId)))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "Extra not found.");
    await audit(getDb(), adminId, "extra.updated", "extra", row.id, d);
    return { extra: toExtra(row) };
  });
}

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

const VEHICLE_STATUSES = ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

const vehicleSchema = z.object({
  branchId: uuid,
  categoryId: uuid,
  make: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(40),
  year: z.coerce.number().int().min(1990).max(2100),
  plateNumber: z.string().trim().min(2).max(30),
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must be 17 characters (no I, O or Q)"),
  color: z.string().trim().min(2).max(30),
  transmission: upper(["AUTOMATIC", "MANUAL"]),
  fuelType: upper(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]),
  seats: z.coerce.number().int().min(1).max(60),
  doors: z.coerce.number().int().min(0).max(10),
  bags: z.coerce.number().int().min(0).max(30),
  dailyRateFils: z.coerce.number().int().positive().nullable().optional(),
  mileageKm: z.coerce.number().int().min(0).default(0),
  status: upper(VEHICLE_STATUSES).default("AVAILABLE"),
  imageUrl: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().max(1000).default(""),
  featureIds: z.array(uuid).max(50).optional(),
});
export type VehicleInput = z.input<typeof vehicleSchema>;

function vehicleValues(d: z.output<typeof vehicleSchema>) {
  return {
    branchId: d.branchId,
    categoryId: d.categoryId,
    make: d.make,
    model: d.model,
    year: d.year,
    plateNumber: d.plateNumber,
    vin: d.vin,
    color: d.color,
    transmission: d.transmission,
    fuelType: d.fuelType,
    seats: d.seats,
    doors: d.doors,
    luggage: d.bags,
    dailyRateMinor: d.dailyRateFils ?? null,
    mileageKm: d.mileageKm,
    status: d.status,
    imageUrl: d.imageUrl || null,
    description: d.description,
  };
}

export interface AdminVehicle {
  id: string;
  branchId: string;
  branchName: string;
  categoryId: string;
  categoryName: string;
  make: string;
  model: string;
  year: number;
  plateNumber: string;
  vin: string;
  color: string;
  transmission: string;
  fuelType: string;
  seats: number;
  doors: number;
  bags: number;
  dailyRateFils: number | null;
  effectiveDailyRateFils: number;
  mileageKm: number;
  status: VehicleStatus;
  imageUrl: string | null;
  description: string;
  featureIds: string[];
  features: string[];
}

async function loadAdminVehicles(where?: SQL): Promise<AdminVehicle[]> {
  const db = getDb();
  const rows = await db
    .select({ v: vehicles, c: vehicleCategories, b: branches })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(where)
    .orderBy(asc(branches.name), asc(vehicles.make), asc(vehicles.model));
  const feats = rows.length
    ? await db
        .select({ vehicleId: vehicleFeatureMap.vehicleId, id: vehicleFeatures.id, name: vehicleFeatures.name })
        .from(vehicleFeatureMap)
        .innerJoin(vehicleFeatures, eq(vehicleFeatures.id, vehicleFeatureMap.featureId))
        .where(inArray(vehicleFeatureMap.vehicleId, rows.map((r) => r.v.id)))
    : [];
  return rows.map(({ v, c, b }) => {
    const f = feats.filter((x) => x.vehicleId === v.id);
    return {
      id: v.id,
      branchId: b.id,
      branchName: b.name,
      categoryId: c.id,
      categoryName: c.name,
      make: v.make,
      model: v.model,
      year: v.year,
      plateNumber: v.plateNumber,
      vin: v.vin,
      color: v.color,
      transmission: v.transmission.toLowerCase(),
      fuelType: v.fuelType.toLowerCase(),
      seats: v.seats,
      doors: v.doors,
      bags: v.luggage,
      dailyRateFils: v.dailyRateMinor,
      effectiveDailyRateFils: toVehicleSummary(v, c, []).dailyRateFromFils,
      mileageKm: v.mileageKm,
      status: v.status,
      imageUrl: v.imageUrl,
      description: v.description,
      featureIds: f.map((x) => x.id),
      features: f.map((x) => x.name),
    };
  });
}

export async function adminListVehicles(adminId: string, filters: { branchId?: string; status?: VehicleStatus; categoryId?: string; q?: string } = {}) {
  return admin(adminId, "adminListVehicles", async () => {
    const conds: SQL[] = [];
    if (filters.branchId) conds.push(eq(vehicles.branchId, uuid.parse(filters.branchId)));
    if (filters.categoryId) conds.push(eq(vehicles.categoryId, uuid.parse(filters.categoryId)));
    if (filters.status) conds.push(eq(vehicles.status, filters.status));
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      conds.push(or(ilike(vehicles.plateNumber, q), ilike(vehicles.make, q), ilike(vehicles.model, q), ilike(vehicles.vin, q))!);
    }
    return { vehicles: await loadAdminVehicles(conds.length ? and(...conds) : undefined) };
  });
}

export async function adminGetVehicle(adminId: string, vehicleId: string) {
  return admin(adminId, "adminGetVehicle", async () => {
    const [v] = await loadAdminVehicles(eq(vehicles.id, uuid.parse(vehicleId)));
    if (!v) throw new AppError("NOT_FOUND", "Vehicle not found.");
    return { vehicle: v };
  });
}

async function setFeatures(tx: Tx, vehicleId: string, featureIds: string[]) {
  await tx.delete(vehicleFeatureMap).where(eq(vehicleFeatureMap.vehicleId, vehicleId));
  if (featureIds.length) await tx.insert(vehicleFeatureMap).values([...new Set(featureIds)].map((featureId) => ({ vehicleId, featureId })));
}

export async function adminCreateVehicle(adminId: string, input: VehicleInput) {
  return admin(adminId, "adminCreateVehicle", async () => {
    const d = vehicleSchema.parse(input);
    const id = await getDb().transaction(async (tx) => {
      const [row] = await tx.insert(vehicles).values(vehicleValues(d)).returning({ id: vehicles.id });
      if (d.featureIds) await setFeatures(tx, row.id, d.featureIds);
      await audit(tx, adminId, "vehicle.created", "vehicle", row.id, { plateNumber: d.plateNumber });
      return row.id;
    });
    const [vehicle] = await loadAdminVehicles(eq(vehicles.id, id));
    return { vehicle };
  });
}

export async function adminUpdateVehicle(adminId: string, vehicleId: string, input: Partial<VehicleInput>) {
  return admin(adminId, "adminUpdateVehicle", async () => {
    const [cur] = await loadAdminVehicles(eq(vehicles.id, uuid.parse(vehicleId)));
    if (!cur) throw new AppError("NOT_FOUND", "Vehicle not found.");
    const d = vehicleSchema.parse({ ...cur, ...input });
    await getDb().transaction(async (tx) => {
      await tx.update(vehicles).set(vehicleValues(d)).where(eq(vehicles.id, cur.id));
      if (input.featureIds) await setFeatures(tx, cur.id, d.featureIds ?? []);
      await audit(tx, adminId, "vehicle.updated", "vehicle", cur.id, { changes: input });
    });
    const [vehicle] = await loadAdminVehicles(eq(vehicles.id, cur.id));
    return { vehicle };
  });
}

export async function adminSetVehicleStatus(adminId: string, vehicleId: string, status: VehicleStatus) {
  return admin(adminId, "adminSetVehicleStatus", async () => {
    const s = upper(VEHICLE_STATUSES).parse(status);
    const db = getDb();
    if (s === "RETIRED") {
      const [future] = await db
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.vehicleId, vehicleId), inArray(reservations.status, ["CONFIRMED", "PICKED_UP"]), gte(reservations.returnAt, new Date())))
        .limit(1);
      if (future) throw new AppError("CONFLICT", "This vehicle has upcoming or active bookings; reassign or cancel them first.");
    }
    const [row] = await db.update(vehicles).set({ status: s }).where(eq(vehicles.id, uuid.parse(vehicleId))).returning({ id: vehicles.id, prev: vehicles.status });
    if (!row) throw new AppError("NOT_FOUND", "Vehicle not found.");
    await audit(db, adminId, "vehicle.status_changed", "vehicle", row.id, { status: s });
    return { vehicleId: row.id, status: s };
  });
}

// ---------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------

const pricingRuleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  kind: upper(["SEASONAL", "WEEKEND", "DURATION_DISCOUNT", "ONE_WAY_FEE"]),
  categoryId: uuid.nullable().optional(),
  branchId: uuid.nullable().optional(),
  fromBranchId: uuid.nullable().optional(),
  toBranchId: uuid.nullable().optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  minDays: z.coerce.number().int().min(1).nullable().optional(),
  adjustmentBps: z.coerce.number().int().min(-9000).max(50000).nullable().optional(),
  amountFils: z.coerce.number().int().min(0).nullable().optional(),
  priority: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type PricingRuleInput = z.input<typeof pricingRuleSchema>;

function ruleValues(d: z.output<typeof pricingRuleSchema>) {
  return {
    name: d.name,
    kind: d.kind,
    categoryId: d.categoryId ?? null,
    branchId: d.branchId ?? null,
    fromBranchId: d.fromBranchId ?? null,
    toBranchId: d.toBranchId ?? null,
    validFrom: d.validFrom ?? null,
    validTo: d.validTo ?? null,
    minDays: d.minDays ?? null,
    adjustmentBps: d.adjustmentBps ?? null,
    amountMinor: d.amountFils ?? null,
    priority: d.priority,
    isActive: d.isActive,
  };
}

function ruleDto(r: typeof pricingRules.$inferSelect) {
  const { amountMinor, ...rest } = r;
  return { ...rest, amountFils: amountMinor };
}

export async function adminListPricingRules(adminId: string) {
  return admin(adminId, "adminListPricingRules", async () => ({
    rules: (await getDb().select().from(pricingRules).orderBy(asc(pricingRules.kind), desc(pricingRules.priority), asc(pricingRules.name))).map(ruleDto),
  }));
}

export async function adminCreatePricingRule(adminId: string, input: PricingRuleInput) {
  return admin(adminId, "adminCreatePricingRule", async () => {
    const d = pricingRuleSchema.parse(input);
    const [row] = await getDb().insert(pricingRules).values(ruleValues(d)).returning();
    await audit(getDb(), adminId, "pricing_rule.created", "pricing_rule", row.id, { name: row.name, kind: row.kind });
    return { rule: ruleDto(row) };
  });
}

export async function adminUpdatePricingRule(adminId: string, ruleId: string, input: Partial<PricingRuleInput>) {
  return admin(adminId, "adminUpdatePricingRule", async () => {
    const db = getDb();
    const [cur] = await db.select().from(pricingRules).where(eq(pricingRules.id, uuid.parse(ruleId)));
    if (!cur) throw new AppError("NOT_FOUND", "Pricing rule not found.");
    const d = pricingRuleSchema.parse({ ...ruleDto(cur), ...input });
    const [row] = await db.update(pricingRules).set(ruleValues(d)).where(eq(pricingRules.id, cur.id)).returning();
    await audit(db, adminId, "pricing_rule.updated", "pricing_rule", row.id, { changes: input });
    return { rule: ruleDto(row) };
  });
}

export async function adminDeletePricingRule(adminId: string, ruleId: string) {
  return admin(adminId, "adminDeletePricingRule", async () => {
    const [row] = await getDb().delete(pricingRules).where(eq(pricingRules.id, uuid.parse(ruleId))).returning();
    if (!row) throw new AppError("NOT_FOUND", "Pricing rule not found.");
    await audit(getDb(), adminId, "pricing_rule.deleted", "pricing_rule", row.id, { name: row.name, kind: row.kind });
    return { ruleId: row.id };
  });
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export async function adminListReservations(
  adminId: string,
  filters: { status?: ReservationStatus | ReservationStatus[]; branchId?: string; q?: string; from?: Date | string; to?: Date | string; limit?: number } = {},
) {
  return admin(adminId, "adminListReservations", async () => ({
    reservations: await queryReservations({
      ...filters,
      from: filters.from ? new Date(filters.from) : undefined,
      to: filters.to ? new Date(filters.to) : undefined,
    }),
  }));
}

export async function adminGetReservation(adminId: string, idOrReference: string) {
  return admin(adminId, "adminGetReservation", async () => {
    const reservation = await getReservationDetail(idOrReference, null);
    if (!reservation) throw new AppError("NOT_FOUND", "Reservation not found.");
    return { reservation };
  });
}

export async function adminCancelReservation(adminId: string, reservationId: string, opts: { reason?: string; waiveFee?: boolean } = {}) {
  return admin(adminId, "adminCancelReservation", () => cancelReservationTx(adminId, reservationId, { asAdmin: true, reason: opts.reason ?? "Cancelled by staff", waiveFee: opts.waiveFee }));
}

export async function adminModifyReservationDates(adminId: string, reservationId: string, input: DateChangeInput) {
  return admin(adminId, "adminModifyReservationDates", () => modifyReservationDatesTx(adminId, reservationId, input, { asAdmin: true }));
}

// ---------------------------------------------------------------------------
// Check-out / check-in (rental agreements)
// ---------------------------------------------------------------------------

/** Check-out allowed from this many hours before the scheduled pick-up. */
export const CHECKOUT_EARLY_HOURS = 24;

/** Accept `mileage` (app contract) as an alias of `mileageKm`. */
const withMileageAlias = (v: unknown) =>
  v && typeof v === "object" && "mileage" in v && !("mileageKm" in v) ? { ...v, mileageKm: (v as { mileage: unknown }).mileage } : v;

const checkOutSchema = z.object({
  mileageKm: z.coerce.number().int().min(0).max(2_000_000),
  fuelLevel: z.coerce.number().int().min(0).max(8),
  notes: z.string().trim().max(2000).optional(),
});

export async function adminCheckOut(adminId: string, reservationId: string, input: z.input<typeof checkOutSchema> | (Omit<z.input<typeof checkOutSchema>, "mileageKm"> & { mileage: number })) {
  return admin(adminId, "adminCheckOut", async () => {
    const d = checkOutSchema.parse(withMileageAlias(input));
    const db = getDb();
    const agreementId = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(reservations).where(eq(reservations.id, uuid.parse(reservationId))).for("update");
      if (!r) throw new AppError("NOT_FOUND", "Reservation not found.");
      if (r.status !== "CONFIRMED") throw new AppError("INVALID_STATE", `Only confirmed bookings can be checked out (this one is ${r.status.toLowerCase()}).`);
      if (r.pickupAt.getTime() - Date.now() > CHECKOUT_EARLY_HOURS * 3_600_000) {
        throw new AppError("INVALID_STATE", `Check-out opens ${CHECKOUT_EARLY_HOURS} hours before pick-up.`);
      }
      const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, r.vehicleId)).for("update");
      if (v.status === "ON_RENT") throw new AppError("INVALID_STATE", "This vehicle is still on another rental.");
      if (v.status === "RETIRED") throw new AppError("INVALID_STATE", "This vehicle is retired.");
      if (d.mileageKm < v.mileageKm) throw new AppError("INVALID", `Mileage can't be below the last recorded ${v.mileageKm} km.`, { fieldErrors: { mileageKm: "Below last recorded mileage" } });
      const [a] = await tx
        .insert(rentalAgreements)
        .values({
          reservationId: r.id,
          vehicleId: v.id,
          checkedOutAt: new Date(),
          checkedOutBy: adminId,
          pickupMileageKm: d.mileageKm,
          pickupFuelLevel: d.fuelLevel,
          pickupNotes: d.notes ?? null,
        })
        .returning({ id: rentalAgreements.id });
      await tx.update(reservations).set({ status: "PICKED_UP" }).where(eq(reservations.id, r.id));
      await tx.update(vehicles).set({ status: "ON_RENT", mileageKm: d.mileageKm }).where(eq(vehicles.id, v.id));
      await audit(tx, adminId, "rental.checked_out", "reservation", r.id, { agreementId: a.id, mileageKm: d.mileageKm, fuelLevel: d.fuelLevel });
      return a.id;
    });
    log.info("checked out", { reservationId, agreementId });
    return { agreementId, status: "PICKED_UP" as const };
  });
}

const checkInSchema = z.object({
  mileageKm: z.coerce.number().int().min(0).max(2_000_000),
  fuelLevel: z.coerce.number().int().min(0).max(8),
  notes: z.string().trim().max(2000).optional(),
  /** Defaults to now. */
  returnedAt: z.coerce.date().optional(),
  /** Defaults to the booked return branch. */
  returnBranchId: uuid.optional(),
  /** Keep the deposit held (e.g. damage assessment pending); otherwise it is released. */
  holdDeposit: z.boolean().default(false),
  /** Send the vehicle to MAINTENANCE instead of AVAILABLE. */
  needsMaintenance: z.boolean().default(false),
});

export async function adminCheckIn(adminId: string, reservationId: string, input: z.input<typeof checkInSchema> | (Omit<z.input<typeof checkInSchema>, "mileageKm"> & { mileage: number })) {
  return admin(adminId, "adminCheckIn", async () => {
    const d = checkInSchema.parse(withMileageAlias(input));
    const db = getDb();
    const returnedAt = d.returnedAt ?? new Date();
    const computed = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(reservations).where(eq(reservations.id, uuid.parse(reservationId))).for("update");
      if (!r) throw new AppError("NOT_FOUND", "Reservation not found.");
      if (r.status !== "PICKED_UP") throw new AppError("INVALID_STATE", "Only picked-up rentals can be checked in.");
      const [a] = await tx.select().from(rentalAgreements).where(eq(rentalAgreements.reservationId, r.id)).for("update");
      if (!a) throw new AppError("INVALID_STATE", "No rental agreement found for this booking.");
      if (d.mileageKm < a.pickupMileageKm) {
        throw new AppError("INVALID", `Return mileage can't be below the pick-up mileage (${a.pickupMileageKm} km).`, { fieldErrors: { mileageKm: "Below pick-up mileage" } });
      }
      if (returnedAt < a.checkedOutAt) throw new AppError("INVALID", "Return time is before check-out.");
      const [cat] = await tx
        .select({ lateFee: vehicleCategories.lateFeePerHourMinor })
        .from(vehicles)
        .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
        .where(eq(vehicles.id, r.vehicleId));
      const late = calculateLateFee({ scheduledReturnAt: r.returnAt, actualReturnAt: returnedAt, dailyRateMinor: r.dailyRateMinor, lateFeePerHourMinor: cat.lateFee });
      const fuel = calculateFuelCharge(a.pickupFuelLevel, d.fuelLevel);
      const returnBranchId = d.returnBranchId ?? r.returnBranchId;

      await tx
        .update(rentalAgreements)
        .set({
          checkedInAt: returnedAt,
          checkedInBy: adminId,
          returnBranchId,
          returnMileageKm: d.mileageKm,
          returnFuelLevel: d.fuelLevel,
          returnNotes: d.notes ?? null,
          lateMinutes: late.lateMinutes,
          lateFeeMinor: late.totalFils,
          fuelChargeMinor: fuel.totalFils,
        })
        .where(eq(rentalAgreements.id, a.id));
      await tx.update(reservations).set({ status: "RETURNED", lateFeeMinor: late.totalFils }).where(eq(reservations.id, r.id));
      await tx
        .update(vehicles)
        .set({ status: d.needsMaintenance ? "MAINTENANCE" : "AVAILABLE", mileageKm: d.mileageKm, branchId: returnBranchId })
        .where(eq(vehicles.id, r.vehicleId));
      await audit(tx, adminId, "rental.checked_in", "reservation", r.id, {
        agreementId: a.id,
        mileageKm: d.mileageKm,
        fuelLevel: d.fuelLevel,
        lateMinutes: late.lateMinutes,
        lateFeeFils: late.totalFils,
        fuelChargeFils: fuel.totalFils,
        drivenKm: d.mileageKm - a.pickupMileageKm,
      });
      return { late, fuel };
    });

    // Extra charges after the state change commits (idempotent keys per reservation).
    const charges: { kind: string; amountFils: number; status: string }[] = [];
    for (const [kind, amount] of [
      ["LATE_RETURN", computed.late.totalFils],
      ["FUEL", computed.fuel.totalFils],
    ] as const) {
      if (amount <= 0) continue;
      try {
        const p = await chargeAdditional({ reservationId, kind, amountFils: amount, idempotencyKey: `checkin:${reservationId}:${kind}`, actorUserId: adminId });
        charges.push({ kind, amountFils: amount, status: p.status });
      } catch (err) {
        log.error("check-in charge failed", { err, reservationId, kind });
        charges.push({ kind, amountFils: amount, status: "FAILED" });
      }
    }
    let depositReleased = false;
    if (!d.holdDeposit) depositReleased = await releaseDeposit(reservationId, adminId);
    return {
      status: "RETURNED" as const,
      lateMinutes: computed.late.lateMinutes,
      lateFeeFils: computed.late.totalFils,
      fuelChargeFils: computed.fuel.totalFils,
      charges,
      depositReleased,
    };
  });
}

// ---------------------------------------------------------------------------
// Damage reports
// ---------------------------------------------------------------------------

const damageSchema = z.object({
  vehicleId: uuid,
  reservationId: uuid.nullable().optional(),
  stage: upper(["PICKUP", "RETURN", "OTHER"]).default("RETURN"),
  severity: upper(["MINOR", "MODERATE", "MAJOR"]),
  description: z.string().trim().min(3).max(4000),
  estimatedCostFils: z.coerce.number().int().min(0).default(0),
});

export type DamageReportInput = z.input<typeof damageSchema> & { images?: { bytes: Uint8Array; contentType?: string; filename?: string }[] };

export const MAX_DAMAGE_IMAGES = 8;

function damageDto(r: typeof damageReports.$inferSelect & { plateNumber?: string; reference?: string | null }) {
  return {
    id: r.id,
    vehicleId: r.vehicleId,
    reservationId: r.reservationId,
    rentalAgreementId: r.rentalAgreementId,
    stage: r.stage,
    severity: r.severity,
    description: r.description,
    estimatedCostFils: r.estimatedCostMinor,
    chargedFils: r.chargedMinor,
    imageUrls: r.imageKeys.map((_, i) => damageImageUrl(r.id, i)),
    plateNumber: r.plateNumber,
    reservationReference: r.reference ?? null,
    createdAt: r.createdAt,
  };
}

export async function adminCreateDamageReport(adminId: string, input: DamageReportInput) {
  return admin(adminId, "adminCreateDamageReport", async () => {
    const d = damageSchema.parse(input);
    const images = input.images ?? [];
    if (images.length > MAX_DAMAGE_IMAGES) throw new AppError("INVALID", `At most ${MAX_DAMAGE_IMAGES} images per report.`);
    const checked = images.map((img) => ({ bytes: img.bytes, ...assertUpload(img.bytes, { allowPdf: false, maxBytes: MAX_DAMAGE_IMAGE_BYTES }) }));
    const db = getDb();

    let agreementId: string | null = null;
    if (d.reservationId) {
      const [r] = await db.select({ vehicleId: reservations.vehicleId }).from(reservations).where(eq(reservations.id, d.reservationId));
      if (!r) throw new AppError("NOT_FOUND", "Reservation not found.");
      if (r.vehicleId !== d.vehicleId) throw new AppError("INVALID", "That reservation is for a different vehicle.");
      const [a] = await db.select({ id: rentalAgreements.id }).from(rentalAgreements).where(eq(rentalAgreements.reservationId, d.reservationId));
      agreementId = a?.id ?? null;
    }
    const [report] = await db
      .insert(damageReports)
      .values({
        vehicleId: d.vehicleId,
        reservationId: d.reservationId ?? null,
        rentalAgreementId: agreementId,
        reportedBy: adminId,
        stage: d.stage,
        severity: d.severity,
        description: d.description,
        estimatedCostMinor: d.estimatedCostFils,
      })
      .returning();
    const storage = getStorage();
    const keys: string[] = [];
    try {
      for (const img of checked) {
        const key = `damage/${report.id}/${randomUUID()}.${img.ext}`;
        await storage.put(key, img.bytes, img.contentType);
        keys.push(key);
      }
    } catch (err) {
      await Promise.all(keys.map((k) => storage.delete(k).catch(() => undefined)));
      await db.delete(damageReports).where(eq(damageReports.id, report.id));
      throw err;
    }
    const [row] = keys.length ? await db.update(damageReports).set({ imageKeys: keys }).where(eq(damageReports.id, report.id)).returning() : [report];
    await audit(db, adminId, "damage_report.created", "damage_report", row.id, {
      vehicleId: d.vehicleId,
      reservationId: d.reservationId ?? null,
      severity: d.severity,
      images: keys.length,
    });
    return { report: damageDto(row) };
  });
}

/** Append ONE image (<= 4 MB, JPG/PNG) to an existing report; keeps request bodies small. */
export async function adminAddDamageImage(adminId: string, reportId: string, image: { bytes: Uint8Array; contentType?: string; filename?: string }) {
  return admin(adminId, "adminAddDamageImage", async () => {
    const img = assertUpload(image.bytes, { allowPdf: false, maxBytes: MAX_DAMAGE_IMAGE_BYTES });
    const db = getDb();
    const id = uuid.parse(reportId);
    const key = `damage/${id}/${randomUUID()}.${img.ext}`;
    const [cur] = await db.select({ keys: damageReports.imageKeys }).from(damageReports).where(eq(damageReports.id, id));
    if (!cur) throw new AppError("NOT_FOUND", "Damage report not found.");
    if (cur.keys.length >= MAX_DAMAGE_IMAGES) throw new AppError("INVALID", `At most ${MAX_DAMAGE_IMAGES} images per report.`);
    await getStorage().put(key, image.bytes, img.contentType);
    const row = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(damageReports).where(eq(damageReports.id, id)).for("update");
      if (locked.imageKeys.length >= MAX_DAMAGE_IMAGES) throw new AppError("INVALID", `At most ${MAX_DAMAGE_IMAGES} images per report.`);
      const [updated] = await tx.update(damageReports).set({ imageKeys: [...locked.imageKeys, key] }).where(eq(damageReports.id, id)).returning();
      await audit(tx, adminId, "damage_report.image_added", "damage_report", id, { images: updated.imageKeys.length });
      return updated;
    }).catch(async (err) => {
      await getStorage().delete(key).catch(() => undefined);
      throw err;
    });
    return { report: damageDto(row) };
  });
}

export async function adminListDamageReports(adminId: string, filters: { vehicleId?: string; reservationId?: string } = {}) {
  return admin(adminId, "adminListDamageReports", async () => {
    const conds: SQL[] = [];
    if (filters.vehicleId) conds.push(eq(damageReports.vehicleId, uuid.parse(filters.vehicleId)));
    if (filters.reservationId) conds.push(eq(damageReports.reservationId, uuid.parse(filters.reservationId)));
    const rows = await getDb()
      .select({ d: damageReports, plateNumber: vehicles.plateNumber, reference: reservations.reference })
      .from(damageReports)
      .innerJoin(vehicles, eq(vehicles.id, damageReports.vehicleId))
      .leftJoin(reservations, eq(reservations.id, damageReports.reservationId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(damageReports.createdAt))
      .limit(500);
    return { reports: rows.map((r) => damageDto({ ...r.d, plateNumber: r.plateNumber, reference: r.reference })) };
  });
}

/** Capture part of the reservation's held deposit for a damage report (rest released by provider). */
export async function adminChargeDamage(adminId: string, reportId: string, amountFils: number) {
  return admin(adminId, "adminChargeDamage", async () => {
    const amount = z.coerce.number().int().positive().parse(amountFils);
    const db = getDb();
    const [rep] = await db.select().from(damageReports).where(eq(damageReports.id, uuid.parse(reportId)));
    if (!rep) throw new AppError("NOT_FOUND", "Damage report not found.");
    if (!rep.reservationId) throw new AppError("INVALID_STATE", "This report is not linked to a booking, so there is no deposit to charge.");
    const captured = await captureDeposit(rep.reservationId, amount, adminId);
    await db.update(damageReports).set({ chargedMinor: rep.chargedMinor + captured }).where(eq(damageReports.id, rep.id));
    await audit(db, adminId, "damage_report.charged", "damage_report", rep.id, { capturedFils: captured });
    return { capturedFils: captured };
  });
}

// ---------------------------------------------------------------------------
// Maintenance blocks
// ---------------------------------------------------------------------------

const maintenanceSchema = z
  .object({
    vehicleId: uuid,
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => v.endAt > v.startAt, { path: ["endAt"], message: "End must be after start" });

export async function adminListMaintenanceBlocks(adminId: string, filters: { vehicleId?: string; includePast?: boolean; includeCancelled?: boolean } = {}) {
  return admin(adminId, "adminListMaintenanceBlocks", async () => {
    const conds: SQL[] = [];
    if (filters.vehicleId) conds.push(eq(maintenanceBlocks.vehicleId, uuid.parse(filters.vehicleId)));
    if (!filters.includePast) conds.push(gte(maintenanceBlocks.endsAt, new Date()));
    if (!filters.includeCancelled) conds.push(ne(maintenanceBlocks.status, "CANCELLED"));
    const rows = await getDb()
      .select({ m: maintenanceBlocks, plateNumber: vehicles.plateNumber, make: vehicles.make, model: vehicles.model, branchName: branches.name, timezone: branches.timezone })
      .from(maintenanceBlocks)
      .innerJoin(vehicles, eq(vehicles.id, maintenanceBlocks.vehicleId))
      .innerJoin(branches, eq(branches.id, vehicles.branchId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(maintenanceBlocks.startsAt));
    return {
      blocks: rows.map((r) => ({
        id: r.m.id,
        vehicleId: r.m.vehicleId,
        vehicle: `${r.make} ${r.model} (${r.plateNumber})`,
        plateNumber: r.plateNumber,
        branchName: r.branchName,
        timezone: r.timezone,
        startAt: r.m.startsAt,
        endAt: r.m.endsAt,
        reason: r.m.reason,
        status: r.m.status,
        createdAt: r.m.createdAt,
      })),
    };
  });
}

export async function adminCreateMaintenanceBlock(adminId: string, input: z.input<typeof maintenanceSchema>) {
  return admin(adminId, "adminCreateMaintenanceBlock", async () => {
    const d = maintenanceSchema.parse(input);
    const id = await getDb().transaction(async (tx) => {
      const [v] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, d.vehicleId)).for("update");
      if (!v) throw new AppError("NOT_FOUND", "Vehicle not found.");
      // Expired holds shouldn't block maintenance.
      await tx
        .update(reservations)
        .set({ status: "EXPIRED" })
        .where(and(eq(reservations.vehicleId, v.id), eq(reservations.status, "PENDING"), sql`${reservations.holdExpiresAt} <= now()`));
      const clash = await tx
        .select({ reservationId: vehicleOccupancy.reservationId })
        .from(vehicleOccupancy)
        .where(and(eq(vehicleOccupancy.vehicleId, v.id), sql`${vehicleOccupancy.period} && tstzrange(${d.startAt.toISOString()}::timestamptz, ${d.endAt.toISOString()}::timestamptz, '[)')`))
        .limit(1);
      if (clash.length) {
        throw new AppError(
          "CONFLICT",
          clash[0].reservationId ? "That period overlaps a customer booking. Move or cancel the booking first." : "That period overlaps another maintenance block.",
        );
      }
      const [m] = await tx
        .insert(maintenanceBlocks)
        .values({ vehicleId: v.id, startsAt: d.startAt, endsAt: d.endAt, reason: d.reason, createdBy: adminId })
        .returning({ id: maintenanceBlocks.id });
      await audit(tx, adminId, "maintenance.created", "maintenance_block", m.id, { vehicleId: v.id, startAt: d.startAt, endAt: d.endAt, reason: d.reason });
      return m.id;
    });
    return { blockId: id };
  });
}

export async function adminSetMaintenanceStatus(adminId: string, blockId: string, status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED") {
  return admin(adminId, "adminSetMaintenanceStatus", async () => {
    const s = upper(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).parse(status);
    const db = getDb();
    const [row] = await db.update(maintenanceBlocks).set({ status: s }).where(eq(maintenanceBlocks.id, uuid.parse(blockId))).returning();
    if (!row) throw new AppError("NOT_FOUND", "Maintenance block not found.");
    // Keep the vehicle's operational status in step.
    if (s === "IN_PROGRESS") await db.update(vehicles).set({ status: "MAINTENANCE" }).where(and(eq(vehicles.id, row.vehicleId), ne(vehicles.status, "RETIRED")));
    if (s === "COMPLETED") await db.update(vehicles).set({ status: "AVAILABLE" }).where(and(eq(vehicles.id, row.vehicleId), eq(vehicles.status, "MAINTENANCE")));
    await audit(db, adminId, "maintenance.status_changed", "maintenance_block", row.id, { status: s });
    return { blockId: row.id, status: s };
  });
}

/** Cancels the block (kept for history; frees the period). */
export async function adminDeleteMaintenanceBlock(adminId: string, blockId: string) {
  return adminSetMaintenanceStatus(adminId, blockId, "CANCELLED");
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function adminListAuditLogs(adminId: string, filters: { entityType?: string; entityId?: string; limit?: number } = {}) {
  return admin(adminId, "adminListAuditLogs", async () => {
    const conds: SQL[] = [];
    if (filters.entityType) conds.push(eq(auditLogs.entityType, filters.entityType));
    if (filters.entityId) conds.push(eq(auditLogs.entityId, uuid.parse(filters.entityId)));
    const rows = await getDb()
      .select({ log: auditLogs, actorName: users.name, actorEmail: users.email })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(Math.min(filters.limit ?? 100, 500));
    return { logs: rows.map((r) => ({ ...r.log, actorName: r.actorName, actorEmail: r.actorEmail })) };
  });
}

