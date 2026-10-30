import { createHmac, timingSafeEqual } from "node:crypto";

// Signature header format: "t=<unix seconds>,v1=<hex hmac-sha256 of `${t}.${body}`>"
// (same shape as Stripe's, so handler code carries over).

export const SIGNATURE_HEADER = "x-driveeasy-signature";
const DEFAULT_TOLERANCE_SECONDS = 300;

export function signPayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

export function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  now = Math.floor(Date.now() / 1000),
): void {
  if (!header) throw new Error("Missing webhook signature");
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) throw new Error("Malformed webhook signature");
  if (Math.abs(now - timestamp) > toleranceSeconds) throw new Error("Webhook signature timestamp outside tolerance");

  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"), "hex");
  const given = Buffer.from(parts.v1, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error("Invalid webhook signature");
  }
}
