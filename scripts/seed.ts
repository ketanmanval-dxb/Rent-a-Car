// Seed the development database with realistic UAE sample data.
//
//   pnpm db:seed            idempotent: upserts reference data, creates users/reservations if missing
//
// Uses DATABASE_URL from .env.local (driveeasy_dev). Never point this at production.
// Local-only credentials (documented in TASKS.md):
//   admin@driveeasy.local    / Admin@12345
//   customer@driveeasy.local / Customer@12345

import { eq, like, sql } from "drizzle-orm";
import { getAuth } from "../src/server/auth/auth";
import { closeDb, getDb } from "../src/server/db";
import {
  branches,
  driverProfiles,
  extras,
  pricingRules,
  reservations,
  users,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
} from "../src/server/db/schema";
import { getStorage } from "../src/server/storage";

export const SEED_USERS = {
  admin: { name: "DriveEasy Admin", email: "admin@driveeasy.local", password: "Admin@12345" },
  customer: { name: "Aisha Rahman", email: "customer@driveeasy.local", password: "Customer@12345" },
} as const;

const BRANCHES = [
  {
    code: "DXB-APT",
    name: "Dubai Airport (DXB) Terminal 3",
    city: "Dubai",
    emirate: "Dubai",
    address: "Arrivals Hall, Terminal 3, Dubai International Airport, Al Garhoud, Dubai",
    phone: "+971 4 220 1100",
    email: "dxb.airport@driveeasy.local",
    latitude: "25.248600",
    longitude: "55.352000",
    openingHours: "Open 24 hours, 7 days",
    locationFeeMinor: 5_000,
  },
  {
    code: "DXB-MAR",
    name: "Dubai Marina",
    city: "Dubai",
    emirate: "Dubai",
    address: "Marina Walk, Shop 12, Dubai Marina, Dubai",
    phone: "+971 4 220 1200",
    email: "dxb.marina@driveeasy.local",
    latitude: "25.080500",
    longitude: "55.140300",
    openingHours: "Daily 08:00-22:00",
    locationFeeMinor: 0,
  },
  {
    code: "DXB-DTN",
    name: "Downtown Dubai",
    city: "Dubai",
    emirate: "Dubai",
    address: "Sheikh Mohammed bin Rashid Blvd, Downtown Dubai, Dubai",
    phone: "+971 4 220 1300",
    email: "dxb.downtown@driveeasy.local",
    latitude: "25.197200",
    longitude: "55.274400",
    openingHours: "Daily 08:00-22:00",
    locationFeeMinor: 0,
  },
  {
    code: "AUH-CTY",
    name: "Abu Dhabi City (Corniche)",
    city: "Abu Dhabi",
    emirate: "Abu Dhabi",
    address: "Corniche Road West, Al Khalidiyah, Abu Dhabi",
    phone: "+971 2 650 1400",
    email: "auh.city@driveeasy.local",
    latitude: "24.470800",
    longitude: "54.341700",
    openingHours: "Daily 08:00-21:00",
    locationFeeMinor: 0,
  },
  {
    code: "SHJ-CTY",
    name: "Sharjah City Centre",
    city: "Sharjah",
    emirate: "Sharjah",
    address: "Al Wahda Street, Industrial Area 4, Sharjah",
    phone: "+971 6 540 1500",
    email: "shj.city@driveeasy.local",
    latitude: "25.326500",
    longitude: "55.393500",
    openingHours: "Sat-Thu 08:00-21:00, Fri 14:00-21:00",
    locationFeeMinor: 0,
  },
] as const;

const CATEGORIES = [
  { code: "ECONOMY", name: "Economy", description: "Small, fuel-efficient city cars.", dailyRateMinor: 12_000, depositMinor: 100_000, lateFeePerHourMinor: 2_500, sortOrder: 1 },
  { code: "COMPACT", name: "Compact", description: "Comfortable hatchbacks and small sedans.", dailyRateMinor: 15_000, depositMinor: 100_000, lateFeePerHourMinor: 3_000, sortOrder: 2 },
  { code: "SEDAN", name: "Sedan", description: "Spacious mid-size sedans for business and family trips.", dailyRateMinor: 20_000, depositMinor: 150_000, lateFeePerHourMinor: 4_000, sortOrder: 3 },
  { code: "SUV", name: "SUV", description: "4x4s and crossovers for desert roads and big luggage.", dailyRateMinor: 30_000, depositMinor: 250_000, lateFeePerHourMinor: 6_000, sortOrder: 4 },
  { code: "MPV", name: "People Carrier", description: "7-seaters for groups and families.", dailyRateMinor: 28_000, depositMinor: 200_000, lateFeePerHourMinor: 5_500, sortOrder: 5 },
  { code: "LUXURY", name: "Luxury", description: "Premium and sports cars.", dailyRateMinor: 65_000, depositMinor: 500_000, lateFeePerHourMinor: 13_000, sortOrder: 6 },
] as const;

const FEATURES = [
  ["ac", "Air conditioning"],
  ["bluetooth", "Bluetooth"],
  ["carplay", "Apple CarPlay / Android Auto"],
  ["rear_camera", "Rear-view camera"],
  ["cruise_control", "Cruise control"],
  ["built_in_nav", "Built-in navigation"],
  ["sunroof", "Sunroof"],
  ["leather_seats", "Leather seats"],
  ["keyless", "Keyless entry"],
  ["awd", "4x4 / AWD"],
  ["usb_c", "USB-C charging"],
  ["parking_sensors", "Parking sensors"],
] as const;

type FeatureCode = (typeof FEATURES)[number][0];

interface SeedVehicle {
  branch: (typeof BRANCHES)[number]["code"];
  category: (typeof CATEGORIES)[number]["code"];
  make: string;
  model: string;
  year: number;
  plate: string;
  color: string;
  transmission: "AUTOMATIC" | "MANUAL";
  fuelType: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  seats: number;
  doors: number;
  luggage: number;
  mileageKm: number;
  dailyRateMinor?: number;
  features: FeatureCode[];
  description: string;
}

const BASIC: FeatureCode[] = ["ac", "bluetooth", "usb_c"];

const VEHICLES: SeedVehicle[] = [
  { branch: "DXB-APT", category: "ECONOMY", make: "Nissan", model: "Sunny", year: 2025, plate: "Dubai A 10231", color: "White", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 2, mileageKm: 18_400, features: [...BASIC, "rear_camera"], description: "Reliable, economical sedan, ideal for city driving." },
  { branch: "DXB-APT", category: "COMPACT", make: "Toyota", model: "Corolla", year: 2025, plate: "Dubai B 22417", color: "Silver", transmission: "AUTOMATIC", fuelType: "HYBRID", seats: 5, doors: 4, luggage: 3, mileageKm: 9_800, features: [...BASIC, "carplay", "rear_camera", "cruise_control"], description: "Hybrid efficiency with a comfortable ride." },
  { branch: "DXB-APT", category: "SEDAN", make: "Toyota", model: "Camry", year: 2026, plate: "Dubai C 31905", color: "Black", transmission: "AUTOMATIC", fuelType: "HYBRID", seats: 5, doors: 4, luggage: 4, mileageKm: 4_200, features: [...BASIC, "carplay", "rear_camera", "cruise_control", "keyless", "parking_sensors"], description: "Roomy business sedan with hybrid economy." },
  { branch: "DXB-APT", category: "SUV", make: "Toyota", model: "Land Cruiser", year: 2025, plate: "Dubai D 40552", color: "Pearl White", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 7, doors: 5, luggage: 5, mileageKm: 21_000, dailyRateMinor: 45_000, features: [...BASIC, "carplay", "rear_camera", "cruise_control", "awd", "leather_seats", "built_in_nav", "keyless"], description: "The iconic full-size 4x4 for desert and highway." },
  { branch: "DXB-APT", category: "LUXURY", make: "Mercedes-Benz", model: "E 300", year: 2026, plate: "Dubai E 50018", color: "Obsidian Black", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 3, mileageKm: 3_100, features: [...BASIC, "carplay", "rear_camera", "cruise_control", "leather_seats", "sunroof", "built_in_nav", "keyless", "parking_sensors"], description: "Executive luxury with a refined cabin." },
  { branch: "DXB-MAR", category: "ECONOMY", make: "Kia", model: "Picanto", year: 2025, plate: "Dubai F 11872", color: "Red", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 4, doors: 5, luggage: 1, mileageKm: 25_300, features: [...BASIC], description: "Nimble city car that parks anywhere." },
  { branch: "DXB-MAR", category: "COMPACT", make: "Hyundai", model: "Elantra", year: 2025, plate: "Dubai G 23390", color: "Blue", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 3, mileageKm: 14_700, features: [...BASIC, "carplay", "rear_camera"], description: "Modern compact sedan with smart connectivity." },
  { branch: "DXB-MAR", category: "SUV", make: "Nissan", model: "Patrol", year: 2025, plate: "Dubai H 41206", color: "Grey", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 7, doors: 5, luggage: 5, mileageKm: 17_900, features: [...BASIC, "carplay", "rear_camera", "awd", "leather_seats", "cruise_control"], description: "Powerful 7-seat SUV, a UAE favourite." },
  { branch: "DXB-MAR", category: "LUXURY", make: "Porsche", model: "911 Carrera", year: 2025, plate: "Dubai J 59001", color: "Guards Red", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 4, doors: 2, luggage: 1, mileageKm: 6_400, dailyRateMinor: 120_000, features: [...BASIC, "carplay", "leather_seats", "built_in_nav", "keyless", "parking_sensors"], description: "Iconic sports car for Jumeirah Beach Road cruising." },
  { branch: "DXB-MAR", category: "ECONOMY", make: "Suzuki", model: "Swift", year: 2024, plate: "Dubai K 12455", color: "White", transmission: "MANUAL", fuelType: "PETROL", seats: 5, doors: 5, luggage: 2, mileageKm: 38_100, dailyRateMinor: 9_900, features: ["ac", "bluetooth"], description: "Fun manual hatchback with low running costs." },
  { branch: "DXB-DTN", category: "SEDAN", make: "Honda", model: "Accord", year: 2025, plate: "Dubai L 32784", color: "Grey", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 4, mileageKm: 12_000, features: [...BASIC, "carplay", "rear_camera", "cruise_control"], description: "Comfortable mid-size sedan with plenty of space." },
  { branch: "DXB-DTN", category: "SUV", make: "Tesla", model: "Model Y", year: 2026, plate: "Dubai M 43117", color: "White", transmission: "AUTOMATIC", fuelType: "ELECTRIC", seats: 5, doors: 5, luggage: 4, mileageKm: 5_600, features: [...BASIC, "rear_camera", "built_in_nav", "keyless", "awd", "sunroof"], description: "All-electric crossover with Autopilot and a glass roof." },
  { branch: "DXB-DTN", category: "MPV", make: "Toyota", model: "Innova", year: 2025, plate: "Dubai N 61540", color: "Silver", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 7, doors: 5, luggage: 4, mileageKm: 22_800, features: [...BASIC, "rear_camera"], description: "Practical 7-seater for families and groups." },
  { branch: "DXB-DTN", category: "LUXURY", make: "Range Rover", model: "Sport", year: 2025, plate: "Dubai P 58823", color: "Santorini Black", transmission: "AUTOMATIC", fuelType: "DIESEL", seats: 5, doors: 5, luggage: 4, mileageKm: 11_200, features: [...BASIC, "carplay", "rear_camera", "awd", "leather_seats", "sunroof", "built_in_nav", "keyless", "parking_sensors"], description: "Luxury SUV that is equally at home in the city and the dunes." },
  { branch: "AUH-CTY", category: "ECONOMY", make: "Hyundai", model: "Accent", year: 2025, plate: "Abu Dhabi 1 20431", color: "White", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 2, mileageKm: 19_900, features: [...BASIC, "rear_camera"], description: "Simple, efficient sedan for getting around the capital." },
  { branch: "AUH-CTY", category: "SEDAN", make: "Nissan", model: "Altima", year: 2025, plate: "Abu Dhabi 5 31188", color: "Blue", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 4, mileageKm: 15_400, features: [...BASIC, "carplay", "cruise_control"], description: "Smooth highway cruiser for the Dubai-Abu Dhabi run." },
  { branch: "AUH-CTY", category: "SUV", make: "Mitsubishi", model: "Pajero", year: 2024, plate: "Abu Dhabi 7 42290", color: "Bronze", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 7, doors: 5, luggage: 4, mileageKm: 41_700, dailyRateMinor: 25_000, features: [...BASIC, "awd", "rear_camera"], description: "Tough 4x4 for Liwa and the Empty Quarter." },
  { branch: "AUH-CTY", category: "MPV", make: "Kia", model: "Carnival", year: 2026, plate: "Abu Dhabi 11 60902", color: "Grey", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 8, doors: 5, luggage: 5, mileageKm: 2_900, dailyRateMinor: 32_000, features: [...BASIC, "carplay", "rear_camera", "keyless", "parking_sensors"], description: "Premium 8-seat people carrier with sliding doors." },
  { branch: "SHJ-CTY", category: "ECONOMY", make: "Mitsubishi", model: "Attrage", year: 2024, plate: "Sharjah 2 10877", color: "Silver", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 2, mileageKm: 33_500, dailyRateMinor: 10_500, features: ["ac", "bluetooth"], description: "Budget-friendly sedan for everyday errands." },
  { branch: "SHJ-CTY", category: "COMPACT", make: "Kia", model: "Cerato", year: 2025, plate: "Sharjah 3 22609", color: "Black", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 3, mileageKm: 16_300, features: [...BASIC, "carplay", "rear_camera"], description: "Well-equipped compact with a big boot." },
  { branch: "SHJ-CTY", category: "SUV", make: "Hyundai", model: "Tucson", year: 2025, plate: "Sharjah 1 40015", color: "White", transmission: "AUTOMATIC", fuelType: "HYBRID", seats: 5, doors: 5, luggage: 4, mileageKm: 8_800, features: [...BASIC, "carplay", "rear_camera", "cruise_control", "keyless"], description: "Hybrid crossover with modern safety tech." },
];

const EXTRAS = [
  { code: "child_seat", name: "Child seat", description: "ISOFIX child seat (9-36 kg). Fitted before pick-up.", pricingType: "PER_DAY" as const, priceMinor: 2_500, maxTotalMinor: 25_000, maxQuantity: 3 },
  { code: "gps", name: "GPS navigation", description: "Portable sat-nav with UAE maps and Arabic/English voice.", pricingType: "PER_DAY" as const, priceMinor: 2_000, maxTotalMinor: 20_000, maxQuantity: 1 },
  { code: "additional_driver", name: "Additional driver", description: "Add a second named driver (licence checked at pick-up).", pricingType: "PER_RENTAL" as const, priceMinor: 7_500, maxTotalMinor: null, maxQuantity: 2 },
  { code: "full_insurance", name: "Full insurance (zero excess)", description: "Super CDW: reduces your damage liability to AED 0.", pricingType: "PER_DAY" as const, priceMinor: 6_000, maxTotalMinor: null, maxQuantity: 1 },
];

/** Deterministic, valid 17-char VIN (no I/O/Q) for seed vehicle #i. */
const vinFor = (i: number) => `JDE${String(i + 1).padStart(4, "0")}A2026X${String(i * 7919).padStart(4, "0").slice(-4)}`;

async function upsertReferenceData() {
  const db = getDb();

  for (const b of BRANCHES) {
    await db
      .insert(branches)
      .values({ ...b, timezone: "Asia/Dubai" })
      .onConflictDoUpdate({ target: branches.code, set: { ...b, timezone: "Asia/Dubai" } });
  }
  for (const c of CATEGORIES) {
    await db.insert(vehicleCategories).values(c).onConflictDoUpdate({ target: vehicleCategories.code, set: c });
  }
  for (const [code, name] of FEATURES) {
    await db.insert(vehicleFeatures).values({ code, name }).onConflictDoUpdate({ target: vehicleFeatures.code, set: { name } });
  }
  for (const e of EXTRAS) {
    await db.insert(extras).values(e).onConflictDoUpdate({ target: extras.code, set: e });
  }

  const branchByCode = new Map((await db.select().from(branches)).map((b) => [b.code, b.id]));
  const catByCode = new Map((await db.select().from(vehicleCategories)).map((c) => [c.code, c.id]));
  const featureByCode = new Map((await db.select().from(vehicleFeatures)).map((f) => [f.code, f.id]));

  for (const [i, v] of VEHICLES.entries()) {
    const values = {
      branchId: branchByCode.get(v.branch)!,
      categoryId: catByCode.get(v.category)!,
      make: v.make,
      model: v.model,
      year: v.year,
      plateNumber: v.plate,
      vin: vinFor(i),
      color: v.color,
      transmission: v.transmission,
      fuelType: v.fuelType,
      seats: v.seats,
      doors: v.doors,
      luggage: v.luggage,
      mileageKm: v.mileageKm,
      dailyRateMinor: v.dailyRateMinor ?? null,
      description: v.description,
    };
    // Status/mileage/branch are operational state: only set on first insert.
    const [row] = await db
      .insert(vehicles)
      .values(values)
      .onConflictDoUpdate({
        target: vehicles.plateNumber,
        set: { make: values.make, model: values.model, year: values.year, color: values.color, dailyRateMinor: values.dailyRateMinor, description: values.description },
      })
      .returning({ id: vehicles.id });
    for (const f of v.features) {
      await db.insert(vehicleFeatureMap).values({ vehicleId: row.id, featureId: featureByCode.get(f)! }).onConflictDoNothing();
    }
  }

  // Pricing rules: replaced wholesale on every seed (they're reference data).
  await db.delete(pricingRules);
  const year = new Date().getUTCFullYear();
  await db.insert(pricingRules).values([
    { name: "Weekend rate (+10%)", kind: "WEEKEND", adjustmentBps: 1_000 },
    { name: "Winter peak season (+25%)", kind: "SEASONAL", validFrom: `${year}-12-15`, validTo: `${year + 1}-01-05`, adjustmentBps: 2_500 },
    { name: "Summer saver (-15%)", kind: "SEASONAL", validFrom: `${year + 1}-06-15`, validTo: `${year + 1}-08-31`, adjustmentBps: -1_500 },
    { name: "Weekly discount (7+ days, -10%)", kind: "DURATION_DISCOUNT", minDays: 7, adjustmentBps: -1_000, priority: 1 },
    { name: "Monthly discount (21+ days, -20%)", kind: "DURATION_DISCOUNT", minDays: 21, adjustmentBps: -2_000, priority: 2 },
    { name: "Luxury airport surcharge (+5%)", kind: "SEASONAL", categoryId: catByCode.get("LUXURY")!, branchId: branchByCode.get("DXB-APT")!, validFrom: `${year}-01-01`, validTo: `${year + 2}-12-31`, adjustmentBps: 500 },
  ]);

  // One-way fees for every branch pair.
  const emirateOf = new Map(BRANCHES.map((b) => [b.code, b.emirate]));
  const oneWay: (typeof pricingRules.$inferInsert)[] = [];
  for (const from of BRANCHES) {
    for (const to of BRANCHES) {
      if (from.code === to.code) continue;
      const pair = [emirateOf.get(from.code), emirateOf.get(to.code)].sort().join("|");
      const amountMinor =
        pair === "Dubai|Dubai" ? 7_500 : pair === "Dubai|Sharjah" ? 10_000 : pair === "Abu Dhabi|Dubai" ? 25_000 : 30_000;
      oneWay.push({
        name: `One-way ${from.code} → ${to.code}`,
        kind: "ONE_WAY_FEE",
        fromBranchId: branchByCode.get(from.code)!,
        toBranchId: branchByCode.get(to.code)!,
        amountMinor,
      });
    }
  }
  await db.insert(pricingRules).values(oneWay);
}

// 1x1 PNG used as the sample customer's licence scan.
const SAMPLE_PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);

async function ensureUser(u: { name: string; email: string; password: string }, role: "customer" | "admin") {
  const db = getDb();
  let [row] = await db.select().from(users).where(eq(sql`lower(${users.email})`, u.email.toLowerCase()));
  if (!row) {
    await getAuth().api.signUpEmail({ body: { name: u.name, email: u.email, password: u.password } });
    [row] = await db.select().from(users).where(eq(sql`lower(${users.email})`, u.email.toLowerCase()));
  }
  if (row.role !== role || !row.emailVerified) {
    await db.update(users).set({ role, emailVerified: true }).where(eq(users.id, row.id));
  }
  return row.id;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  const started = Date.now();
  await upsertReferenceData();

  const adminId = await ensureUser(SEED_USERS.admin, "admin");
  const customerId = await ensureUser(SEED_USERS.customer, "customer");

  const db = getDb();
  const [profile] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, customerId));
  if (!profile) {
    const key = `licences/${customerId}/sample-licence.png`;
    await getStorage().put(key, SAMPLE_PNG, "image/png");
    await db.insert(driverProfiles).values({
      userId: customerId,
      fullName: SEED_USERS.customer.name,
      phone: "+971 50 123 4567",
      dateOfBirth: "1990-04-12",
      nationality: "United Arab Emirates",
      licenceNumber: "DXB-1234567",
      licenceCountry: "United Arab Emirates",
      licenceExpiry: "2030-04-12",
      licenceFileKey: key,
      verifiedAt: new Date(),
    });
  }

  const existing = await db.select({ id: reservations.id }).from(reservations).where(like(reservations.idempotencyKey, "seed:%")).limit(1);
  const created = existing.length ? 0 : await seedReservations({ customerId, adminId });

  const counts = await db.execute<{ t: string; n: string }>(sql`
    SELECT 'branches' t, count(*)::text n FROM branches UNION ALL
    SELECT 'vehicles', count(*)::text FROM vehicles UNION ALL
    SELECT 'extras', count(*)::text FROM extras UNION ALL
    SELECT 'pricing_rules', count(*)::text FROM pricing_rules UNION ALL
    SELECT 'reservations', count(*)::text FROM reservations`);
  console.log(
    JSON.stringify({
      msg: "seed complete",
      ms: Date.now() - started,
      reservationsCreated: created,
      counts: Object.fromEntries(counts.rows.map((r) => [r.t, Number(r.n)])),
      users: { admin: SEED_USERS.admin.email, customer: SEED_USERS.customer.email },
    }),
  );
}

main()
  .catch((err) => {
    console.error(JSON.stringify({ msg: "seed failed", error: String(err?.stack ?? err) }));
    process.exitCode = 1;
  })
  .finally(() => closeDb());

/**
 * Future reservations for the sample customer, created through the real reservation,
 * payment and admin flows (so fake-provider charges/deposits exist for refunds):
 * two confirmed bookings, one one-way with extras, one pending hold, one car on rent
 * now (checked out, ready for an admin check-in) and a maintenance block.
 */
async function seedReservations(ctx: { customerId: string; adminId: string }): Promise<number> {
  const { createReservationTx } = await import("../src/server/reservations/service");
  const { payReservation } = await import("../src/server/payments/service");
  const { adminCheckOut, adminCreateMaintenanceBlock } = await import("../src/server/admin");
  const db = getDb();
  const branchId = async (code: string) => (await db.select().from(branches).where(eq(branches.code, code)))[0].id;
  const vehicleId = async (plate: string) => (await db.select().from(vehicles).where(eq(vehicles.plateNumber, plate)))[0].id;
  const extraId = async (code: string) => (await db.select().from(extras).where(eq(extras.code, code)))[0].id;
  /** Local Asia/Dubai 10:00 on today + n days, as UTC. */
  const dubai10 = (n: number) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n, 6, 0, 0));
  };
  const DAY = 86_400_000;
  let count = 0;
  const book = async (plate: string, pickup: string, ret: string, startDays: number, days: number, extraCodes: string[], pay: boolean) => {
    const pickupAt = dubai10(startDays);
    const r = await createReservationTx(ctx.customerId, {
      vehicleId: await vehicleId(plate),
      pickupBranchId: await branchId(pickup),
      returnBranchId: await branchId(ret),
      pickupAt,
      returnAt: new Date(pickupAt.getTime() + days * DAY),
      extras: await Promise.all(extraCodes.map(async (c) => ({ extraId: await extraId(c), quantity: 1 }))),
      idempotencyKey: `seed:${plate}:${startDays}`,
    });
    if (pay) {
      const p = await payReservation(ctx.customerId, r.reservationId, { attemptId: `seed-${r.reference}` });
      if (!p.ok) throw new Error(`seed payment failed: ${p.message}`);
    }
    count++;
    return r;
  };

  await book("Dubai C 31905", "DXB-APT", "DXB-APT", 7, 3, ["gps"], true);
  await book("Dubai H 41206", "DXB-MAR", "AUH-CTY", 14, 5, ["child_seat", "full_insurance"], true);
  await book("Dubai L 32784", "DXB-DTN", "DXB-DTN", 21, 2, [], false); // pending hold (expires after HOLD_EXPIRY_MINUTES)

  // On rent now: pick-up in 2 h, paid, checked out by the admin.
  const soon = new Date(Date.now() + 2 * 3_600_000);
  soon.setUTCMinutes(0, 0, 0);
  const onRent = await createReservationTx(ctx.customerId, {
    vehicleId: await vehicleId("Dubai G 23390"),
    pickupBranchId: await branchId("DXB-MAR"),
    returnBranchId: await branchId("DXB-MAR"),
    pickupAt: soon,
    returnAt: new Date(soon.getTime() + 2 * DAY),
    extras: [],
    idempotencyKey: `seed:on-rent:${soon.toISOString()}`,
  });
  await payReservation(ctx.customerId, onRent.reservationId, { attemptId: `seed-${onRent.reference}` });
  const [veh] = await db.select().from(vehicles).where(eq(vehicles.plateNumber, "Dubai G 23390"));
  const co = await adminCheckOut(ctx.adminId, onRent.reservationId, { mileageKm: veh.mileageKm, fuelLevel: 8, notes: "Seed: car handed over" });
  if (!co.ok) throw new Error(`seed check-out failed: ${co.message}`);
  count++;

  const mb = await adminCreateMaintenanceBlock(ctx.adminId, {
    vehicleId: await vehicleId("Dubai E 50018"),
    startAt: dubai10(10),
    endAt: dubai10(12),
    reason: "Scheduled 10,000 km service",
  });
  if (!mb.ok) throw new Error(`seed maintenance failed: ${mb.message}`);
  return count;
}
