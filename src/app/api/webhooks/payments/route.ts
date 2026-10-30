import { handlePaymentWebhook } from "@/server/payments/service";
import { logger } from "@/server/lib/logger";
import { SIGNATURE_HEADER } from "@/server/payments/webhook-signature";

// Payment provider webhooks. Signature verified (HMAC, timestamp tolerance), events
// deduped by event id, and status synced from the provider before confirming.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER);
  let outcome;
  try {
    outcome = await handlePaymentWebhook(rawBody, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/signature|Malformed|tolerance/i.test(message)) {
      logger.warn("webhook rejected", { reason: message });
      return Response.json({ error: { code: "INVALID_SIGNATURE", message: "Invalid signature" } }, { status: 400 });
    }
    if (err instanceof SyntaxError) return Response.json({ error: { code: "INVALID", message: "Invalid JSON" } }, { status: 400 });
    logger.error("webhook processing failed", { err });
    // 500 => provider retries; the dedupe marker was rolled back with the failed transaction.
    return Response.json({ error: { code: "INTERNAL", message: "Processing failed" } }, { status: 500 });
  }
  return Response.json({ received: true, duplicate: outcome.duplicate, eventId: outcome.eventId });
}
