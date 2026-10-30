import path from "node:path";
import { FakePaymentProvider } from "./fake-provider";
import type { PaymentProvider } from "./types";

let instance: PaymentProvider | undefined;

/** Returns the provider selected by PAYMENT_PROVIDER. Server-side only. */
export function getPaymentProvider(): PaymentProvider {
  if (instance) return instance;
  const kind = process.env.PAYMENT_PROVIDER ?? "fake";
  switch (kind) {
    case "fake":
      instance = new FakePaymentProvider({
        stateFile: path.resolve(/*turbopackIgnore: true*/ process.env.FAKE_PAYMENT_STATE_FILE ?? "./storage/fake-payments/state.json"),
        webhookSecret: required("FAKE_PAYMENT_WEBHOOK_SECRET"),
        webhookUrl: process.env.FAKE_PAYMENT_WEBHOOK_URL || undefined,
        deliveriesPerEvent: Number(process.env.FAKE_PAYMENT_WEBHOOK_DELIVERIES ?? 1),
      });
      return instance;
    // case "stripe": add a StripePaymentProvider implementing PaymentProvider, using
    // PAYMENT_SECRET_KEY and PAYMENT_WEBHOOK_SECRET, then set PAYMENT_PROVIDER=stripe.
    default:
      throw new Error(`PAYMENT_PROVIDER "${kind}" is not implemented`);
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
