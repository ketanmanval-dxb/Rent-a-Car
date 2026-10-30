import { unstable_rethrow } from "next/navigation";
// Server-only adapter over db's auth helpers. Import only from server components / actions.
import { getSession, requireAdmin, requireUser, type SessionUser } from "@/server/auth";

export type { SessionUser };

export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    const s = await getSession();
    return s?.user ?? null;
  } catch (err) {
    unstable_rethrow(err);
    // A broken session cookie or a DB hiccup must not take down every page header.
    console.error("getCurrentUser failed", err);
    return null;
  }
}

export { requireUser, requireAdmin };
