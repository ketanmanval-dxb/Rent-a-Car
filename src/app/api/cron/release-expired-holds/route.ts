import { isAuthorizedCronRequest } from "@/server/cron/auth";
import { errorResponse } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { releaseExpiredHolds } from "@/server/reservations/service";

// Scheduled job (vercel.json "crons" / `pnpm cron`). Idempotent: expires PENDING holds
// whose hold_expires_at has passed; a repeat run finds nothing to do.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    logger.warn("cron unauthorized", { job: "release-expired-holds" });
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized" } }, { status: 401 });
  }
  const started = Date.now();
  try {
    const result = await releaseExpiredHolds();
    logger.info("cron job finished", { job: "release-expired-holds", expired: result.expired, ms: Date.now() - started });
    return Response.json({ ok: true, expired: result.expired, refundedFils: result.refunded, reservationIds: result.reservationIds });
  } catch (err) {
    return errorResponse(err, { job: "release-expired-holds" });
  }
}
