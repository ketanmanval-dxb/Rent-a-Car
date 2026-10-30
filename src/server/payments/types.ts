// Payment provider contract. The app only talks to this interface; the concrete
// provider is chosen by PAYMENT_PROVIDER (see ./index.ts). Amounts are integer
// minor units (fils for AED). Never import this module from client components.

export type Currency = "AED";

export type ChargeStatus = "succeeded" | "failed" | "cancelled" | "refunded" | "partially_refunded";
export type DepositStatus = "held" | "released" | "captured" | "failed" | "expired";

/** Test-mode outcome control. Real providers ignore it. */
export type SimulatedOutcome = "succeed" | "fail" | "cancel";

export interface Charge {
  id: string;
  status: ChargeStatus;
  amountMinor: number;
  refundedMinor: number;
  currency: Currency;
  idempotencyKey: string;
  metadata: Record<string, string>;
  failureReason?: string;
  createdAt: string;
}

export interface DepositHold {
  id: string;
  status: DepositStatus;
  amountMinor: number;
  capturedMinor: number;
  currency: Currency;
  idempotencyKey: string;
  metadata: Record<string, string>;
  failureReason?: string;
  createdAt: string;
}

export interface CreateChargeInput {
  amountMinor: number;
  currency: Currency;
  idempotencyKey: string;
  metadata?: Record<string, string>;
  simulate?: SimulatedOutcome;
}

export interface HoldDepositInput {
  amountMinor: number;
  currency: Currency;
  idempotencyKey: string;
  metadata?: Record<string, string>;
  simulate?: SimulatedOutcome;
}

export type PaymentEventType =
  | "charge.succeeded"
  | "charge.failed"
  | "charge.cancelled"
  | "charge.refunded"
  | "deposit.held"
  | "deposit.failed"
  | "deposit.released"
  | "deposit.captured";

export interface PaymentEvent {
  /** Unique per event; duplicate deliveries reuse the same id, so handlers must dedupe on it. */
  id: string;
  type: PaymentEventType;
  createdAt: string;
  data: Charge | DepositHold;
}

export interface PaymentProvider {
  readonly name: string;
  /** Same idempotencyKey returns the original charge instead of charging twice. */
  createCharge(input: CreateChargeInput): Promise<Charge>;
  getCharge(chargeId: string): Promise<Charge | null>;
  /** Refund all (default) or part of a succeeded charge. Idempotent per key. */
  refundCharge(chargeId: string, opts: { idempotencyKey: string; amountMinor?: number }): Promise<Charge>;
  /** Authorise (hold) a refundable security deposit without capturing it. */
  holdDeposit(input: HoldDepositInput): Promise<DepositHold>;
  getDeposit(depositId: string): Promise<DepositHold | null>;
  /** Release a held deposit in full. Releasing twice is a no-op. */
  releaseDeposit(depositId: string): Promise<DepositHold>;
  /** Capture part or all of a held deposit (e.g. damage); the rest is released. */
  captureDeposit(depositId: string, amountMinor: number): Promise<DepositHold>;
  /**
   * Verify a webhook request and return the parsed event.
   * Throws if the signature is missing, invalid or too old.
   */
  verifyWebhook(rawBody: string, signatureHeader: string | null): PaymentEvent;
}
