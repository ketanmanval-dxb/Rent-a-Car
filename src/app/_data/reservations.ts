// Server-only adapter over db's reservation read functions.
import { connection } from "next/server";
import { getReservationForUser, listReservationsForUser } from "@/server/reservations";

export type ReservationDetail = NonNullable<Awaited<ReturnType<typeof getReservationForUser>>>;
export type ReservationSummary = Awaited<ReturnType<typeof listReservationsForUser>>[number];

export async function loadReservation(userId: string, id: string): Promise<ReservationDetail | null> {
  await connection();
  return getReservationForUser(userId, id);
}

export async function loadReservations(userId: string): Promise<ReservationSummary[]> {
  await connection();
  return listReservationsForUser(userId);
}

export const ACTIVE_STATUSES = new Set(["PENDING", "CONFIRMED", "PICKED_UP"]);
