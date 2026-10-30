"use server";

import { z } from "zod";
import {
  adminCreateBranch,
  adminCreateMaintenanceBlock,
  adminCreatePricingRule,
  adminCreateVehicle,
  adminDeletePricingRule,
  adminSetBranchActive,
  adminSetMaintenanceStatus,
  adminSetVehicleStatus,
  adminUpdateBranch,
  adminUpdateCategory,
  adminUpdateExtra,
  adminUpdatePricingRule,
  adminUpdateVehicle,
} from "@/server/admin";
import { getVehicle } from "@/server/catalog";
import { zonedToUtc } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";
import { aedToFils, checkbox, intField, optionalAedToFils, optionalText, runAdminAction } from "./_lib";

const nullableText = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().nullable());
const nullableNumber = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.coerce.number().nullable());
const nullableUuid = z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable());
const nullableDate = z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

// ---------------- Branches ----------------

const branchFields = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, "2-12 letters, digits or dashes"),
  name: z.string().trim().min(2, "Enter a name").max(100),
  city: z.string().trim().min(2, "Enter a city").max(60),
  emirate: z.string().trim().min(2, "Enter an emirate").max(60),
  address: z.string().trim().min(5, "Enter the address").max(300),
  phone: z.string().trim().min(7, "Enter a phone number").max(30),
  email: z.preprocess((v) => (v === "" ? null : v), z.email().nullable()),
  timezone: z.string().trim().min(3).default("Asia/Dubai"),
  openingHours: z.string().trim().min(3, "Enter opening hours").max(200),
  latitude: nullableNumber,
  longitude: nullableNumber,
  locationFee: optionalAedToFils,
  isActive: checkbox,
});

function toBranchInput(d: z.output<typeof branchFields>) {
  const { locationFee, ...rest } = d;
  return { ...rest, locationFeeFils: locationFee ?? 0 };
}

export async function createBranchAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(fd, branchFields, (id, d) => adminCreateBranch(id, toBranchInput(d)), (r) => `Branch ${r.branch.name} created.`);
}

export async function updateBranchAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(
    fd,
    branchFields.extend({ branchId: z.uuid() }),
    (id, { branchId, ...d }) => adminUpdateBranch(id, branchId, toBranchInput(d)),
    "Branch saved.",
  );
}

export async function toggleBranchAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(
    fd,
    z.object({ branchId: z.uuid(), isActive: z.enum(["true", "false"]) }),
    (id, d) => adminSetBranchActive(id, d.branchId, d.isActive === "true"),
    (r) => (r.branch.isActive ? "Branch reopened." : "Branch closed for new bookings."),
  );
}

// ---------------- Fleet ----------------

const vehicleFields = z.object({
  branchId: z.uuid("Choose a branch"),
  categoryId: z.uuid("Choose a category"),
  make: z.string().trim().min(1, "Enter the make").max(40),
  model: z.string().trim().min(1, "Enter the model").max(40),
  year: intField(1990, 2100),
  plateNumber: z.string().trim().min(2, "Enter the plate number").max(30),
  vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, "17 characters, no I, O or Q"),
  color: z.string().trim().min(2, "Enter the colour").max(30),
  transmission: z.enum(["AUTOMATIC", "MANUAL"]),
  fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]),
  seats: intField(1, 60),
  doors: intField(0, 10),
  bags: intField(0, 30),
  dailyRate: optionalAedToFils,
  mileageKm: intField(0, 2_000_000),
  imageUrl: nullableText,
  description: optionalText,
});

function toVehicleInput(d: z.output<typeof vehicleFields>, fd: FormData) {
  const { dailyRate, ...rest } = d;
  const featureIds = fd.getAll("featureIds").filter((v): v is string => typeof v === "string" && z.uuid().safeParse(v).success);
  return { ...rest, description: rest.description ?? "", dailyRateFils: dailyRate ?? null, featureIds };
}

export async function createVehicleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(fd, vehicleFields, (id, d) => adminCreateVehicle(id, toVehicleInput(d, fd)), (r) => `Added ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.plateNumber}).`);
}

export async function updateVehicleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(
    fd,
    vehicleFields.extend({ vehicleId: z.uuid() }),
    (id, { vehicleId, ...d }) => adminUpdateVehicle(id, vehicleId, toVehicleInput(d, fd)),
    "Vehicle saved.",
  );
}

export async function setVehicleStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(
    fd,
    z.object({ vehicleId: z.uuid(), status: z.enum(["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]) }),
    (id, d) => adminSetVehicleStatus(id, d.vehicleId, d.status),
    (r) => `Status set to ${r.status.toLowerCase().replace("_", " ")}.`,
  );
}

// ---------------- Pricing ----------------

export async function updateCategoryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(
    fd,
    z.object({ categoryId: z.uuid(), dailyRate: aedToFils, deposit: aedToFils, lateFeePerHour: aedToFils }),
    (id, d) => adminUpdateCategory(id, d.categoryId, { dailyRateFils: d.dailyRate, depositFils: d.deposit, lateFeePerHourFils: d.lateFeePerHour }),
    (r) => `${r.category.name} rates saved.`,
  );
}

export async function updateExtraAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(
    fd,
    z.object({ extraId: z.uuid(), price: aedToFils, maxQuantity: intField(1, 10), isActive: checkbox }),
    (id, d) => adminUpdateExtra(id, d.extraId, { priceFils: d.price, maxQuantity: d.maxQuantity, isActive: d.isActive }),
    (r) => `${r.extra.name} saved.`,
  );
}

const ruleFields = z.object({
  name: z.string().trim().min(2, "Enter a name").max(100),
  kind: z.enum(["SEASONAL", "WEEKEND", "DURATION_DISCOUNT", "ONE_WAY_FEE"]),
  categoryId: nullableUuid,
  branchId: nullableUuid,
  fromBranchId: nullableUuid,
  toBranchId: nullableUuid,
  validFrom: nullableDate,
  validTo: nullableDate,
  minDays: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().min(1).nullable()),
  /** Percent in the form (e.g. 20 or -10); stored as basis points. */
  adjustmentPct: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().min(-90).max(500).nullable()),
  amount: z.preprocess((v) => (v === "" ? undefined : v), aedToFils.optional()),
  priority: z.coerce.number().int().default(0),
});

export async function createRuleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(
    fd,
    ruleFields,
    (id, { adjustmentPct, amount, ...d }) =>
      adminCreatePricingRule(id, {
        ...d,
        adjustmentBps: adjustmentPct === null ? null : Math.round(adjustmentPct * 100),
        amountFils: amount ?? null,
        isActive: true,
      }),
    (r) => `Rule "${r.rule.name}" created.`,
  );
}

export async function toggleRuleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(
    fd,
    z.object({ ruleId: z.uuid(), isActive: z.enum(["true", "false"]) }),
    (id, d) => adminUpdatePricingRule(id, d.ruleId, { isActive: d.isActive === "true" }),
    (r) => (r.rule.isActive ? "Rule enabled." : "Rule disabled."),
  );
}

export async function deleteRuleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(fd, z.object({ ruleId: z.uuid() }), (id, d) => adminDeletePricingRule(id, d.ruleId), "Rule deleted.");
}

// ---------------- Maintenance ----------------

const maintenanceFields = z.object({
  vehicleId: z.uuid("Choose a vehicle"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end date"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().trim().min(3, "Enter a reason").max(500),
});

export async function createMaintenanceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(
    fd,
    maintenanceFields,
    async (id, d) => {
      // Times are entered in the vehicle's branch time zone.
      const v = await getVehicle(d.vehicleId);
      const tz = v?.branch.timezone ?? "Asia/Dubai";
      const startAt = zonedToUtc(d.startDate, d.startTime, tz);
      const endAt = zonedToUtc(d.endDate, d.endTime, tz);
      if (!startAt || !endAt) return { ok: false as const, code: "INVALID" as const, message: "Enter valid dates and times." };
      return adminCreateMaintenanceBlock(id, { vehicleId: d.vehicleId, startAt, endAt, reason: d.reason });
    },
    "Maintenance block scheduled. The car is unavailable for bookings in that period.",
  );
}

export async function setMaintenanceStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(
    fd,
    z.object({ blockId: z.uuid(), status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) }),
    (id, d) => adminSetMaintenanceStatus(id, d.blockId, d.status),
    (r) => `Marked ${r.status.toLowerCase().replace("_", " ")}.`,
  );
}
