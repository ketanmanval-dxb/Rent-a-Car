import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { driverProfiles, users } from "./auth";
import {
  damageSeverity,
  damageStage,
  depositStatus,
  extraPricingType,
  maintenanceStatus,
  paymentKind,
  paymentStatus,
  reservationStatus,
} from "./enums";
import { branches, extras, vehicles } from "./fleet";
import { tstz, tstzrange } from "./types";

// ---------------------------------------------------------------------------
// No-overlap guarantee (reservations AND maintenance blocks)
// ---------------------------------------------------------------------------
// Every row that occupies a vehicle - a reservation in PENDING/CONFIRMED/PICKED_UP,
// or a maintenance block that is not CANCELLED - is mirrored into
// `vehicle_occupancy` by AFTER INSERT/UPDATE/DELETE triggers on both source
// tables (see the custom migration in drizzle/). vehicle_occupancy carries
//
//   EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)
//
// with half-open [start, end) ranges, so back-to-back periods are allowed but any
// overlap - reservation/reservation, reservation/maintenance or
// maintenance/maintenance - aborts the writing statement with SQLSTATE 23P01,
// no matter which code path wrote it. The
// reservation transaction additionally locks the vehicle row (SELECT ... FOR
// UPDATE) and checks occupancy first so it can return a friendly error, but the
// exclusion constraint is the real guarantee.
//
// PENDING holds expire by time. Exclusion constraints cannot depend on now(),
// so an expired hold keeps occupying until it is flipped to EXPIRED - by the
// cron job (/api/cron/release-expired-holds) or eagerly by the reservation
// transaction, which expires stale holds of the locked vehicle before checking.
// ---------------------------------------------------------------------------

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-friendly reference shown on vouchers, e.g. DE-7KQ3MX. */
    reference: text("reference").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    pickupBranchId: uuid("pickup_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    returnBranchId: uuid("return_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    driverProfileId: uuid("driver_profile_id").references(() => driverProfiles.id, { onDelete: "set null" }),
    pickupAt: tstz("pickup_at").notNull(),
    returnAt: tstz("return_at").notNull(),
    /** Generated half-open [pickup_at, return_at). */
    period: tstzrange("period")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(pickup_at, return_at, '[)')`),
    status: reservationStatus("status").notNull().default("PENDING"),
    /** PENDING hold expiry (HOLD_EXPIRY_MINUTES after creation). */
    holdExpiresAt: tstz("hold_expires_at"),
    /** Client-supplied key so a retried "reserve" request returns the same reservation. */
    idempotencyKey: text("idempotency_key").unique(),

    // Price snapshot computed on the server at booking/modification time (fils).
    currency: text("currency").notNull().default("AED"),
    rentalDays: integer("rental_days").notNull(),
    dailyRateMinor: integer("daily_rate_minor").notNull(),
    rentalMinor: integer("rental_minor").notNull(),
    discountMinor: integer("discount_minor").notNull().default(0),
    extrasMinor: integer("extras_minor").notNull().default(0),
    oneWayFeeMinor: integer("one_way_fee_minor").notNull().default(0),
    locationFeeMinor: integer("location_fee_minor").notNull().default(0),
    subtotalMinor: integer("subtotal_minor").notNull(),
    vatMinor: integer("vat_minor").notNull(),
    totalMinor: integer("total_minor").notNull(),
    depositMinor: integer("deposit_minor").notNull(),
    /** Charged at check-in for late return (incl. VAT). */
    lateFeeMinor: integer("late_fee_minor").notNull().default(0),
    cancellationFeeMinor: integer("cancellation_fee_minor").notNull().default(0),
    refundedMinor: integer("refunded_minor").notNull().default(0),
    pricingBreakdown: jsonb("pricing_breakdown").notNull(),

    confirmedAt: tstz("confirmed_at"),
    cancelledAt: tstz("cancelled_at"),
    cancellationReason: text("cancellation_reason"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("reservations_user_idx").on(t.userId, t.createdAt),
    index("reservations_vehicle_idx").on(t.vehicleId),
    index("reservations_status_hold_idx").on(t.status, t.holdExpiresAt),
    index("reservations_pickup_branch_idx").on(t.pickupBranchId, t.pickupAt),
    index("reservations_return_branch_idx").on(t.returnBranchId),
    index("reservations_driver_profile_idx").on(t.driverProfileId),
    index("reservations_period_gist").using("gist", t.vehicleId, t.period),
    check("reservations_period_valid", sql`${t.returnAt} > ${t.pickupAt}`),
    check("reservations_max_length", sql`${t.returnAt} - ${t.pickupAt} <= interval '90 days'`),
    check("reservations_hold_when_pending", sql`${t.status} <> 'PENDING' OR ${t.holdExpiresAt} IS NOT NULL`),
    check("reservations_currency", sql`${t.currency} = 'AED'`),
    check("reservations_days_pos", sql`${t.rentalDays} >= 1`),
    check(
      "reservations_money_nonneg",
      sql`${t.dailyRateMinor} >= 0 AND ${t.rentalMinor} >= 0 AND ${t.discountMinor} >= 0 AND ${t.extrasMinor} >= 0
        AND ${t.oneWayFeeMinor} >= 0 AND ${t.locationFeeMinor} >= 0 AND ${t.subtotalMinor} >= 0 AND ${t.vatMinor} >= 0
        AND ${t.depositMinor} >= 0 AND ${t.lateFeeMinor} >= 0 AND ${t.cancellationFeeMinor} >= 0 AND ${t.refundedMinor} >= 0`,
    ),
    check(
      "reservations_subtotal_sum",
      sql`${t.subtotalMinor} = ${t.rentalMinor} - ${t.discountMinor} + ${t.extrasMinor} + ${t.oneWayFeeMinor} + ${t.locationFeeMinor}`,
    ),
    check("reservations_total_sum", sql`${t.totalMinor} = ${t.subtotalMinor} + ${t.vatMinor}`),
    check("reservations_reference_format", sql`${t.reference} ~ '^DE-[A-Z0-9]{6,10}$'`),
  ],
);

export const reservationExtras = pgTable(
  "reservation_extras",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    extraId: uuid("extra_id")
      .notNull()
      .references(() => extras.id, { onDelete: "restrict" }),
    quantity: smallint("quantity").notNull().default(1),
    pricingType: extraPricingType("pricing_type").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    totalMinor: integer("total_minor").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reservation_extras_res_extra_uq").on(t.reservationId, t.extraId),
    check("reservation_extras_qty_pos", sql`${t.quantity} >= 1`),
    check("reservation_extras_money_nonneg", sql`${t.unitPriceMinor} >= 0 AND ${t.totalMinor} >= 0`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    kind: paymentKind("kind").notNull().default("RENTAL"),
    provider: text("provider").notNull(),
    /** Provider charge id; null until the provider answers. */
    providerPaymentId: text("provider_payment_id").unique(),
    /** Unique per attempt: a retried request with the same key never charges twice. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: paymentStatus("status").notNull().default("PENDING"),
    amountMinor: integer("amount_minor").notNull(),
    refundedMinor: integer("refunded_minor").notNull().default(0),
    currency: text("currency").notNull().default("AED"),
    failureReason: text("failure_reason"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("payments_reservation_idx").on(t.reservationId),
    check("payments_amount_pos", sql`${t.amountMinor} > 0`),
    check("payments_refund_range", sql`${t.refundedMinor} >= 0 AND ${t.refundedMinor} <= ${t.amountMinor}`),
    check("payments_currency", sql`${t.currency} = 'AED'`),
  ],
);

export const deposits = pgTable(
  "deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerDepositId: text("provider_deposit_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: depositStatus("status").notNull().default("PENDING"),
    amountMinor: integer("amount_minor").notNull(),
    capturedMinor: integer("captured_minor").notNull().default(0),
    currency: text("currency").notNull().default("AED"),
    failureReason: text("failure_reason"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("deposits_reservation_idx").on(t.reservationId),
    check("deposits_amount_pos", sql`${t.amountMinor} > 0`),
    check("deposits_capture_range", sql`${t.capturedMinor} >= 0 AND ${t.capturedMinor} <= ${t.amountMinor}`),
    check("deposits_currency", sql`${t.currency} = 'AED'`),
  ],
);

/** Processed provider webhook events; unique event_id dedupes duplicate deliveries. */
export const paymentWebhookEvents = pgTable("payment_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull().unique(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: tstz("received_at").notNull().defaultNow(),
});

export const rentalAgreements = pgTable(
  "rental_agreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .unique()
      .references(() => reservations.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    // Check-out (pick-up)
    checkedOutAt: tstz("checked_out_at").notNull(),
    checkedOutBy: uuid("checked_out_by").references(() => users.id, { onDelete: "set null" }),
    pickupMileageKm: integer("pickup_mileage_km").notNull(),
    /** Fuel/charge level in eighths of a tank (0 = empty, 8 = full). */
    pickupFuelLevel: smallint("pickup_fuel_level").notNull(),
    pickupNotes: text("pickup_notes"),
    // Check-in (return)
    checkedInAt: tstz("checked_in_at"),
    checkedInBy: uuid("checked_in_by").references(() => users.id, { onDelete: "set null" }),
    returnBranchId: uuid("return_branch_id").references(() => branches.id, { onDelete: "restrict" }),
    returnMileageKm: integer("return_mileage_km"),
    returnFuelLevel: smallint("return_fuel_level"),
    returnNotes: text("return_notes"),
    lateMinutes: integer("late_minutes").notNull().default(0),
    lateFeeMinor: integer("late_fee_minor").notNull().default(0),
    fuelChargeMinor: integer("fuel_charge_minor").notNull().default(0),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("rental_agreements_vehicle_idx").on(t.vehicleId),
    index("rental_agreements_return_branch_idx").on(t.returnBranchId),
    index("rental_agreements_checked_out_by_idx").on(t.checkedOutBy),
    index("rental_agreements_checked_in_by_idx").on(t.checkedInBy),
    check("rental_agreements_pickup_fuel_range", sql`${t.pickupFuelLevel} BETWEEN 0 AND 8`),
    check("rental_agreements_return_fuel_range", sql`${t.returnFuelLevel} IS NULL OR ${t.returnFuelLevel} BETWEEN 0 AND 8`),
    check("rental_agreements_pickup_mileage_nonneg", sql`${t.pickupMileageKm} >= 0`),
    check(
      "rental_agreements_return_mileage_gte",
      sql`${t.returnMileageKm} IS NULL OR ${t.returnMileageKm} >= ${t.pickupMileageKm}`,
    ),
    check("rental_agreements_checkin_after_checkout", sql`${t.checkedInAt} IS NULL OR ${t.checkedInAt} >= ${t.checkedOutAt}`),
    check(
      "rental_agreements_checkin_complete",
      sql`${t.checkedInAt} IS NULL OR (${t.returnMileageKm} IS NOT NULL AND ${t.returnFuelLevel} IS NOT NULL AND ${t.returnBranchId} IS NOT NULL)`,
    ),
    check(
      "rental_agreements_money_nonneg",
      sql`${t.lateMinutes} >= 0 AND ${t.lateFeeMinor} >= 0 AND ${t.fuelChargeMinor} >= 0`,
    ),
  ],
);

export const damageReports = pgTable(
  "damage_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
    rentalAgreementId: uuid("rental_agreement_id").references(() => rentalAgreements.id, { onDelete: "set null" }),
    reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
    stage: damageStage("stage").notNull(),
    severity: damageSeverity("severity").notNull(),
    description: text("description").notNull(),
    /** Storage keys (damage/<reportId>/<uuid>.<ext>); served only via /api/files. */
    imageKeys: text("image_keys").array().notNull().default(sql`'{}'::text[]`),
    estimatedCostMinor: integer("estimated_cost_minor").notNull().default(0),
    /** Amount captured from the deposit for this damage. */
    chargedMinor: integer("charged_minor").notNull().default(0),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("damage_reports_vehicle_idx").on(t.vehicleId, t.createdAt),
    index("damage_reports_reservation_idx").on(t.reservationId),
    index("damage_reports_agreement_idx").on(t.rentalAgreementId),
    index("damage_reports_reported_by_idx").on(t.reportedBy),
    check("damage_reports_description_not_blank", sql`length(btrim(${t.description})) > 0`),
    check("damage_reports_money_nonneg", sql`${t.estimatedCostMinor} >= 0 AND ${t.chargedMinor} >= 0`),
  ],
);

export const maintenanceBlocks = pgTable(
  "maintenance_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    /** Generated half-open [starts_at, ends_at). */
    period: tstzrange("period")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(starts_at, ends_at, '[)')`),
    reason: text("reason").notNull(),
    status: maintenanceStatus("status").notNull().default("SCHEDULED"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("maintenance_blocks_period_gist").using("gist", t.vehicleId, t.period),
    index("maintenance_blocks_created_by_idx").on(t.createdBy),
    check("maintenance_blocks_period_valid", sql`${t.endsAt} > ${t.startsAt}`),
    check("maintenance_blocks_reason_not_blank", sql`length(btrim(${t.reason})) > 0`),
  ],
);

/**
 * Trigger-maintained mirror of everything occupying a vehicle. Never write to it
 * from application code. The exclusion constraint lives in the custom migration.
 */
export const vehicleOccupancy = pgTable(
  "vehicle_occupancy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    period: tstzrange("period").notNull(),
    reservationId: uuid("reservation_id")
      .unique()
      .references(() => reservations.id, { onDelete: "cascade" }),
    maintenanceBlockId: uuid("maintenance_block_id")
      .unique()
      .references(() => maintenanceBlocks.id, { onDelete: "cascade" }),
  },
  (t) => [
    check("vehicle_occupancy_one_source", sql`num_nonnulls(${t.reservationId}, ${t.maintenanceBlockId}) = 1`),
    check("vehicle_occupancy_period_bounded", sql`NOT isempty(${t.period}) AND NOT lower_inf(${t.period}) AND NOT upper_inf(${t.period})`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    /** e.g. reservation.created, reservation.confirmed, vehicle.updated, checkin.completed */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);
