import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ReservationStatusBadge } from "@/components/booking/status-badge";
import { VehicleImage } from "@/components/vehicle/vehicle-image";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { Container, PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatAED, formatDateTime } from "@/lib/format";
import { requireUser } from "@/app/_data/session";
import { ACTIVE_STATUSES, loadReservations, type ReservationSummary } from "@/app/_data/reservations";

export const metadata: Metadata = { title: "My rentals" };

export default function RentalsPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <RentalsContent />
    </Suspense>
  );
}

async function RentalsContent() {
  const user = await requireUser("/rentals");
  const all = await loadReservations(user.id);
  const upcoming = all.filter((r) => ACTIVE_STATUSES.has(r.status));
  const past = all.filter((r) => !ACTIVE_STATUSES.has(r.status));

  return (
    <Container className="py-8">
      <PageHeader
        title="My rentals"
        description="View, change or cancel your bookings and open your pick-up vouchers."
        actions={<LinkButton href="/search">Book a car</LinkButton>}
      />
      {all.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="No rentals yet"
          description="When you book a car it will appear here with your voucher."
          action={<LinkButton href="/search">Find a car</LinkButton>}
        />
      ) : (
        <div className="mt-8 space-y-10">
          <RentalSection title="Upcoming and active" items={upcoming} empty="No upcoming rentals." />
          <RentalSection title="Past and cancelled" items={past} empty="Nothing here yet." />
        </div>
      )}
    </Container>
  );
}

function RentalSection({ title, items, empty }: { title: string; items: ReservationSummary[]; empty: string }) {
  return (
    <section aria-label={title}>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((r) => (
            <li key={r.id}>
              <Link
                href={`/rentals/${r.id}`}
                className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow sm:flex-row sm:items-center"
              >
                <VehicleImage
                  src={r.vehicle.imageUrl}
                  alt={`${r.vehicle.make} ${r.vehicle.model}`}
                  className="aspect-[16/10] w-full sm:w-36"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-900">{r.reference}</span>
                    <ReservationStatusBadge status={r.status} />
                  </div>
                  <p className="mt-1 font-semibold text-slate-900">
                    {r.vehicle.make} {r.vehicle.model}
                  </p>
                  <p className="text-sm text-slate-600">
                    {formatDateTime(r.pickupAt, r.pickupBranch.timezone)} → {formatDateTime(r.returnAt, r.returnBranch.timezone)}
                  </p>
                  <p className="text-sm text-slate-500">
                    {r.pickupBranch.name}
                    {r.returnBranch.id !== r.pickupBranch.id ? ` → ${r.returnBranch.name}` : ""}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-lg font-bold text-slate-900">{formatAED(r.totalFils)}</p>
                  <p className="text-sm font-semibold text-brand-700">View details →</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
