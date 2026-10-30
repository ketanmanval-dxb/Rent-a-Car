// Server-only adapter over db's catalog/search functions. Every loader defers to
// request time (connection()) because availability and fleet data must be fresh.
import { connection } from "next/server";
import {
  getAvailabilityCalendar,
  getBranch,
  getVehicle,
  listBranches,
  listCategories,
  listExtras,
  searchVehicles,
} from "@/server/catalog";
import type {
  BranchOption,
  BranchView,
  CalendarDay,
  CategoryOption,
  ExtraView,
  FuelType,
  SearchResultView,
  Transmission,
  VehicleDetailView,
} from "@/lib/types";

export async function loadBranches(): Promise<BranchView[]> {
  await connection();
  const branches: BranchView[] = await listBranches();
  return branches;
}

export async function loadBranchOptions(): Promise<BranchOption[]> {
  const branches = await loadBranches();
  return branches.map((b) => ({ id: b.id, code: b.code, name: b.name, city: b.city, timezone: b.timezone }));
}

export async function loadBranch(idOrCode: string): Promise<BranchView | null> {
  await connection();
  const b: BranchView | null = await getBranch(idOrCode);
  return b;
}

export async function loadCategories(): Promise<CategoryOption[]> {
  await connection();
  const cats = await listCategories();
  return cats.map((c) => ({ id: c.id, name: c.name }));
}

export async function loadExtras(): Promise<ExtraView[]> {
  await connection();
  const extras: ExtraView[] = await listExtras();
  return extras;
}

export type SearchInput = {
  pickupBranchId: string;
  returnBranchId: string;
  pickupAt: Date;
  returnAt: Date;
  categoryId?: string;
  transmission?: Transmission;
  minSeats?: number;
  fuelType?: FuelType;
  maxDailyFils?: number;
  sort?: "price_asc" | "price_desc";
};

export type SearchOutcome = { ok: true; days: number; results: SearchResultView[] } | { ok: false; message: string };

export async function runSearch(input: SearchInput): Promise<SearchOutcome> {
  await connection();
  const res = await searchVehicles(input);
  if (!res.ok) return { ok: false, message: res.message };
  const results: SearchResultView[] = res.results;
  return { ok: true, days: res.days, results };
}

export async function loadVehicle(id: string): Promise<VehicleDetailView | null> {
  await connection();
  const v: VehicleDetailView | null = await getVehicle(id);
  return v;
}

export async function loadCalendar(vehicleId: string, fromDate: string, toDate: string): Promise<CalendarDay[]> {
  await connection();
  const days: CalendarDay[] = await getAvailabilityCalendar(vehicleId, fromDate, toDate);
  return days;
}
