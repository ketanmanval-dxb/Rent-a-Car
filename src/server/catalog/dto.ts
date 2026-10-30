import type { InferSelectModel } from "drizzle-orm";
import type { branches, extras, vehicleCategories, vehicles } from "@/server/db/schema";

// Client-safe data shapes returned by server functions (plain JSON-able values + Dates).

export type TransmissionDto = "automatic" | "manual";
export type FuelTypeDto = "petrol" | "diesel" | "hybrid" | "electric";

export interface Branch {
  id: string;
  code: string;
  name: string;
  city: string;
  emirate: string;
  address: string;
  phone: string;
  email: string | null;
  timezone: string;
  openingHours: string;
  latitude: number | null;
  longitude: number | null;
  locationFeeFils: number;
  isActive: boolean;
}

export interface Category {
  id: string;
  code: string;
  slug: string;
  name: string;
  description: string;
  dailyRateFils: number;
  depositFils: number;
  lateFeePerHourFils: number;
}

export interface Extra {
  id: string;
  code: string;
  name: string;
  description: string;
  pricing: "per_day" | "per_rental";
  priceFils: number;
  maxTotalFils: number | null;
  maxQuantity: number;
  isActive: boolean;
}

export interface VehicleSummary {
  id: string;
  make: string;
  model: string;
  year: number;
  category: { id: string; name: string; code: string };
  transmission: TransmissionDto;
  fuelType: FuelTypeDto;
  seats: number;
  doors: number;
  bags: number;
  imageUrl: string | null;
  features: string[];
  branchId: string;
  /** Vehicle override or category base daily rate. */
  dailyRateFromFils: number;
}

export interface VehicleDetail extends VehicleSummary {
  description: string;
  branch: Branch;
  depositFils: number;
  plateNumber: string;
  color: string;
}

type BranchRow = InferSelectModel<typeof branches>;
type CategoryRow = InferSelectModel<typeof vehicleCategories>;
type ExtraRow = InferSelectModel<typeof extras>;
type VehicleRow = InferSelectModel<typeof vehicles>;

export function toBranch(b: BranchRow): Branch {
  return {
    id: b.id,
    code: b.code,
    name: b.name,
    city: b.city,
    emirate: b.emirate,
    address: b.address,
    phone: b.phone,
    email: b.email,
    timezone: b.timezone,
    openingHours: b.openingHours,
    latitude: b.latitude === null ? null : Number(b.latitude),
    longitude: b.longitude === null ? null : Number(b.longitude),
    locationFeeFils: b.locationFeeMinor,
    isActive: b.isActive,
  };
}

export function toCategory(c: CategoryRow): Category {
  return {
    id: c.id,
    code: c.code,
    slug: c.code.toLowerCase(),
    name: c.name,
    description: c.description,
    dailyRateFils: c.dailyRateMinor,
    depositFils: c.depositMinor,
    lateFeePerHourFils: c.lateFeePerHourMinor,
  };
}

export function toExtra(e: ExtraRow): Extra {
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    description: e.description,
    pricing: e.pricingType === "PER_DAY" ? "per_day" : "per_rental",
    priceFils: e.priceMinor,
    maxTotalFils: e.maxTotalMinor,
    maxQuantity: e.maxQuantity,
    isActive: e.isActive,
  };
}

export function toVehicleSummary(v: VehicleRow, category: CategoryRow, features: string[]): VehicleSummary {
  return {
    id: v.id,
    make: v.make,
    model: v.model,
    year: v.year,
    category: { id: category.id, name: category.name, code: category.code },
    transmission: v.transmission.toLowerCase() as TransmissionDto,
    fuelType: v.fuelType.toLowerCase() as FuelTypeDto,
    seats: v.seats,
    doors: v.doors,
    bags: v.luggage,
    imageUrl: v.imageUrl,
    features,
    branchId: v.branchId,
    dailyRateFromFils: v.dailyRateMinor ?? category.dailyRateMinor,
  };
}
