import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbOrTx } from "@/server/db";
import { auditLogs, driverProfiles } from "@/server/db/schema";
import { AppError, toResult, type Result } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { getStorage } from "@/server/storage";

export const MIN_DRIVER_AGE = 21;
/** Vercel Functions reject request bodies over 4.5 MB, so uploads are capped at 4 MB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_LICENCE_BYTES = MAX_UPLOAD_BYTES;
export const MAX_DAMAGE_IMAGE_BYTES = MAX_UPLOAD_BYTES;
const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
} as const;

export interface DriverProfile {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  nationality: string | null;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiry: string;
  licenceFileKey: string | null;
  licenceUploadedAt: Date | null;
  verifiedAt: Date | null;
  /** All fields present, licence uploaded and not expired, driver old enough. */
  complete: boolean;
  missing: string[];
}

const today = () => new Date().toISOString().slice(0, 10);

function yearsBetween(dob: string, on: string): number {
  const [y1, m1, d1] = dob.split("-").map(Number);
  const [y2, m2, d2] = on.split("-").map(Number);
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
}

function missingFields(p: typeof driverProfiles.$inferSelect): string[] {
  const missing: string[] = [];
  if (!p.licenceFileKey) missing.push("licenceFile");
  if (p.licenceExpiry <= today()) missing.push("licenceExpiry");
  if (yearsBetween(p.dateOfBirth, today()) < MIN_DRIVER_AGE) missing.push("dateOfBirth");
  return missing;
}

function toDto(p: typeof driverProfiles.$inferSelect): DriverProfile {
  const missing = missingFields(p);
  return {
    id: p.id,
    userId: p.userId,
    fullName: p.fullName,
    phone: p.phone,
    dateOfBirth: p.dateOfBirth,
    nationality: p.nationality,
    licenceNumber: p.licenceNumber,
    licenceCountry: p.licenceCountry,
    licenceExpiry: p.licenceExpiry,
    licenceFileKey: p.licenceFileKey,
    licenceUploadedAt: p.licenceFileKey ? p.updatedAt : null,
    verifiedAt: p.verifiedAt,
    complete: missing.length === 0,
    missing,
  };
}

export async function getDriverProfile(userId: string, db: DbOrTx = getDb()): Promise<DriverProfile | null> {
  const [row] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, userId));
  return row ? toDto(row) : null;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const driverProfileSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter the driver's full name").max(100),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number, e.g. +971 50 123 4567"),
    dateOfBirth: isoDate,
    nationality: z.string().trim().max(60).optional().nullable(),
    licenceNumber: z.string().trim().min(3, "Enter the licence number").max(40),
    licenceCountry: z.string().trim().min(2, "Enter the issuing country").max(60),
    licenceExpiry: isoDate,
  })
  .superRefine((v, ctx) => {
    if (yearsBetween(v.dateOfBirth, today()) < MIN_DRIVER_AGE) {
      ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: `Drivers must be at least ${MIN_DRIVER_AGE} years old` });
    }
    if (v.licenceExpiry <= today()) {
      ctx.addIssue({ code: "custom", path: ["licenceExpiry"], message: "The licence has expired" });
    }
  });

export type DriverProfileInput = z.input<typeof driverProfileSchema>;

export async function upsertDriverProfile(userId: string, input: DriverProfileInput): Promise<Result<{ profile: DriverProfile }>> {
  return toResult(async () => {
    const data = driverProfileSchema.parse(input);
    const db = getDb();
    const values = { ...data, nationality: data.nationality || null };
    const [row] = await db
      .insert(driverProfiles)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: driverProfiles.userId, set: { ...values, verifiedAt: null } })
      .returning();
    await db.insert(auditLogs).values({ actorUserId: userId, action: "driver_profile.updated", entityType: "driver_profile", entityId: row.id });
    return { profile: toDto(row) };
  }, { op: "upsertDriverProfile", userId });
}

/** Detect the real file type from magic bytes (don't trust the browser's content type). */
export function sniffFileType(bytes: Uint8Array): keyof typeof ALLOWED_TYPES | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

export function assertUpload(bytes: Uint8Array, opts: { allowPdf?: boolean; maxBytes?: number } = {}) {
  const max = opts.maxBytes ?? MAX_LICENCE_BYTES;
  if (!bytes.byteLength) throw new AppError("INVALID", "The file is empty.");
  if (bytes.byteLength > max) throw new AppError("INVALID", `Files must be ${Math.round(max / 1024 / 1024)} MB or smaller.`);
  const type = sniffFileType(bytes);
  if (!type || (type === "application/pdf" && opts.allowPdf === false)) {
    throw new AppError("INVALID", opts.allowPdf === false ? "Upload a JPG or PNG image." : "Upload a JPG, PNG or PDF file.");
  }
  return { contentType: type, ext: ALLOWED_TYPES[type] };
}

/** Store a licence scan privately and attach it to the user's driver profile (profile must exist). */
export async function uploadLicence(
  userId: string,
  file: { bytes: Uint8Array; contentType?: string; filename?: string },
): Promise<Result<{ licenceFileKey: string }>> {
  return toResult(async () => {
    const { contentType, ext } = assertUpload(file.bytes);
    const db = getDb();
    const [profile] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, userId));
    if (!profile) throw new AppError("PROFILE_INCOMPLETE", "Save your driver details before uploading a licence.");

    const key = `licences/${userId}/${randomUUID()}.${ext}`;
    const storage = getStorage();
    await storage.put(key, file.bytes, contentType);
    await db.update(driverProfiles).set({ licenceFileKey: key, verifiedAt: null }).where(eq(driverProfiles.id, profile.id));
    if (profile.licenceFileKey && profile.licenceFileKey !== key) {
      await storage.delete(profile.licenceFileKey).catch((err) => logger.warn("old licence delete failed", { err }));
    }
    await db.insert(auditLogs).values({
      actorUserId: userId,
      action: "driver_profile.licence_uploaded",
      entityType: "driver_profile",
      entityId: profile.id,
      data: { contentType, size: file.bytes.byteLength },
    });
    return { licenceFileKey: key };
  }, { op: "uploadLicence", userId });
}

/** URL of the private licence route (owner: "me", admins: by user id). */
export const licenceUrl = (userId?: string) => (userId ? `/api/files/licence/${userId}` : "/api/files/licence/me");
