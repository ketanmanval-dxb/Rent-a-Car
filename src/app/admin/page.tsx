import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ReservationStatusBadge } from "@/components/booking/status-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAED, formatDateTime } from "@/lib/format";
import { requireAdmin } from "@/app/_data/session";
import { adminListReservations, adminStats } from "@/server/admin";

export const metadata: Metadata = { title: "Dashboard" };

export default function AdminDashboard() {
  return (
    <>
      <PageHeader title="Dashboard" description="Today's operations across all branches." />
      <Suspense
        fallback={
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        }
      >
        <Content />
      </Suspense>
    </>
  );
}

function Stat({ label, value, href, tone }: { label: string; value: string | number; href?: string; tone?: "warn" }) {
  const body = (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm ${tone === "warn" ? "border-amber-300" : "border-slate-200"}`}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone === "warn" ? "text-amber-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

async function Content() {
  const admin = await requireAdmin("/admin");
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 3600 * 1000);
  const [stats, pickups, returns] = await Promise.all([
    adminStats(admin.id),
    adminListReservations(admin.id, { status: "CONFIRMED", to: in24h, limit: 20 }),
    adminListReservations(admin.id, { status: "PICKED_UP", limit: 50 }),
  ]);
  if (!stats.ok) return <Alert tone="error">{stats.message}</Alert>;
  const s = stats;
  const upcomingPickups = pickups.ok ? [...pickups.reservations].sort((a, b) => +a.pickupAt - +b.pickupAt) : [];
  const dueReturns = returns.ok
    ? returns.reservations.filter((r) => r.returnAt <= in24h).sort((a, b) => +a.returnAt - +b.returnAt)
    : [];

  return (
    <div className="mt-6 space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pick-ups next 24 h" value={s.reservations.pickupsNext24h} href="/admin/reservations?status=CONFIRMED" />
        <Stat label="Returns next 24 h" value={s.reservations.returnsNext24h} href="/admin/reservations?status=PICKED_UP" />
        <Stat label="Overdue returns" value={s.reservations.overdue} tone={s.reservations.overdue ? "warn" : undefined} href="/admin/reservations?status=PICKED_UP" />
        <Stat label="Revenue (30 days)" value={formatAED(s.revenueLast30DaysFils)} />
        <Stat label="Awaiting payment" value={s.reservations.pending} href="/admin/reservations?status=PENDING" />
        <Stat label="Confirmed bookings" value={s.reservations.confirmed} href="/admin/reservations?status=CONFIRMED" />
        <Stat label="Cars on rent" value={`${s.fleet.onRent} / ${s.fleet.total}`} href="/admin/fleet?status=ON_RENT" />
        <Stat label="In maintenance" value={s.fleet.maintenance} href="/admin/maintenance" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <OpsList title="Upcoming pick-ups (24 h)" empty="No pick-ups in the next 24 hours." rows={upcomingPickups} when="pickup" />
        <OpsList title="Returns due (24 h)" empty="No returns due in the next 24 hours." rows={dueReturns} when="return" now={now} />
      </div>
    </div>
  );
}

type Row = {
  id: string;
  reference: string;
  status: string;
  customerName: string;
  plateNumber: string;
  vehicle: { make: string; model: string };
  pickupAt: Date;
  returnAt: Date;
  pickupBranch: { name: string; timezone: string };
  returnBranch: { name: string; timezone: string };
};

function OpsList({ title, empty, rows, when, now }: { title: string; empty: string; rows: Row[]; when: "pickup" | "return"; now?: Date }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-600">{empty}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const at = when === "pickup" ? r.pickupAt : r.returnAt;
              const b = when === "pickup" ? r.pickupBranch : r.returnBranch;
              const overdue = when === "return" && now && r.returnAt < now;
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/admin/reservations/${r.id}`} className="font-mono text-sm font-semibold text-brand-700 hover:underline">
                      {r.reference}
                    </Link>
                    <p className="truncate text-sm text-slate-700">
                      {r.customerName} · {r.vehicle.make} {r.vehicle.model} ({r.plateNumber})
                    </p>
                    <p className={`text-xs ${overdue ? "font-semibold text-red-700" : "text-slate-500"}`}>
                      {overdue ? "Overdue since " : ""}
                      {formatDateTime(at, b.timezone)} · {b.name}
                    </p>
                  </div>
                  <ReservationStatusBadge status={r.status} />
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
