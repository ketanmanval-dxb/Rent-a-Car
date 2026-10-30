// Shared server-action result helpers (server-side only).
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { isAppError } from "@/server/lib/errors";

import type { ActionState } from "@/lib/action-state";

export type { ActionState };

export function formValues(formData: FormData, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = formData.get(k);
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function validationFailure<T>(error: z.ZodError, values?: Record<string, string>): ActionState<T> {
  return {
    ok: false,
    message: "Please fix the highlighted fields.",
    fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[] | undefined>,
    values,
  };
}

/** Map thrown errors to a user-safe message. Re-throws Next.js control-flow errors (redirect/notFound). */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  unstable_rethrow(err);
  if (isAppError(err)) return err.message;
  const anyErr = err as { body?: { message?: string }; message?: string; status?: string | number; statusCode?: number };
  // Better Auth APIError carries a safe message in body.message.
  if (anyErr && typeof anyErr === "object" && anyErr.body?.message) return anyErr.body.message;
  console.error(err);
  return fallback;
}

export function failure<T>(err: unknown, values?: Record<string, string>, fallback?: string): ActionState<T> {
  unstable_rethrow(err);
  return { ok: false, message: errorMessage(err, fallback), values };
}

/** Only allow same-site relative redirects from ?next=. */
export function safeNext(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** Convert a db `Failure` ({ ok:false, code, message, fieldErrors? }) into form state. */
export function fromFailure<T>(
  f: { message: string; code?: string; fieldErrors?: Record<string, string> },
  values?: Record<string, string>,
): ActionState<T> {
  const fieldErrors = f.fieldErrors
    ? Object.fromEntries(Object.entries(f.fieldErrors).map(([k, v]) => [k, [v]]))
    : undefined;
  return { ok: false, message: f.message, fieldErrors, values };
}
