// Per-worker isolation for side effects outside the DB: fake payment state and
// uploads go to a temp dir, and webhooks are not POSTed anywhere during vitest.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "driveeasy-qa-"));
process.env.FAKE_PAYMENT_STATE_FILE = path.join(dir, "fake-payments.json");
process.env.FAKE_PAYMENT_WEBHOOK_URL = "";
process.env.FAKE_PAYMENT_WEBHOOK_DELIVERIES = "1";
process.env.LOCAL_UPLOADS_DIR = path.join(dir, "uploads");
process.env.FAKE_PAYMENT_WEBHOOK_SECRET ||= "qa-test-webhook-secret";
process.env.CRON_SECRET ||= "qa-test-cron-secret";
// Fixtures book far-future windows (2031-2095) so runs never collide; lift the 365-day booking limit.
process.env.BOOKING_MAX_ADVANCE_DAYS = "36500";
