import { eq } from "drizzle-orm";
import { getSessionFromHeaders, type SessionUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { damageReports, driverProfiles, reservations } from "@/server/db/schema";
import { AppError, errorResponse } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { getStorage } from "@/server/storage";

// Private file access: licences (owner or admin) and damage images (admin, or the
// customer whose reservation the report belongs to). Storage keys are never exposed;
// files stream through these checks with no-store caching.

export interface FileBody {
  body: Uint8Array;
  contentType: string;
  filename: string;
}

async function load(key: string, filename: string): Promise<FileBody> {
  const obj = await getStorage().get(key);
  if (!obj) throw new AppError("NOT_FOUND", "File not found.");
  return { body: obj.body, contentType: obj.contentType, filename };
}

/** `targetUserId` = whose licence; viewer must be that user or an admin. */
export async function getLicenceFile(viewer: SessionUser, targetUserId: string): Promise<FileBody> {
  if (viewer.id !== targetUserId && viewer.role !== "admin") throw new AppError("NOT_FOUND", "File not found.");
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) throw new AppError("NOT_FOUND", "File not found.");
  const [p] = await getDb().select({ key: driverProfiles.licenceFileKey }).from(driverProfiles).where(eq(driverProfiles.userId, targetUserId));
  if (!p?.key) throw new AppError("NOT_FOUND", "File not found.");
  const ext = p.key.split(".").pop() ?? "bin";
  return load(p.key, `licence.${ext}`);
}

export async function getDamageImage(viewer: SessionUser, reportId: string, index: number): Promise<FileBody> {
  if (!/^[0-9a-f-]{36}$/i.test(reportId) || !Number.isInteger(index) || index < 0) throw new AppError("NOT_FOUND", "File not found.");
  const [row] = await getDb()
    .select({ keys: damageReports.imageKeys, ownerId: reservations.userId })
    .from(damageReports)
    .leftJoin(reservations, eq(reservations.id, damageReports.reservationId))
    .where(eq(damageReports.id, reportId));
  if (!row || (viewer.role !== "admin" && row.ownerId !== viewer.id)) throw new AppError("NOT_FOUND", "File not found.");
  const key = row.keys[index];
  if (!key) throw new AppError("NOT_FOUND", "File not found.");
  const ext = key.split(".").pop() ?? "bin";
  return load(key, `damage-${index + 1}.${ext}`);
}

export const damageImageUrl = (reportId: string, index: number) => `/api/files/damage/${reportId}/${index}`;

/** Route-handler helper: authenticate, run the loader, stream privately. */
export async function serveFile(request: Request, loader: (viewer: SessionUser) => Promise<FileBody>, context: Record<string, unknown>): Promise<Response> {
  try {
    const session = await getSessionFromHeaders(request.headers);
    if (!session) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    const file = await loader(session.user);
    logger.info("private file served", { ...context, viewerId: session.user.id, role: session.user.role });
    return new Response(file.body as unknown as BodyInit, {
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.body.byteLength),
        "content-disposition": `inline; filename="${file.filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (err) {
    return errorResponse(err, context);
  }
}
