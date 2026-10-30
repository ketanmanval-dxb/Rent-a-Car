import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Charge,
  CreateChargeInput,
  DepositHold,
  HoldDepositInput,
  PaymentEvent,
  PaymentEventType,
  PaymentProvider,
} from "./types";
import { SIGNATURE_HEADER, signPayload, verifySignature } from "./webhook-signature";

// Local test-mode payment provider. State lives in a JSON file so the Next.js
// server, CLI scripts and tests all see the same charges and deposits.
// Outcomes are driven by `simulate` ("succeed" | "fail" | "cancel").

interface FakeState {
  charges: Record<string, Charge>;
  deposits: Record<string, DepositHold>;
  /** idempotencyKey -> object id (charges, refunds and deposits share the namespace) */
  idempotency: Record<string, string>;
  events: PaymentEvent[];
}

export interface FakeProviderOptions {
  stateFile: string;
  webhookSecret: string;
  /** Where to POST webhook events. Unset = record events only (tests). */
  webhookUrl?: string;
  /** Deliver every webhook this many times (2+ simulates duplicate delivery). */
  deliveriesPerEvent?: number;
  fetchImpl?: typeof fetch;
}

const emptyState = (): FakeState => ({ charges: {}, deposits: {}, idempotency: {}, events: [] });

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: FakeProviderOptions) {}

  async createCharge(input: CreateChargeInput): Promise<Charge> {
    assertAmount(input.amountMinor);
    const { charge, event } = await this.mutate((s) => {
      const existing = lookup(s, input.idempotencyKey, s.charges);
      if (existing) return { charge: existing, event: null };

      const outcome = input.simulate ?? "succeed";
      const charge: Charge = {
        id: `ch_fake_${randomUUID()}`,
        status: outcome === "succeed" ? "succeeded" : outcome === "fail" ? "failed" : "cancelled",
        amountMinor: input.amountMinor,
        refundedMinor: 0,
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        failureReason: outcome === "fail" ? "card_declined" : outcome === "cancel" ? "cancelled_by_customer" : undefined,
        createdAt: new Date().toISOString(),
      };
      s.charges[charge.id] = charge;
      s.idempotency[input.idempotencyKey] = charge.id;
      const type: PaymentEventType =
        outcome === "succeed" ? "charge.succeeded" : outcome === "fail" ? "charge.failed" : "charge.cancelled";
      return { charge, event: recordEvent(s, type, charge) };
    });
    if (event) await this.deliver(event);
    return charge;
  }

  async getCharge(chargeId: string): Promise<Charge | null> {
    return (await this.read()).charges[chargeId] ?? null;
  }

  async refundCharge(chargeId: string, opts: { idempotencyKey: string; amountMinor?: number }): Promise<Charge> {
    const { charge, event } = await this.mutate((s) => {
      const charge = s.charges[chargeId];
      if (!charge) throw new Error(`Unknown charge ${chargeId}`);
      if (s.idempotency[opts.idempotencyKey]) return { charge, event: null };
      if (charge.status !== "succeeded" && charge.status !== "partially_refunded") {
        throw new Error(`Charge ${chargeId} is ${charge.status} and cannot be refunded`);
      }
      const remaining = charge.amountMinor - charge.refundedMinor;
      const amount = opts.amountMinor ?? remaining;
      assertAmount(amount);
      if (amount > remaining) throw new Error(`Refund ${amount} exceeds refundable ${remaining}`);

      charge.refundedMinor += amount;
      charge.status = charge.refundedMinor === charge.amountMinor ? "refunded" : "partially_refunded";
      s.idempotency[opts.idempotencyKey] = charge.id;
      return { charge, event: recordEvent(s, "charge.refunded", charge) };
    });
    if (event) await this.deliver(event);
    return charge;
  }

  async holdDeposit(input: HoldDepositInput): Promise<DepositHold> {
    assertAmount(input.amountMinor);
    const { deposit, event } = await this.mutate((s) => {
      const existing = lookup(s, input.idempotencyKey, s.deposits);
      if (existing) return { deposit: existing, event: null };

      const ok = (input.simulate ?? "succeed") === "succeed";
      const deposit: DepositHold = {
        id: `dep_fake_${randomUUID()}`,
        status: ok ? "held" : "failed",
        amountMinor: input.amountMinor,
        capturedMinor: 0,
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        failureReason: ok ? undefined : input.simulate === "cancel" ? "cancelled_by_customer" : "insufficient_funds",
        createdAt: new Date().toISOString(),
      };
      s.deposits[deposit.id] = deposit;
      s.idempotency[input.idempotencyKey] = deposit.id;
      return { deposit, event: recordEvent(s, ok ? "deposit.held" : "deposit.failed", deposit) };
    });
    if (event) await this.deliver(event);
    return deposit;
  }

  async getDeposit(depositId: string): Promise<DepositHold | null> {
    return (await this.read()).deposits[depositId] ?? null;
  }

  async releaseDeposit(depositId: string): Promise<DepositHold> {
    const { deposit, event } = await this.mutate((s) => {
      const deposit = s.deposits[depositId];
      if (!deposit) throw new Error(`Unknown deposit ${depositId}`);
      if (deposit.status === "released") return { deposit, event: null };
      if (deposit.status !== "held") throw new Error(`Deposit ${depositId} is ${deposit.status} and cannot be released`);
      deposit.status = "released";
      return { deposit, event: recordEvent(s, "deposit.released", deposit) };
    });
    if (event) await this.deliver(event);
    return deposit;
  }

  async captureDeposit(depositId: string, amountMinor: number): Promise<DepositHold> {
    assertAmount(amountMinor);
    const { deposit, event } = await this.mutate((s) => {
      const deposit = s.deposits[depositId];
      if (!deposit) throw new Error(`Unknown deposit ${depositId}`);
      if (deposit.status !== "held") throw new Error(`Deposit ${depositId} is ${deposit.status} and cannot be captured`);
      if (amountMinor > deposit.amountMinor) throw new Error(`Capture ${amountMinor} exceeds hold ${deposit.amountMinor}`);
      deposit.status = "captured";
      deposit.capturedMinor = amountMinor;
      return { deposit, event: recordEvent(s, "deposit.captured", deposit) };
    });
    if (event) await this.deliver(event);
    return deposit;
  }

  verifyWebhook(rawBody: string, signatureHeader: string | null): PaymentEvent {
    verifySignature(rawBody, signatureHeader, this.opts.webhookSecret);
    return JSON.parse(rawBody) as PaymentEvent;
  }

  // ---- test / CLI helpers (not part of PaymentProvider) ----

  async listEvents(): Promise<PaymentEvent[]> {
    return (await this.read()).events;
  }

  /** Re-send a past event (same event id), e.g. to test duplicate delivery or retries. */
  async redeliver(eventId: string, times = 1): Promise<number[]> {
    const event = (await this.read()).events.find((e) => e.id === eventId);
    if (!event) throw new Error(`Unknown event ${eventId}`);
    return this.deliver(event, times);
  }

  async deliver(event: PaymentEvent, times = this.opts.deliveriesPerEvent ?? 1): Promise<number[]> {
    if (!this.opts.webhookUrl) return [];
    const doFetch = this.opts.fetchImpl ?? fetch;
    const body = JSON.stringify(event);
    const statuses: number[] = [];
    for (let i = 0; i < times; i++) {
      try {
        const res = await doFetch(this.opts.webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signPayload(body, this.opts.webhookSecret) },
          body,
        });
        statuses.push(res.status);
      } catch {
        statuses.push(0); // app not running; event stays in state for redelivery
      }
    }
    return statuses;
  }

  // ---- state file ----

  private async read(): Promise<FakeState> {
    try {
      return JSON.parse(await readFile(this.opts.stateFile, "utf8")) as FakeState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw err;
    }
  }

  /** Serialised read-modify-write so concurrent calls in one process can't clobber each other. */
  private mutate<T>(fn: (s: FakeState) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const state = await this.read();
      const result = fn(state);
      await mkdir(path.dirname(this.opts.stateFile), { recursive: true });
      const tmp = `${this.opts.stateFile}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state, null, 2));
      await rename(tmp, this.opts.stateFile);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function lookup<T>(s: FakeState, key: string, table: Record<string, T>): T | undefined {
  const id = s.idempotency[key];
  return id ? table[id] : undefined;
}

function recordEvent(s: FakeState, type: PaymentEventType, data: Charge | DepositHold): PaymentEvent {
  const event: PaymentEvent = { id: `evt_fake_${randomUUID()}`, type, createdAt: new Date().toISOString(), data: structuredClone(data) };
  s.events.push(event);
  return event;
}

function assertAmount(amountMinor: number) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(`Amount must be a positive integer in minor units, got ${amountMinor}`);
  }
}
