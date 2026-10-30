"use server";

import { z } from "zod";
import { adminCancelReservation, adminChargeDamage, adminCheckIn, adminCheckOut } from "@/server/admin";
import { formatAED } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";
import { aedToFils, checkbox, intField, optionalText, runAdminAction } from "../../_lib";

const checkOutSchema = z.object({
  reservationId: z.uuid(),
  mileageKm: intField(0, 2_000_000),
  fuelLevel: intField(0, 8),
  notes: optionalText.pipe(z.string().max(2000).optional()),
});

export async function checkOutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAdminAction(
    formData,
    checkOutSchema,
    (adminId, d) => adminCheckOut(adminId, d.reservationId, { mileageKm: d.mileageKm, fuelLevel: d.fuelLevel, notes: d.notes }),
    "Vehicle checked out. The rental is now on the road.",
  );
}

const checkInSchema = z.object({
  reservationId: z.uuid(),
  mileageKm: intField(0, 2_000_000),
  fuelLevel: intField(0, 8),
  notes: optionalText.pipe(z.string().max(2000).optional()),
  holdDeposit: checkbox,
  needsMaintenance: checkbox,
});

export async function checkInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAdminAction(
    formData,
    checkInSchema,
    (adminId, d) =>
      adminCheckIn(adminId, d.reservationId, {
        mileageKm: d.mileageKm,
        fuelLevel: d.fuelLevel,
        notes: d.notes,
        holdDeposit: d.holdDeposit,
        needsMaintenance: d.needsMaintenance,
      }),
    (r) => {
      const parts = ["Vehicle checked in."];
      if (r.lateFeeFils > 0) parts.push(`Late return ${r.lateMinutes} min: ${formatAED(r.lateFeeFils)}.`);
      if (r.fuelChargeFils > 0) parts.push(`Fuel charge ${formatAED(r.fuelChargeFils)}.`);
      const failed = r.charges.filter((c) => c.status === "FAILED");
      if (failed.length) parts.push(`${failed.length} extra charge(s) failed; follow up with the customer.`);
      parts.push(r.depositReleased ? "Deposit released." : "Deposit kept on hold.");
      return parts.join(" ");
    },
  );
}

const cancelSchema = z.object({
  reservationId: z.uuid(),
  reason: optionalText.pipe(z.string().max(500).optional()),
  waiveFee: checkbox,
});

export async function adminCancelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAdminAction(
    formData,
    cancelSchema,
    (adminId, d) => adminCancelReservation(adminId, d.reservationId, { reason: d.reason, waiveFee: d.waiveFee }),
    (r) => `Booking cancelled.${r.refundFils > 0 ? ` Refunded ${formatAED(r.refundFils)}.` : ""}`,
  );
}

const chargeSchema = z.object({ reportId: z.uuid(), amount: aedToFils.pipe(z.number().int().positive("Enter an amount above 0")) });

export async function chargeDamageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAdminAction(
    formData,
    chargeSchema,
    (adminId, d) => adminChargeDamage(adminId, d.reportId, d.amount),
    (r) => `Captured ${formatAED(r.capturedFils)} from the deposit.`,
  );
}
