import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/server/db";
import { accounts, sessions, users, verifications } from "@/server/db/schema";

function createAuth() {
  return betterAuth({
    appName: "DriveEasy",
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.APP_URL,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        // Not settable at sign-up (input: false); admins are promoted in the DB / seed.
        role: { type: ["customer", "admin"], required: false, input: false, defaultValue: "customer" },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      database: { generateId: "uuid" },
    },
    // Must be last: lets server actions set auth cookies via next/headers.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __driveeasyAuth?: Auth };

/** Lazily-built Better Auth instance (needs DATABASE_URL + BETTER_AUTH_SECRET at request time). */
export function getAuth(): Auth {
  globalForAuth.__driveeasyAuth ??= createAuth();
  return globalForAuth.__driveeasyAuth;
}
