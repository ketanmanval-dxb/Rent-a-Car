import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { extraPricingType, fuelType, pricingRuleKind, transmission, vehicleStatus } from "./enums";
import { tstz } from "./types";

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    emirate: text("emirate").notNull(),
    address: text("address").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    /** IANA time zone used to display times for this branch, e.g. Asia/Dubai. */
    timezone: text("timezone").notNull().default("Asia/Dubai"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    /** Human-readable opening hours, e.g. "Daily 00:00-24:00". */
    openingHours: text("opening_hours").notNull().default("Daily 08:00-22:00"),
    /** Location surcharge per rental picked up here (airport fee), fils. */
    locationFeeMinor: integer("location_fee_minor").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("branches_code_format", sql`${t.code} ~ '^[A-Z0-9-]{2,12}$'`),
    check("branches_timezone_format", sql`${t.timezone} ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$|^UTC$'`),
    check("branches_location_fee_nonneg", sql`${t.locationFeeMinor} >= 0`),
    check("branches_lat_range", sql`${t.latitude} IS NULL OR ${t.latitude} BETWEEN -90 AND 90`),
    check("branches_lng_range", sql`${t.longitude} IS NULL OR ${t.longitude} BETWEEN -180 AND 180`),
  ],
);

export const vehicleCategories = pgTable(
  "vehicle_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Base daily rate, fils. */
    dailyRateMinor: integer("daily_rate_minor").notNull(),
    /** Refundable security deposit held at booking, fils. */
    depositMinor: integer("deposit_minor").notNull(),
    /** Late-return charge per started hour after the grace period, fils (capped at the daily rate per day). */
    lateFeePerHourMinor: integer("late_fee_per_hour_minor").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("vehicle_categories_daily_rate_pos", sql`${t.dailyRateMinor} > 0`),
    check("vehicle_categories_deposit_nonneg", sql`${t.depositMinor} >= 0`),
    check("vehicle_categories_late_fee_nonneg", sql`${t.lateFeePerHourMinor} >= 0`),
  ],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Current/home branch. Updated on one-way returns. */
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => vehicleCategories.id, { onDelete: "restrict" }),
    make: text("make").notNull(),
    model: text("model").notNull(),
    year: smallint("year").notNull(),
    plateNumber: text("plate_number").notNull().unique(),
    vin: text("vin").notNull().unique(),
    color: text("color").notNull(),
    transmission: transmission("transmission").notNull(),
    fuelType: fuelType("fuel_type").notNull(),
    seats: smallint("seats").notNull(),
    doors: smallint("doors").notNull(),
    luggage: smallint("luggage").notNull(),
    /** Optional per-vehicle override of the category daily rate, fils. */
    dailyRateMinor: integer("daily_rate_minor"),
    mileageKm: integer("mileage_km").notNull().default(0),
    status: vehicleStatus("status").notNull().default("AVAILABLE"),
    /** Public image path (e.g. /vehicles/x.jpg) or null for a placeholder. */
    imageUrl: text("image_url"),
    description: text("description").notNull().default(""),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("vehicles_branch_status_idx").on(t.branchId, t.status),
    index("vehicles_category_idx").on(t.categoryId),
    check("vehicles_vin_format", sql`${t.vin} ~ '^[A-HJ-NPR-Z0-9]{17}$'`),
    check("vehicles_plate_not_blank", sql`length(btrim(${t.plateNumber})) > 0`),
    check("vehicles_year_range", sql`${t.year} BETWEEN 1990 AND 2100`),
    check("vehicles_seats_range", sql`${t.seats} BETWEEN 1 AND 60`),
    check("vehicles_doors_range", sql`${t.doors} BETWEEN 0 AND 10`),
    check("vehicles_luggage_range", sql`${t.luggage} BETWEEN 0 AND 30`),
    check("vehicles_daily_rate_pos", sql`${t.dailyRateMinor} IS NULL OR ${t.dailyRateMinor} > 0`),
    check("vehicles_mileage_nonneg", sql`${t.mileageKm} >= 0`),
  ],
);

export const vehicleFeatures = pgTable("vehicle_features", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const vehicleFeatureMap = pgTable(
  "vehicle_feature_map",
  {
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => vehicleFeatures.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.featureId] }), index("vehicle_feature_map_feature_idx").on(t.featureId)],
);

export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: pricingRuleKind("kind").notNull(),
    /** Null = applies to all categories. */
    categoryId: uuid("category_id").references(() => vehicleCategories.id, { onDelete: "cascade" }),
    /** Null = applies at every pick-up branch (SEASONAL/WEEKEND/DURATION_DISCOUNT). */
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    /** ONE_WAY_FEE: pick-up and return branches. */
    fromBranchId: uuid("from_branch_id").references(() => branches.id, { onDelete: "cascade" }),
    toBranchId: uuid("to_branch_id").references(() => branches.id, { onDelete: "cascade" }),
    /** SEASONAL: inclusive local-date window (branch time zone). */
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    /** DURATION_DISCOUNT threshold. */
    minDays: integer("min_days"),
    /** Basis points: +2000 = +20 %, -1000 = -10 %. */
    adjustmentBps: integer("adjustment_bps"),
    /** ONE_WAY_FEE amount, fils. */
    amountMinor: integer("amount_minor"),
    /** Higher wins when several DURATION_DISCOUNT / ONE_WAY_FEE rules match. */
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("pricing_rules_kind_active_idx").on(t.kind, t.isActive),
    check("pricing_rules_bps_range", sql`${t.adjustmentBps} IS NULL OR ${t.adjustmentBps} BETWEEN -9000 AND 50000`),
    check("pricing_rules_amount_nonneg", sql`${t.amountMinor} IS NULL OR ${t.amountMinor} >= 0`),
    check(
      "pricing_rules_shape",
      sql`CASE ${t.kind}
        WHEN 'SEASONAL' THEN ${t.validFrom} IS NOT NULL AND ${t.validTo} IS NOT NULL AND ${t.validTo} >= ${t.validFrom} AND ${t.adjustmentBps} IS NOT NULL
        WHEN 'WEEKEND' THEN ${t.adjustmentBps} IS NOT NULL
        WHEN 'DURATION_DISCOUNT' THEN ${t.minDays} IS NOT NULL AND ${t.minDays} >= 1 AND ${t.adjustmentBps} IS NOT NULL
        WHEN 'ONE_WAY_FEE' THEN ${t.fromBranchId} IS NOT NULL AND ${t.toBranchId} IS NOT NULL AND ${t.fromBranchId} <> ${t.toBranchId} AND ${t.amountMinor} IS NOT NULL
      END`,
    ),
  ],
);

export const extras = pgTable(
  "extras",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    pricingType: extraPricingType("pricing_type").notNull(),
    priceMinor: integer("price_minor").notNull(),
    /** Optional cap for PER_DAY extras over the whole rental, fils. */
    maxTotalMinor: integer("max_total_minor"),
    maxQuantity: smallint("max_quantity").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("extras_price_nonneg", sql`${t.priceMinor} >= 0`),
    check("extras_max_total_pos", sql`${t.maxTotalMinor} IS NULL OR ${t.maxTotalMinor} > 0`),
    check("extras_max_qty_range", sql`${t.maxQuantity} BETWEEN 1 AND 10`),
  ],
);
