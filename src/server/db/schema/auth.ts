import { sql } from "drizzle-orm";
import { boolean, check, date, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userRole } from "./enums";
import { tstz } from "./types";

// Better Auth core tables (user/session/account/verification), configured with
// usePlural + generateId "uuid" in src/server/auth/auth.ts. JS keys must match
// Better Auth field names (camelCase); DB columns are snake_case. `users` is
// the application's user table too (role, profile FK targets).

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: userRole("role").notNull().default("customer"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    check("users_email_format", sql`${t.email} ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`),
    check("users_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: tstz("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("accounts_user_id_idx").on(t.userId),
    uniqueIndex("accounts_provider_account_uq").on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** Driver details + licence for a user (one per user). Licence file is private (storage key). */
export const driverProfiles = pgTable(
  "driver_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    nationality: text("nationality"),
    licenceNumber: text("licence_number").notNull(),
    licenceCountry: text("licence_country").notNull(),
    licenceExpiry: date("licence_expiry", { mode: "string" }).notNull(),
    /** Storage key, e.g. licences/<userId>/<uuid>.jpg. Served only via /api/files. */
    licenceFileKey: text("licence_file_key"),
    verifiedAt: tstz("verified_at"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("driver_profiles_phone_format", sql`${t.phone} ~ '^\\+?[0-9 ()-]{7,20}$'`),
    check("driver_profiles_licence_after_dob", sql`${t.licenceExpiry} > ${t.dateOfBirth}`),
    check("driver_profiles_licence_number_not_blank", sql`length(btrim(${t.licenceNumber})) > 0`),
    check("driver_profiles_licence_key_scope", sql`${t.licenceFileKey} IS NULL OR ${t.licenceFileKey} LIKE 'licences/%'`),
  ],
);
