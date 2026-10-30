import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakePaymentProvider } from "@/server/payments/fake-provider";
import { signPayload } from "@/server/payments/webhook-signature";

const SECRET = "test-webhook-secret";
let dir: string;
let delivered: { body: string; signature: string | null }[];
let provider: FakePaymentProvider;

const fakeFetch: typeof fetch = async (_url, init) => {
  delivered.push({ body: String(init?.body), signature: new Headers(init?.headers).get("x-driveeasy-signature") });
  return new Response(null, { status: 200 });
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fakepay-"));
  delivered = [];
  provider = new FakePaymentProvider({
    stateFile: path.join(dir, "state.json"),
    webhookSecret: SECRET,
    webhookUrl: "http://localhost/webhook",
    fetchImpl: fakeFetch,
  });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("FakePaymentProvider charges", () => {
  it("succeeds, fails and cancels on request", async () => {
    expect((await provider.createCharge({ amountMinor: 100, currency: "AED", idempotencyKey: "a" })).status).toBe("succeeded");
    expect((await provider.createCharge({ amountMinor: 100, currency: "AED", idempotencyKey: "b", simulate: "fail" })).status).toBe("failed");
    expect((await provider.createCharge({ amountMinor: 100, currency: "AED", idempotencyKey: "c", simulate: "cancel" })).status).toBe("cancelled");
  });

  it("is idempotent: retrying with the same key returns the same charge and sends no new webhook", async () => {
    const first = await provider.createCharge({ amountMinor: 5000, currency: "AED", idempotencyKey: "res-1" });
    const retry = await provider.createCharge({ amountMinor: 5000, currency: "AED", idempotencyKey: "res-1" });
    expect(retry.id).toBe(first.id);
    expect(delivered).toHaveLength(1);
  });

  it("handles concurrent retries with one key as a single charge", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => provider.createCharge({ amountMinor: 700, currency: "AED", idempotencyKey: "race" })),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
  });

  it("refunds partially then fully, and rejects over-refunds", async () => {
    const ch = await provider.createCharge({ amountMinor: 1000, currency: "AED", idempotencyKey: "r" });
    expect((await provider.refundCharge(ch.id, { idempotencyKey: "r1", amountMinor: 400 })).status).toBe("partially_refunded");
    await expect(provider.refundCharge(ch.id, { idempotencyKey: "r2", amountMinor: 700 })).rejects.toThrow(/exceeds/);
    const full = await provider.refundCharge(ch.id, { idempotencyKey: "r3" });
    expect(full).toMatchObject({ status: "refunded", refundedMinor: 1000 });
  });

  it("rejects non-integer or non-positive amounts", async () => {
    await expect(provider.createCharge({ amountMinor: 10.5, currency: "AED", idempotencyKey: "x" })).rejects.toThrow();
    await expect(provider.createCharge({ amountMinor: 0, currency: "AED", idempotencyKey: "y" })).rejects.toThrow();
  });
});

describe("FakePaymentProvider deposits", () => {
  it("holds and releases; a second release is a no-op", async () => {
    const dep = await provider.holdDeposit({ amountMinor: 150000, currency: "AED", idempotencyKey: "d" });
    expect(dep.status).toBe("held");
    expect((await provider.releaseDeposit(dep.id)).status).toBe("released");
    expect((await provider.releaseDeposit(dep.id)).status).toBe("released");
    expect(delivered.map((d) => JSON.parse(d.body).type)).toEqual(["deposit.held", "deposit.released"]);
  });

  it("captures part of a hold for damage", async () => {
    const dep = await provider.holdDeposit({ amountMinor: 150000, currency: "AED", idempotencyKey: "d2" });
    expect(await provider.captureDeposit(dep.id, 40000)).toMatchObject({ status: "captured", capturedMinor: 40000 });
    await expect(provider.releaseDeposit(dep.id)).rejects.toThrow();
  });

  it("fails a hold on request", async () => {
    expect((await provider.holdDeposit({ amountMinor: 1, currency: "AED", idempotencyKey: "d3", simulate: "fail" })).status).toBe("failed");
  });
});

describe("FakePaymentProvider webhooks", () => {
  it("signs deliveries so verifyWebhook accepts them", async () => {
    await provider.createCharge({ amountMinor: 100, currency: "AED", idempotencyKey: "w" });
    const [{ body, signature }] = delivered;
    expect(provider.verifyWebhook(body, signature).type).toBe("charge.succeeded");
  });

  it("rejects missing, forged and stale signatures", () => {
    const body = JSON.stringify({ id: "evt", type: "charge.succeeded" });
    expect(() => provider.verifyWebhook(body, null)).toThrow(/Missing/);
    expect(() => provider.verifyWebhook(body, signPayload(body, "wrong-secret"))).toThrow(/Invalid/);
    expect(() => provider.verifyWebhook(body, signPayload(body, SECRET, Math.floor(Date.now() / 1000) - 3600))).toThrow(/tolerance/);
  });

  it("redelivers duplicates with the same event id", async () => {
    await provider.createCharge({ amountMinor: 100, currency: "AED", idempotencyKey: "dup" });
    const [event] = await provider.listEvents();
    await provider.redeliver(event.id, 2);
    expect(delivered).toHaveLength(3);
    expect(new Set(delivered.map((d) => JSON.parse(d.body).id))).toEqual(new Set([event.id]));
  });
});
