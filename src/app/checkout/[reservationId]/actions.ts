"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertUser } from "@/server/auth";
import { payReservation } from "@/server/payments";
import { cancelReservation } from "@/server/reservations";
import { errorMessage } from "@/app/_lib/action-result";

const payInput = z.object({
  reservationId: z.uuid(),
  attemptId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  simulate: z.enum(["succeed", "fail", "cancel"]),
  depositSimulate: z.enum(["succeed", "fail", "cancel"]),
});

export type PayState = { message?: string; code?: string; attemptId?: string };

export async function payAction(_prev: PayState, formData: FormData): Promise<PayState> {
  const parsed = payInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { message: "Invalid payment request. Please reload the page.", attemptId: randomUUID() };
  const { reservationId, attemptId, simulate, depositSimulate } = parsed.data;
  let outcome: "confirmed" | "already" | PayState;
  try {
    const user = await assertUser();
    const res = await payReservation(user.id, reservationId, { attemptId, simulate, depositSimulate });
    if (res.ok) outcome = "confirmed";
    else if (res.code === "ALREADY_PAID") outcome = "already";
    // A failed or cancelled attempt is final for its attemptId: retry with a new one.
    else outcome = { message: res.message, code: res.code, attemptId: randomUUID() };
  } catch (err) {
    // Unknown errors (e.g. network) may be retried with the SAME attemptId so the provider dedupes.
    return { message: errorMessage(err, "Payment could not be completed. Please try again."), attemptId };
  }
  if (outcome === "confirmed") redirect(`/rentals/${reservationId}/voucher?confirmed=1`);
  if (outcome === "already") redirect(`/rentals/${reservationId}/voucher`);
  return outcome;
}

export async function abandonAction(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get("reservationId"));
  if (!id.success) redirect("/rentals");
  const user = await assertUser();
  const res = await cancelReservation(user.id, id.data);
  if (!res.ok) redirect(`/rentals/${id.data}?error=${encodeURIComponent(res.message)}`);
  redirect(`/rentals/${id.data}?cancelled=1`);
}
