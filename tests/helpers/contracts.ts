/* eslint-disable @typescript-eslint/no-explicit-any */
// Single place that binds integration tests to db's server functions.
// Module paths are db's final paths (TASKS.md Messages).
// A missing function makes the dependent tests skip (not fail) until it lands.

type Fn = (...args: any[]) => Promise<any>;

// Final paths posted by db in TASKS.md Messages (db -> qa / db -> app).
const CANDIDATE_MODULES = [
  "@/server/auth", // getAuth, sessions
  "@/server/catalog", // listBranches, listExtras, listCategories, searchVehicles, getVehicle, getAvailabilityCalendar
  "@/server/pricing", // quoteRental
  "@/server/profile", // getDriverProfile, upsertDriverProfile, uploadLicence
  "@/server/reservations", // createReservation ... payReservation, refundReservation, releaseExpiredHolds
  "@/server/admin", // D9 (not landed yet)
];

const NAMES = [
  "listBranches", "listExtras", "listCategories", "searchVehicles", "getVehicle", "getAvailabilityCalendar",
  "quoteRental", "upsertDriverProfile", "uploadLicence", "getDriverProfile",
  "createReservation", "getReservationForUser", "listReservationsForUser", "previewDateChange", "modifyReservationDates",
  "cancelReservation", "payReservation", "releaseExpiredHolds", "refundReservation",
  "adminCheckOut", "adminCheckIn", "adminCreateDamageReport", "adminListReservations", "adminCreateMaintenanceBlock",
  "adminCreateVehicle", "adminUpdateVehicle", "adminCreatePricingRule", "adminUpdatePricingRule", "adminListDamageReports",
] as const;

export type Contracts = { [K in (typeof NAMES)[number]]?: Fn } & { auth?: any };

async function tryImport(spec: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
  } catch (err) {
    const msg = String(err);
    // A module that exists but throws on import is a real bug: surface it.
    if (!/Cannot find (package|module)|Failed to load url|does not exist/i.test(msg)) throw err;
    return null;
  }
}

let cached: Contracts | undefined;

export async function loadContracts(): Promise<Contracts> {
  if (cached) return cached;
  const mods = (await Promise.all(CANDIDATE_MODULES.map(tryImport))).filter(Boolean) as Record<string, unknown>[];
  const out: Contracts = {};
  for (const name of NAMES) {
    const m = mods.find((mod) => typeof mod[name] === "function");
    if (m) out[name] = m[name] as Fn;
  }
  // Better Auth instance: `getAuth()` factory (db) or a plain `auth` export.
  const factory = mods.find((m) => typeof m.getAuth === "function")?.getAuth as (() => unknown) | undefined;
  out.auth = factory ? factory() : mods.find((m) => m.auth && typeof m.auth === "object")?.auth;
  cached = out;
  return out;
}

/** Names from `need` that are not implemented yet. */
export function missing(c: Contracts, need: (keyof Contracts)[]): string[] {
  return need.filter((n) => !c[n]);
}
