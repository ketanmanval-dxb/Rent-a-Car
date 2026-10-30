// Server-only helpers for admin server actions.
import { refresh } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth";
import { failure, fromFailure, validationFailure, type ActionState } from "@/app/_lib/action-result";
import { parseAEDToFils } from "@/lib/format";

type DbResult = { ok: true } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };

/**
 * Validate form data with Zod, re-check the admin role, run a db admin function,
 * and turn the Result into form state. Refreshes the page on success.
 */
export async function runAdminAction<S extends z.ZodType, R extends DbResult>(
  formData: FormData,
  schema: S,
  run: (adminId: string, data: z.output<S>) => Promise<R>,
  success: string | ((r: Extract<R, { ok: true }>) => string),
): Promise<ActionState> {
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") values[k] = v;
  const parsed = schema.safeParse(values);
  if (!parsed.success) return validationFailure(parsed.error, values);
  try {
    const admin = await assertAdmin();
    const res = await run(admin.id, parsed.data);
    if (!res.ok) return fromFailure(res, values);
    refresh();
    return { ok: true, message: typeof success === "string" ? success : success(res as Extract<R, { ok: true }>) };
  } catch (err) {
    return failure(err, values);
  }
}

// ---- Shared field parsers (form strings -> typed values) ----

export const optionalText = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().optional());

export const aedToFils = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const fils = parseAEDToFils(v);
    if (fils === null) {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 150 or 150.50" });
      return z.NEVER;
    }
    return fils;
  });

export const optionalAedToFils = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  aedToFils.optional(),
);

export const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

export const intField = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
