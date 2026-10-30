import { z } from "zod";
import { toFailure, type Result } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { getAuth } from "./auth";

// Server-side auth operations for use inside Server Actions. The nextCookies()
// plugin writes/clears the session cookie through next/headers.

// next/headers is imported lazily so modules importing this file work outside Next (tests, scripts).
const requestHeaders = async () => (await import("next/headers")).headers();

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

function authMessage(err: unknown, fallback: string): string {
  const e = err as { body?: { code?: string; message?: string }; status?: string | number };
  const code = e?.body?.code;
  if (code === "USER_ALREADY_EXISTS" || code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") return "An account with this email already exists.";
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "Incorrect email or password.";
  if (code === "PASSWORD_TOO_SHORT") return "Password must be at least 8 characters.";
  return e?.body?.message ?? fallback;
}

function isApiError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "APIError";
}

export async function signUpEmail(input: { name: string; email: string; password: string }): Promise<Result> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return toFailure(parsed.error);
  try {
    await getAuth().api.signUpEmail({ body: parsed.data, headers: await requestHeaders() });
    logger.info("auth.sign_up", { email_domain: parsed.data.email.split("@")[1] });
    return { ok: true };
  } catch (err) {
    if (isApiError(err)) return { ok: false, code: "INVALID", message: authMessage(err, "Could not create the account.") };
    return toFailure(err, { op: "signUpEmail" });
  }
}

export async function signInEmail(input: { email: string; password: string }): Promise<Result> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return toFailure(parsed.error);
  try {
    await getAuth().api.signInEmail({ body: parsed.data, headers: await requestHeaders() });
    return { ok: true };
  } catch (err) {
    if (isApiError(err)) return { ok: false, code: "UNAUTHENTICATED", message: authMessage(err, "Incorrect email or password.") };
    return toFailure(err, { op: "signInEmail" });
  }
}

export async function signOut(): Promise<Result> {
  try {
    await getAuth().api.signOut({ headers: await requestHeaders() });
    return { ok: true };
  } catch (err) {
    if (isApiError(err)) return { ok: true }; // already signed out
    return toFailure(err, { op: "signOut" });
  }
}
