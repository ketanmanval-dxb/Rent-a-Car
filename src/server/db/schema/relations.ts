import { relations } from "drizzle-orm";
import { accounts, driverProfiles, sessions, users } from "./auth";
import { branches, extras, pricingRules, vehicleCategories, vehicleFeatureMap, vehicleFeatures, vehicles } from "./fleet";
import {
  auditLogs,
  damageReports,
  deposits,
  maintenanceBlocks,
  payments,
  rentalAgreements,
  reservationExtras,
  reservations,
} from "./rentals";

export const usersRelations = relations(users, ({ one, many }) => ({
  driverProfile: one(driverProfiles, { fields: [users.id], references: [driverProfiles.userId] }),
  sessions: many(sessions),
  accounts: many(accounts),
  reservations: many(reservations),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const driverProfilesRelations = relations(driverProfiles, ({ one }) => ({
  user: one(users, { fields: [driverProfiles.userId], references: [users.id] }),
}));

export const branchesRelations = relations(branches, ({ many }) => ({
  vehicles: many(vehicles),
}));

export const vehicleCategoriesRelations = relations(vehicleCategories, ({ many }) => ({
  vehicles: many(vehicles),
  pricingRules: many(pricingRules),
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  branch: one(branches, { fields: [vehicles.branchId], references: [branches.id] }),
  category: one(vehicleCategories, { fields: [vehicles.categoryId], references: [vehicleCategories.id] }),
  features: many(vehicleFeatureMap),
  reservations: many(reservations),
  maintenanceBlocks: many(maintenanceBlocks),
  damageReports: many(damageReports),
}));

export const vehicleFeaturesRelations = relations(vehicleFeatures, ({ many }) => ({
  vehicles: many(vehicleFeatureMap),
}));

export const vehicleFeatureMapRelations = relations(vehicleFeatureMap, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehicleFeatureMap.vehicleId], references: [vehicles.id] }),
  feature: one(vehicleFeatures, { fields: [vehicleFeatureMap.featureId], references: [vehicleFeatures.id] }),
}));

export const pricingRulesRelations = relations(pricingRules, ({ one }) => ({
  category: one(vehicleCategories, { fields: [pricingRules.categoryId], references: [vehicleCategories.id] }),
}));

export const reservationsRelations = relations(reservations, ({ one, many }) => ({
  user: one(users, { fields: [reservations.userId], references: [users.id] }),
  vehicle: one(vehicles, { fields: [reservations.vehicleId], references: [vehicles.id] }),
  pickupBranch: one(branches, {
    fields: [reservations.pickupBranchId],
    references: [branches.id],
    relationName: "pickupBranch",
  }),
  returnBranch: one(branches, {
    fields: [reservations.returnBranchId],
    references: [branches.id],
    relationName: "returnBranch",
  }),
  driverProfile: one(driverProfiles, { fields: [reservations.driverProfileId], references: [driverProfiles.id] }),
  extras: many(reservationExtras),
  payments: many(payments),
  deposits: many(deposits),
  agreement: one(rentalAgreements, { fields: [reservations.id], references: [rentalAgreements.reservationId] }),
  damageReports: many(damageReports),
}));

export const reservationExtrasRelations = relations(reservationExtras, ({ one }) => ({
  reservation: one(reservations, { fields: [reservationExtras.reservationId], references: [reservations.id] }),
  extra: one(extras, { fields: [reservationExtras.extraId], references: [extras.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  reservation: one(reservations, { fields: [payments.reservationId], references: [reservations.id] }),
}));

export const depositsRelations = relations(deposits, ({ one }) => ({
  reservation: one(reservations, { fields: [deposits.reservationId], references: [reservations.id] }),
}));

export const rentalAgreementsRelations = relations(rentalAgreements, ({ one }) => ({
  reservation: one(reservations, { fields: [rentalAgreements.reservationId], references: [reservations.id] }),
  vehicle: one(vehicles, { fields: [rentalAgreements.vehicleId], references: [vehicles.id] }),
}));

export const damageReportsRelations = relations(damageReports, ({ one }) => ({
  vehicle: one(vehicles, { fields: [damageReports.vehicleId], references: [vehicles.id] }),
  reservation: one(reservations, { fields: [damageReports.reservationId], references: [reservations.id] }),
}));

export const maintenanceBlocksRelations = relations(maintenanceBlocks, ({ one }) => ({
  vehicle: one(vehicles, { fields: [maintenanceBlocks.vehicleId], references: [vehicles.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorUserId], references: [users.id] }),
}));
