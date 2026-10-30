import { Badge, type BadgeTone } from "@/components/ui/badge";
import { titleCase } from "@/lib/format";

const reservationTones: Record<string, BadgeTone> = {
  PENDING: "warning",
  CONFIRMED: "success",
  PICKED_UP: "brand",
  RETURNED: "neutral",
  CANCELLED: "danger",
  EXPIRED: "neutral",
  REFUNDED: "info",
};

const reservationLabels: Record<string, string> = {
  PENDING: "Awaiting payment",
  CONFIRMED: "Confirmed",
  PICKED_UP: "On rent",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  REFUNDED: "Refunded",
};

export function ReservationStatusBadge({ status }: { status: string }) {
  return <Badge tone={reservationTones[status] ?? "neutral"}>{reservationLabels[status] ?? titleCase(status)}</Badge>;
}

const genericTones: Record<string, BadgeTone> = {
  SUCCEEDED: "success",
  HELD: "info",
  RELEASED: "neutral",
  CAPTURED: "warning",
  FAILED: "danger",
  CANCELLED: "danger",
  PENDING: "warning",
  REFUNDED: "info",
  PARTIALLY_REFUNDED: "info",
  EXPIRED: "neutral",
  AVAILABLE: "success",
  RESERVED: "info",
  ON_RENT: "brand",
  MAINTENANCE: "warning",
  RETIRED: "neutral",
  SCHEDULED: "info",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  MINOR: "info",
  MODERATE: "warning",
  MAJOR: "danger",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={genericTones[status] ?? "neutral"}>{titleCase(status)}</Badge>;
}
