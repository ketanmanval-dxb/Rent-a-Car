import { expect, test } from "@playwright/test";
import { signPayload, SIGNATURE_HEADER } from "../../../src/server/payments/webhook-signature";

// HTTP-level checks that don't depend on UI. Routes come from TASKS.md (D7, D8, D10).

const CRON = "/api/cron/release-expired-holds";
const WEBHOOK = "/api/webhooks/payments";

test.describe("cron: release expired holds", () => {
  test("rejects requests without or with a wrong CRON_SECRET", async ({ request }) => {
    expect((await request.get(CRON)).status()).toBe(401);
    expect((await request.get(CRON, { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
    expect((await request.get(CRON, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}x` } })).status()).toBe(401);
  });

  test("is idempotent with the right secret", async ({ request }) => {
    const headers = { authorization: `Bearer ${process.env.CRON_SECRET}` };
    const a = await request.get(CRON, { headers });
    const b = await request.get(CRON, { headers });
    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);
  });

  test("runs safely when called concurrently", async ({ request }) => {
    const headers = { authorization: `Bearer ${process.env.CRON_SECRET}` };
    const res = await Promise.all(Array.from({ length: 5 }, () => request.get(CRON, { headers })));
    expect(res.map((r) => r.status())).toEqual([200, 200, 200, 200, 200]);
  });
});

test.describe("payment webhook", () => {
  const secret = process.env.FAKE_PAYMENT_WEBHOOK_SECRET ?? "";
  const event = (id: string) =>
    JSON.stringify({ id, type: "charge.succeeded", createdAt: new Date().toISOString(), data: { id: "ch_fake_unknown", status: "succeeded", amountMinor: 100, refundedMinor: 0, currency: "AED", idempotencyKey: id, metadata: {}, createdAt: new Date().toISOString() } });

  test("rejects unsigned, forged and stale deliveries", async ({ request }) => {
    const body = event(`evt_qa_${Date.now()}`);
    const post = (sig?: string) =>
      request.post(WEBHOOK, { data: body, headers: { "content-type": "application/json", ...(sig ? { [SIGNATURE_HEADER]: sig } : {}) } });
    for (const res of [
      await post(),
      await post(signPayload(body, "not-the-secret")),
      await post(signPayload(body, secret, Math.floor(Date.now() / 1000) - 3600)),
    ]) {
      expect([400, 401]).toContain(res.status());
    }
  });

  test("accepts a validly signed event and tolerates duplicate delivery (2xx both times)", async ({ request }) => {
    const body = event(`evt_qa_dup_${Date.now()}`);
    const send = () => request.post(WEBHOOK, { data: body, headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signPayload(body, secret) } });
    const [a, b] = [await send(), await send()];
    expect(a.status()).toBeLessThan(300);
    expect(b.status()).toBeLessThan(300);
  });
});

test.describe("private files", () => {
  test("upload storage is not reachable as static files", async ({ request }) => {
    for (const p of ["/storage/uploads/", "/uploads/", "/licences/", "/storage/fake-payments/state.json", "/.env.local", "/.env"]) {
      const res = await request.get(p, { maxRedirects: 0 });
      expect(res.status(), p).not.toBe(200);
    }
  });

  test("API endpoints for reservations/files reject anonymous users", async ({ request }) => {
    for (const p of ["/api/files/licences/x", "/api/reservations", "/api/admin/vehicles"]) {
      const res = await request.get(p, { maxRedirects: 0 });
      // 401/403/404/redirect-to-login are all acceptable; 200 is not.
      expect(res.status(), p).not.toBe(200);
    }
  });
});
