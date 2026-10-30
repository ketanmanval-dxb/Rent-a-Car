// Client-safe view models used by UI components. Server adapters in
// src/app/_data/** map the db layer's results onto these shapes so components
// never import src/server/**. Money is integer fils; instants are ISO strings or Dates (UTC).

export type Transmission = "automatic" | "manual";
export type FuelType = "petrol" | "diesel" | "hybrid" | "electric";

export type ReservationStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PICKED_UP"
  | "RETURNED"
  | "CANCELLED"
  | "EXPIRED"
  | "REFUNDED";

export type BranchOption = {
  id: string;
  code: string;
  name: string;
  city: string;
  timezone: string;
};

export type CategoryOption = { id: string; name: string };

export type SimulatedOutcome = "succeed" | "fail" | "cancel";

export type CalendarDayStatus = "available" | "booked" | "maintenance";
export type CalendarDay = { date: string; status: CalendarDayStatus };

export type QuoteLine = { label: string; amountFils: number; detail?: string };

export type QuoteView = {
  days: number;
  dailyRateFils: number;
  baseFils: number;
  extras: { name: string; quantity: number; totalFils: number; detail?: string }[];
  extrasFils: number;
  oneWayFeeFils: number;
  /** Any other fees (location/airport fee, discounts as negative), already included in subtotal. */
  otherLines: QuoteLine[];
  subtotalFils: number;
  vatBps: number;
  vatFils: number;
  totalFils: number;
  depositFils: number;
};

export type BranchView = {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  email?: string | null;
  timezone: string;
  openingHours: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type VehicleSummaryView = {
  id: string;
  make: string;
  model: string;
  year: number;
  category: { id: string; name: string };
  transmission: Transmission;
  fuelType: FuelType;
  seats: number;
  doors: number;
  bags: number;
  imageUrl: string | null;
  features: string[];
  branchId: string;
};

export type VehicleDetailView = VehicleSummaryView & {
  description: string;
  branch: BranchView;
  dailyRateFromFils: number;
  depositFils: number;
};

export type SearchResultView = {
  vehicle: VehicleSummaryView;
  dailyRateFils: number;
  baseFils: number;
  oneWayFeeFils: number;
  /** Rental total incl. VAT and fees, before extras. */
  totalFils: number;
};

export type ExtraView = {
  id: string;
  code: string;
  name: string;
  description: string;
  pricing: "per_day" | "per_rental";
  priceFils: number;
  maxQuantity: number;
};

export type DriverProfileView = {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  nationality: string | null;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiry: string;
  licenceFileKey: string | null;
  licenceUploadedAt: Date | string | null;
};
