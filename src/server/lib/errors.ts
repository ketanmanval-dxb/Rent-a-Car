import { logger } from "./logger";

// Domain errors carry a stable `code` and an HTTP status. Messages are safe to
// show to end users; internal details go to logs only. Public server functions
// return `Result` objects for expected failures (see `toResult`).

export type ErrorCode =
  | "INVALID"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "UNAVAILABLE"
  | "PROFILE_INCOMPLETE"
  | "EXPIRED"
  | "INVALID_STATE"
  | "FAILED"
  | "CANCELLED"
  | "ALREADY_PAID"
  | "CONFLICT"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  INVALID: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNAVAILABLE: 409,
  PROFILE_INCOMPLETE: 409,
  EXPIRED: 409,
  INVALID_STATE: 409,
  FAILED: 402,
  CANCELLED: 402,
  ALREADY_PAID: 409,
  CONFLICT: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const isAppError = (err: unknown): err is AppError => err instanceof AppError;

export type Failure = { ok: false; code: ErrorCode; message: string; fieldErrors?: Record<string, string> };
/** `{ ok: true, ...data }` or a Failure. */
export type Result<T extends object = object> = ({ ok: true } & T) | Failure;

/** Run fn; AppErrors (and Zod errors) become Failures, anything else is logged and becomes INTERNAL. */
export async function toResult<T extends object>(fn: () => Promise<T>, context?: Record<string, unknown>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    return toFailure(err, context);
  }
}

export function toFailure(err: unknown, context?: Record<string, unknown>): Failure {
  if (isAppError(err)) {
    if (err.status >= 500) logger.error("operation failed", { ...context, err });
    const fieldErrors = err.details?.fieldErrors as Record<string, string> | undefined;
    return { ok: false, code: err.code, message: err.message, ...(fieldErrors ? { fieldErrors } : {}) };
  }
  if (isZodError(err)) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, code: "INVALID", message: err.issues[0]?.message ?? "Invalid input", fieldErrors };
  }
  // Next.js redirect()/notFound() must propagate.
  if (isNextControlFlow(err)) throw err;
  logger.error("unexpected error", { ...context, err });
  return { ok: false, code: "INTERNAL", message: "Something went wrong. Please try again." };
}

function isZodError(err: unknown): err is { issues: { path: PropertyKey[]; message: string }[] } {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "ZodError" && Array.isArray((err as { issues?: unknown }).issues);
}

function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown })?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));
}

/** PostgreSQL SQLSTATE of a pg error (possibly wrapped by Drizzle in `cause`). */
export function pgErrorCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Constraint name of a pg error (possibly wrapped). */
export function pgConstraint(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const c = (e as { constraint?: unknown }).constraint;
    if (typeof c === "string") return c;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export const PG_EXCLUSION_VIOLATION = "23P01";
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_CHECK_VIOLATION = "23514";
export const PG_FK_VIOLATION = "23503";

/** Convert any thrown value into a JSON Response for route handlers. */
export function errorResponse(err: unknown, context?: Record<string, unknown>): Response {
  const f = toFailure(err, context);
  const status = f.code === "INTERNAL" ? 500 : STATUS[f.code];
  return Response.json({ error: { code: f.code, message: f.message } }, { status });
}
