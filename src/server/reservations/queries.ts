import { and, desc, eq, gte, ilike, inArray, lte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { toBranch, toVehicleSummary, type Branch, type VehicleSummary } from "@/server/catalog/dto";
import { getDb, type DbOrTx } from "@/server/db";
import {
  branches,
  damageReports,
  deposits,
  driverProfiles,
  payments,
  rentalAgreements,
  reservations,
  users,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
} from "@/server/db/schema";
import { netRentalPaid } from "@/server/payments/service";
import type { Quote } from "@/server/pricing/engine";
import { cancellationTerms, canModifyDates, type CancellationTerms } from "./policy";

export type ReservationStatus = (typeof reservations.$inferSelect)["status"];

export interface ReservationSummary {
  id: string;
  reference: string;
  status: ReservationStatus;
  vehicle: { id: string; make: string; model: string; year: number; imageUrl: string | null; categoryName: string };
  pickupBranch: { id: string; name: string; timezone: string };
  returnBranch: { id: string; name: string; timezone: string };
  pickupAt: Date;
  returnAt: Date;
  holdExpiresAt: Date | null;
  totalFils: number;
  depositFils: number;
  createdAt: Date;
}

export interface ReservationDetail extends Omit<ReservationSummary, "vehicle" | "pickupBranch" | "returnBranch"> {
  vehicle: VehicleSummary & { plateNumber: string; color: string };
  pickupBranch: Branch;
  returnBranch: Branch;
  quote: Quote;
  customer: { id: string; name: string; email: string };
  driver: { fullName: string; phone: string; licenceNumber: string; licenceCountry: string; licenceExpiry: string; hasLicenceFile: boolean } | null;
  payment: { status: string; amountFils: number; refundedFils: number; failureReason: string | null } | null;
  payments: { id: string; kind: string; status: string; amountFils: number; refundedFils: number; createdAt: Date }[];
  deposit: { status: string; amountFils: number; capturedFils: number } | null;
  paidFils: number;
  refundedFils: number;
  lateFeeFils: number;
  cancellationFeeFils: number;
  cancellation: CancellationTerms;
  canModify: boolean;
  modifyReason: string;
  modify: { allowed: boolean; reason: string };
  canPay: boolean;
  agreement: {
    checkedOutAt: Date;
    pickupMileageKm: number;
    pickupFuelLevel: number;
    checkedInAt: Date | null;
    returnMileageKm: number | null;
    returnFuelLevel: number | null;
    lateMinutes: number;
    lateFeeFils: number;
    fuelChargeFils: number;
  } | null;
  damageReportIds: string[];
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
}

const pickupB = alias(branches, "pickup_branch");
const returnB = alias(branches, "return_branch");

function summarySelect() {
  return {
    r: reservations,
    v: vehicles,
    c: vehicleCategories,
    pb: pickupB,
    rb: returnB,
  };
}

type SummaryRow = {
  r: typeof reservations.$inferSelect;
  v: typeof vehicles.$inferSelect;
  c: typeof vehicleCategories.$inferSelect;
  pb: typeof branches.$inferSelect;
  rb: typeof branches.$inferSelect;
};

function toSummary({ r, v, c, pb, rb }: SummaryRow): ReservationSummary {
  return {
    id: r.id,
    reference: r.reference,
    status: r.status,
    vehicle: { id: v.id, make: v.make, model: v.model, year: v.year, imageUrl: v.imageUrl, categoryName: c.name },
    pickupBranch: { id: pb.id, name: pb.name, timezone: pb.timezone },
    returnBranch: { id: rb.id, name: rb.name, timezone: rb.timezone },
    pickupAt: r.pickupAt,
    returnAt: r.returnAt,
    holdExpiresAt: r.status === "PENDING" ? r.holdExpiresAt : null,
    totalFils: r.totalMinor,
    depositFils: r.depositMinor,
    createdAt: r.createdAt,
  };
}

function baseQuery(db: DbOrTx) {
  return db
    .select(summarySelect())
    .from(reservations)
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .innerJoin(pickupB, eq(pickupB.id, reservations.pickupBranchId))
    .innerJoin(returnB, eq(returnB.id, reservations.returnBranchId));
}

export async function listReservationsForUser(userId: string): Promise<ReservationSummary[]> {
  const rows = await baseQuery(getDb()).where(eq(reservations.userId, userId)).orderBy(desc(reservations.pickupAt));
  return rows.map(toSummary);
}

const isUuid = (s: string) => z.string().uuid().safeParse(s).success;

/** Full detail; `userId` null = admin (no ownership check). Accepts id or reference. */
export async function getReservationDetail(idOrReference: string, userId: string | null): Promise<ReservationDetail | null> {
  const db = getDb();
  const cond = isUuid(idOrReference) ? eq(reservations.id, idOrReference) : eq(reservations.reference, idOrReference.trim().toUpperCase());
  const [row] = await baseQuery(db).where(userId ? and(cond, eq(reservations.userId, userId)) : cond);
  if (!row) return null;
  const { r, v, c, pb, rb } = row;

  const [customer] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, r.userId));
  const [driver] = r.driverProfileId ? await db.select().from(driverProfiles).where(eq(driverProfiles.id, r.driverProfileId)) : [];
  const pays = await db.select().from(payments).where(eq(payments.reservationId, r.id)).orderBy(desc(payments.createdAt));
  const deps = await db.select().from(deposits).where(eq(deposits.reservationId, r.id)).orderBy(desc(deposits.createdAt));
  const [agreement] = await db.select().from(rentalAgreements).where(eq(rentalAgreements.reservationId, r.id));
  const damage = await db.select({ id: damageReports.id }).from(damageReports).where(eq(damageReports.reservationId, r.id));
  const feats = await db
    .select({ name: vehicleFeatures.name })
    .from(vehicleFeatureMap)
    .innerJoin(vehicleFeatures, eq(vehicleFeatures.id, vehicleFeatureMap.featureId))
    .where(eq(vehicleFeatureMap.vehicleId, v.id));
  const paid = await netRentalPaid(db, r.id);
  const rental = pays.find((p) => p.kind === "RENTAL") ?? null;
  const deposit = deps.find((d) => d.status === "HELD") ?? deps.find((d) => d.status === "CAPTURED" || d.status === "RELEASED") ?? deps[0] ?? null;
  const modify = canModifyDates(r.status, r.pickupAt);

  return {
    ...toSummary(row),
    vehicle: { ...toVehicleSummary(v, c, feats.map((f) => f.name)), plateNumber: v.plateNumber, color: v.color },
    pickupBranch: toBranch(pb),
    returnBranch: toBranch(rb),
    quote: r.pricingBreakdown as Quote,
    customer,
    driver: driver
      ? {
          fullName: driver.fullName,
          phone: driver.phone,
          licenceNumber: driver.licenceNumber,
          licenceCountry: driver.licenceCountry,
          licenceExpiry: driver.licenceExpiry,
          hasLicenceFile: !!driver.licenceFileKey,
        }
      : null,
    payment: rental ? { status: rental.status, amountFils: rental.amountMinor, refundedFils: rental.refundedMinor, failureReason: rental.failureReason } : null,
    payments: pays.map((p) => ({ id: p.id, kind: p.kind, status: p.status, amountFils: p.amountMinor, refundedFils: p.refundedMinor, createdAt: p.createdAt })),
    deposit: deposit ? { status: deposit.status, amountFils: deposit.amountMinor, capturedFils: deposit.capturedMinor } : null,
    paidFils: paid,
    refundedFils: r.refundedMinor,
    lateFeeFils: r.lateFeeMinor,
    cancellationFeeFils: r.cancellationFeeMinor,
    cancellation: cancellationTerms({ status: r.status, pickupAt: r.pickupAt, paidFils: paid, dailyRateFils: r.dailyRateMinor }),
    canModify: modify.allowed,
    modifyReason: modify.reason,
    modify,
    canPay: r.status === "PENDING" && !!r.holdExpiresAt && r.holdExpiresAt.getTime() > Date.now(),
    agreement: agreement
      ? {
          checkedOutAt: agreement.checkedOutAt,
          pickupMileageKm: agreement.pickupMileageKm,
          pickupFuelLevel: agreement.pickupFuelLevel,
          checkedInAt: agreement.checkedInAt,
          returnMileageKm: agreement.returnMileageKm,
          returnFuelLevel: agreement.returnFuelLevel,
          lateMinutes: agreement.lateMinutes,
          lateFeeFils: agreement.lateFeeMinor,
          fuelChargeFils: agreement.fuelChargeMinor,
        }
      : null,
    damageReportIds: damage.map((d) => d.id),
    confirmedAt: r.confirmedAt,
    cancelledAt: r.cancelledAt,
    cancellationReason: r.cancellationReason,
  };
}

/** Customer view: only their own booking (null otherwise - don't reveal existence). */
export async function getReservationForUser(userId: string, idOrReference: string): Promise<ReservationDetail | null> {
  return getReservationDetail(idOrReference, userId);
}

/** Admin list with filters. */
export async function queryReservations(f: {
  status?: ReservationStatus | ReservationStatus[];
  branchId?: string;
  q?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<(ReservationSummary & { customerName: string; customerEmail: string; plateNumber: string })[]> {
  const db = getDb();
  const conds = [];
  if (f.status) conds.push(Array.isArray(f.status) ? inArray(reservations.status, f.status) : eq(reservations.status, f.status));
  if (f.branchId) conds.push(or(eq(reservations.pickupBranchId, f.branchId), eq(reservations.returnBranchId, f.branchId)));
  if (f.from) conds.push(gte(reservations.returnAt, f.from));
  if (f.to) conds.push(lte(reservations.pickupAt, f.to));
  if (f.q?.trim()) {
    const q = `%${f.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(reservations.reference, q), ilike(users.email, q), ilike(users.name, q), ilike(vehicles.plateNumber, q)));
  }
  const rows = await db
    .select({ ...summarySelect(), u: { name: users.name, email: users.email } })
    .from(reservations)
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .innerJoin(pickupB, eq(pickupB.id, reservations.pickupBranchId))
    .innerJoin(returnB, eq(returnB.id, reservations.returnBranchId))
    .innerJoin(users, eq(users.id, reservations.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(reservations.pickupAt))
    .limit(Math.min(f.limit ?? 200, 500));
  return rows.map((row) => ({ ...toSummary(row), customerName: row.u.name, customerEmail: row.u.email, plateNumber: row.v.plateNumber }));
}
