"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/server/auth";
import { driverProfileSchema, uploadLicence, upsertDriverProfile, MAX_LICENCE_BYTES } from "@/server/profile";
import { failure, formValues, fromFailure, validationFailure, type ActionState } from "@/app/_lib/action-result";

const PROFILE_FIELDS = ["fullName", "phone", "dateOfBirth", "nationality", "licenceNumber", "licenceCountry", "licenceExpiry"];

export async function saveProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData, PROFILE_FIELDS);
  const parsed = driverProfileSchema.safeParse({ ...values, nationality: values.nationality || null });
  if (!parsed.success) return validationFailure(parsed.error, values);
  try {
    const user = await assertUser();
    const res = await upsertDriverProfile(user.id, parsed.data);
    if (!res.ok) return fromFailure(res, values);
  } catch (err) {
    return failure(err, values);
  }
  refresh();
  return { ok: true, message: "Driver details saved.", values };
}

/** Hosting caps request bodies at ~4.5 MB, so uploads are limited to 4 MB per file. */
const UPLOAD_LIMIT_BYTES = Math.min(MAX_LICENCE_BYTES, 4 * 1024 * 1024);

const licenceSchema = z.object({
  licence: z
    .instanceof(File, { message: "Choose a file to upload" })
    .refine((f) => f.size > 0, "Choose a file to upload")
    .refine((f) => f.size <= UPLOAD_LIMIT_BYTES, `Files must be ${UPLOAD_LIMIT_BYTES / 1024 / 1024} MB or smaller`)
    .refine(
      (f) => f.type === "" || ["image/jpeg", "image/png", "application/pdf"].includes(f.type),
      "Upload a JPG, PNG or PDF file",
    ),
});

export async function uploadLicenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = licenceSchema.safeParse({ licence: formData.get("licence") });
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    const user = await assertUser();
    const file = parsed.data.licence;
    const res = await uploadLicence(user.id, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
      filename: file.name,
    });
    if (!res.ok) return fromFailure(res);
  } catch (err) {
    return failure(err);
  }
  refresh();
  return { ok: true, message: "Licence uploaded." };
}
