// CLI for the fake payment provider (local test mode).
//
//   pnpm fake-pay events                 list recorded events
//   pnpm fake-pay redeliver <eventId> [n] re-send an event n times (duplicate webhooks)
//   pnpm fake-pay reset                  delete all fake payment state

import { rm } from "node:fs/promises";
import path from "node:path";
import { FakePaymentProvider } from "../src/server/payments/fake-provider";

const stateFile = path.resolve(process.env.FAKE_PAYMENT_STATE_FILE ?? "./storage/fake-payments/state.json");
const provider = new FakePaymentProvider({
  stateFile,
  webhookSecret: process.env.FAKE_PAYMENT_WEBHOOK_SECRET ?? "",
  webhookUrl: process.env.FAKE_PAYMENT_WEBHOOK_URL || undefined,
});

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "events":
    for (const e of await provider.listEvents()) {
      console.log(`${e.createdAt}  ${e.id}  ${e.type.padEnd(18)}  ${e.data.id}  ${e.data.amountMinor}`);
    }
    break;
  case "redeliver": {
    const [eventId, times] = rest;
    if (!eventId) throw new Error("Usage: pnpm fake-pay redeliver <eventId> [times]");
    if (!process.env.FAKE_PAYMENT_WEBHOOK_URL) throw new Error("FAKE_PAYMENT_WEBHOOK_URL is not set");
    console.log("HTTP statuses:", await provider.redeliver(eventId, Number(times ?? 1)));
    break;
  }
  case "reset":
    await rm(stateFile, { force: true });
    console.log(`Removed ${stateFile}`);
    break;
  default:
    console.log("Commands: events | redeliver <eventId> [times] | reset");
}
