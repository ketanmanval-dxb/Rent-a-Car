"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth";
import { adminCreateDamageReport } from "@/server/admin";
import { failure, formValues, fromFailure, validationFailure } from "@/app/_lib/action-result";
import type { ActionState } from "@/lib/action-state";
import { optionalAedToFils } from "../_lib";

/** One image per request: hosting caps request bodies at ~4.5 MB. */
const IMAGE_LIMIT_BYTES = 4 * 1024 * 1024;

const damageSchema = z.object({
  vehicleId: z.uuid("Choose a vehicle"),
  reservationId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
  stage: z.enum(["PICKUP", "RETURN", "OTHER"]),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR"], "Choose a severity"),
  description: z.string().trim().min(3, "Describe the damage").max(4000),
  estimatedCost: optionalAedToFils,
});

const imageSchema = z
  .instanceof(File)
  .refine((f) => f.size <= IMAGE_LIMIT_BYTES, "Images must be 4 MB or smaller")
  .refine((f) => f.type === "" || ["image/jpeg", "image/png"].includes(f.type), "Upload a JPG or PNG image");

const FIELDS = ["vehicleId", "reservationId", "stage", "severity", "description", "estimatedCost"];

export async function createDamageReportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData, FIELDS);
  const parsed = damageSchema.safeParse(values);
  if (!parsed.success) return validationFailure(parsed.error, values);

  const raw = formData.get("image");
  let image: File | undefined;
  if (raw instanceof File && raw.size > 0) {
    const img = imageSchema.safeParse(raw);
    if (!img.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { image: [img.error.issues[0].message] }, values };
    image = img.data;
  }

  try {
    const admin = await assertAdmin();
    const d = parsed.data;
    const res = await adminCreateDamageReport(admin.id, {
      vehicleId: d.vehicleId,
      reservationId: d.reservationId ?? null,
      stage: d.stage,
      severity: d.severity,
      description: d.description,
      estimatedCostFils: d.estimatedCost ?? 0,
      images: image ? [{ bytes: new Uint8Array(await image.arrayBuffer()), contentType: image.type, filename: image.name }] : [],
    });
    if (!res.ok) return fromFailure(res, values);
  } catch (err) {
    return failure(err, values);
  }
  refresh();
  return { ok: true, message: "Damage report saved." };
}
