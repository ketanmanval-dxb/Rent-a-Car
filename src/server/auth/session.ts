import { notFound, redirect } from "next/navigation";
import { AppError } from "@/server/lib/errors";
import { getAuth } from "./auth";

// next/headers is imported lazily so modules importing this file work outside Next (tests, scripts).
const requestHeaders = async () => (await import("next/headers")).headers();

export type UserRole = "customer" | "admin";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface CurrentSession {
  user: SessionUser;
  sessionId: string;
  expiresAt: Date;
}

function toSession(raw: Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>): CurrentSession | null {
  if (!raw) return null;
  const role = (raw.user as { role?: string }).role === "admin" ? "admin" : "customer";
  return {
    user: { id: raw.user.id, name: raw.user.name, email: raw.user.email, role },
    sessionId: raw.session.id,
    expiresAt: new Date(raw.session.expiresAt),
  };
}

/** Session for an explicit Headers object (route handlers can pass `request.headers`). */
export async function getSessionFromHeaders(h: Headers): Promise<CurrentSession | null> {
  return toSession(await getAuth().api.getSession({ headers: h }));
}

/** Current session in Server Components / Server Actions / Route Handlers, or null. */
export async function getSession(): Promise<CurrentSession | null> {
  return getSessionFromHeaders(await requestHeaders());
}

/** For pages: redirect to /login?next=... when signed out. */
export async function requireUser(nextPath?: string): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  return s.user;
}

/** For admin pages: redirect to login when signed out, 404 for non-admins (don't reveal admin routes). */
export async function requireAdmin(nextPath?: string): Promise<SessionUser> {
  const user = await requireUser(nextPath);
  if (user.role !== "admin") notFound();
  return user;
}

/** For server actions / APIs: throw AppError instead of redirecting. */
export async function assertUser(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
  return s.user;
}

export async function assertAdmin(): Promise<SessionUser> {
  const user = await assertUser();
  if (user.role !== "admin") throw new AppError("FORBIDDEN", "Admin access required.");
  return user;
}
