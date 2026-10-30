// Integration fixtures: customers with complete driver profiles, admins, and
// far-future booking windows that never collide between tests or runs.

import { randomInt, randomUUID } from "node:crypto";
import type { Contracts } from "./contracts";
import { q } from "./test-db";

export const PASSWORD = "QaPassw0rd!234";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A random 06:00Z (10:00 Asia/Dubai) start between 2031 and 2095, unique enough per test. */
export function window(days = 3, offsetDays = 0) {
  const start = Date.UTC(2031 + randomInt(0, 64), randomInt(0, 12), randomInt(1, 28), 6) + offsetDays * DAY;
  return { pickupAt: new Date(start), returnAt: new Date(start + days * DAY) };
}
export const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
export { DAY, HOUR };

/** A 1x1 PNG, good enough for licence/damage uploads. */
export const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64"),
);

export async function createUser(c: Contracts, role: "customer" | "admin" = "customer") {
  const email = `qa-${role}-${randomUUID().slice(0, 8)}@example.test`;
  if (!c.auth?.api?.signUpEmail) throw new Error("auth.api.signUpEmail not available from @/server/auth");
  const res = await c.auth.api.signUpEmail({ body: { name: `QA ${role}`, email, password: PASSWORD } });
  const id: string = res.user?.id ?? res.id;
  if (role === "admin") await q("UPDATE users SET role = 'admin' WHERE id = $1", [id]);
  return { id, email };
}

/** Customer with a complete driver profile and a licence upload (required to reserve). */
export async function createCustomer(c: Contracts) {
  const user = await createUser(c);
  await c.upsertDriverProfile!(user.id, {
    fullName: "QA Driver",
    phone: "+971501234567",
    dateOfBirth: "1990-01-01",
    nationality: "AE",
    licenceNumber: `QA${randomInt(100000, 999999)}`,
    licenceCountry: "AE",
    licenceExpiry: "2099-01-01",
  });
  const up = await c.uploadLicence!(user.id, { bytes: PNG, contentType: "image/png", filename: "licence.png" });
  if (up && up.ok === false) throw new Error(`uploadLicence failed: ${up.message}`);
  return user;
}

/**
 * First active branch + a vehicle at it that is free in the window AND for `marginDays` after it,
 * so tests can derive adjacent windows (back-to-back, overlap by +1 day) without colliding with
 * bookings left by earlier runs. `search` is for the extended window unless marginDays = 0.
 */
export async function pickVehicle(c: Contracts, w = window(), marginDays = 4) {
  const branches = await c.listBranches!();
  if (!branches.length) throw new Error("No branches: is the test DB seeded? (QA_FRESH_DB=1 pnpm test)");
  for (const b of branches) {
    const res = await c.searchVehicles!({ pickupBranchId: b.id, returnBranchId: b.id, pickupAt: w.pickupAt, returnAt: new Date(w.returnAt.getTime() + marginDays * DAY) });
    if (res.results.length) return { branch: b, branches, vehicle: res.results[0].vehicle, window: w, search: res };
  }
  throw new Error("No available vehicle in any branch");
}

export async function reserve(c: Contracts, userId: string, vehicleId: string, branchId: string, w: { pickupAt: Date; returnAt: Date }, extra: Record<string, unknown> = {}) {
  return c.createReservation!(userId, { vehicleId, pickupBranchId: branchId, returnBranchId: branchId, extras: [], ...w, ...extra });
}
