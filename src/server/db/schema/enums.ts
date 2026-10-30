import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["customer", "admin"]);

export const vehicleStatus = pgEnum("vehicle_status", ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]);

export const reservationStatus = pgEnum("reservation_status", [
  "PENDING",
  "CONFIRMED",
  "PICKED_UP",
  "RETURNED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
]);

/** Statuses that occupy the vehicle (kept in vehicle_occupancy by trigger). */
export const ACTIVE_RESERVATION_STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP"] as const;

/** Payment status is independent of reservation status. */
export const paymentStatus = pgEnum("payment_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);

export const paymentKind = pgEnum("payment_kind", ["RENTAL", "MODIFICATION", "LATE_RETURN", "DAMAGE", "FUEL"]);

/** Deposit status is independent of reservation and payment status. */
export const depositStatus = pgEnum("deposit_status", ["PENDING", "HELD", "RELEASED", "CAPTURED", "FAILED", "EXPIRED"]);

export const transmission = pgEnum("transmission", ["AUTOMATIC", "MANUAL"]);

export const fuelType = pgEnum("fuel_type", ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]);

export const pricingRuleKind = pgEnum("pricing_rule_kind", [
  /** Adjust the daily rate by adjustment_bps on dates within [valid_from, valid_to]. */
  "SEASONAL",
  /** Adjust the daily rate by adjustment_bps for rental days starting on Sat/Sun (UAE weekend, branch-local). */
  "WEEKEND",
  /** Adjust the rental subtotal by adjustment_bps when days >= min_days. */
  "DURATION_DISCOUNT",
  /** Flat amount_minor when returning to a different branch (from_branch -> to_branch). */
  "ONE_WAY_FEE",
]);

export const extraPricingType = pgEnum("extra_pricing_type", ["PER_DAY", "PER_RENTAL"]);

export const maintenanceStatus = pgEnum("maintenance_status", ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);

export const damageStage = pgEnum("damage_stage", ["PICKUP", "RETURN", "OTHER"]);

export const damageSeverity = pgEnum("damage_severity", ["MINOR", "MODERATE", "MAJOR"]);
