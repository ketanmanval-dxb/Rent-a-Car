"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { assertUser } from "@/server/auth";
import { quoteRental } from "@/server/pricing";
import { createReservation } from "@/server/reservations";
import { toQuoteView } from "@/app/_data/quote";
import { errorMessage } from "@/app/_lib/action-result";
import type { QuoteView } from "@/lib/types";

const rentalInput = z.object({
  vehicleId: z.uuid(),
  pickupBranchId: z.uuid(),
  returnBranchId: z.uuid(),
  pickupAt: z.iso.datetime(),
  returnAt: z.iso.datetime(),
  extras: z
    .array(z.object({ extraId: z.uuid(), quantity: z.number().int().min(1).max(10) }))
    .max(20),
  /** One per booking page render, so a double-submit returns the same reservation. */
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/).optional(),
});

export type RentalInput = z.input<typeof rentalInput>;

export type QuoteResult = { ok: true; quote: QuoteView } | { ok: false; message: string };

/** Re-price the rental on the server whenever the customer changes extras. */
export async function quoteAction(input: RentalInput): Promise<QuoteResult> {
  const parsed = rentalInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid booking details." };
  try {
    const res = await quoteRental({
      ...parsed.data,
      pickupAt: new Date(parsed.data.pickupAt),
      returnAt: new Date(parsed.data.returnAt),
    });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true, quote: toQuoteView(res.quote) };
  } catch (err) {
    return { ok: false, message: errorMessage(err, "We could not price this rental.") };
  }
}

export type ReserveState = { message?: string; code?: string };

/** Create a PENDING reservation with a payment hold, then go to checkout. */
export async function reserveAction(_prev: ReserveState, formData: FormData): Promise<ReserveState> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { message: "Invalid booking details. Please reload the page." };
  }
  const parsed = rentalInput.safeParse(payload);
  if (!parsed.success) return { message: "Invalid booking details. Please reload the page." };

  let reservationId: string;
  try {
    const user = await assertUser();
    const res = await createReservation(user.id, {
      ...parsed.data,
      pickupAt: new Date(parsed.data.pickupAt),
      returnAt: new Date(parsed.data.returnAt),
    });
    if (!res.ok) return { message: res.message, code: res.code };
    reservationId = res.reservationId;
  } catch (err) {
    return { message: errorMessage(err, "We could not create your reservation. Please try again.") };
  }
  redirect(`/checkout/${reservationId}`);
}
