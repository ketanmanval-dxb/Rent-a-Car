"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertUser } from "@/server/auth";
import { cancelReservation, modifyReservationDates, previewDateChange } from "@/server/reservations";
import { getBranch } from "@/server/catalog";
import { toQuoteView } from "@/app/_data/quote";
import { errorMessage } from "@/app/_lib/action-result";
import { zonedToUtc } from "@/lib/format";
import type { QuoteView } from "@/lib/types";

const changeInput = z.object({
  reservationId: z.uuid(),
  pickupBranchId: z.uuid(),
  returnBranchId: z.uuid(),
  pd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a pick-up date"),
  pt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a pick-up time"),
  rd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a return date"),
  rt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a return time"),
  intent: z.enum(["preview", "confirm"]),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
});

export type ChangeState = {
  message?: string;
  success?: string;
  preview?: { quote: QuoteView; available: boolean; differenceFils: number; dueNowFils: number; key: string };
};

export async function changeDatesAction(_prev: ChangeState, formData: FormData): Promise<ChangeState> {
  const parsed = changeInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the new dates." };
  const d = parsed.data;
  try {
    const user = await assertUser();
    const [pb, rb] = await Promise.all([getBranch(d.pickupBranchId), getBranch(d.returnBranchId)]);
    if (!pb || !rb) return { message: "Branch not found." };
    const pickupAt = zonedToUtc(d.pd, d.pt, pb.timezone);
    const returnAt = zonedToUtc(d.rd, d.rt, rb.timezone);
    if (!pickupAt || !returnAt) return { message: "Enter valid dates and times." };
    if (returnAt <= pickupAt) return { message: "Return must be after pick-up." };
    const key = `${d.pd}T${d.pt}|${d.rd}T${d.rt}`;

    if (d.intent === "preview") {
      const res = await previewDateChange(user.id, d.reservationId, { pickupAt, returnAt });
      if (!res.ok) return { message: res.message };
      return {
        preview: {
          quote: toQuoteView(res.quote),
          available: res.available,
          differenceFils: res.differenceFils,
          dueNowFils: res.dueNowFils,
          key,
        },
      };
    }

    const res = await modifyReservationDates(user.id, d.reservationId, {
      pickupAt,
      returnAt,
      idempotencyKey: `${d.idempotencyKey}-${key.replace(/[^0-9]/g, "")}`,
    });
    if (!res.ok) return { message: res.message };
    refresh();
    const moved =
      res.chargedFils > 0
        ? ` We charged the difference of AED ${(res.chargedFils / 100).toFixed(2)}.`
        : res.refundedFils > 0
          ? ` We refunded AED ${(res.refundedFils / 100).toFixed(2)}.`
          : "";
    return { success: `Your dates were changed.${moved}` };
  } catch (err) {
    return { message: errorMessage(err, "We could not change your dates.") };
  }
}

export type CancelState = { message?: string };

export async function cancelAction(_prev: CancelState, formData: FormData): Promise<CancelState> {
  const id = z.uuid().safeParse(formData.get("reservationId"));
  if (!id.success) return { message: "Invalid booking." };
  const reason = z.string().max(500).optional().safeParse(formData.get("reason") || undefined);
  let ok = false;
  try {
    const user = await assertUser();
    const res = await cancelReservation(user.id, id.data, { reason: reason.success ? reason.data : undefined });
    if (!res.ok) return { message: res.message };
    ok = true;
  } catch (err) {
    return { message: errorMessage(err, "We could not cancel this booking.") };
  }
  if (ok) redirect(`/rentals/${id.data}?cancelled=1`);
  return {};
}
