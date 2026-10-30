import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import QRCode from "qrcode";
import { z } from "zod";
import { TripSummary } from "@/components/booking/trip-summary";
import { ReservationStatusBadge } from "@/components/booking/status-badge";
import { PrintButton } from "@/components/booking/print-button";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Container } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatAED } from "@/lib/format";
import { requireUser } from "@/app/_data/session";
import { loadReservation } from "@/app/_data/reservations";

export const metadata: Metadata = { title: "Pick-up voucher" };

export default function VoucherPage({ params, searchParams }: PageProps<"/rentals/[id]/voucher">) {
  return (
    <Container className="max-w-3xl py-8">
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <VoucherContent params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

const VOUCHER_STATUSES = new Set(["CONFIRMED", "PICKED_UP"]);

async function VoucherContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const user = await requireUser(`/rentals/${id}/voucher`);
  const r = await loadReservation(user.id, id);
  if (!r) notFound();

  if (!VOUCHER_STATUSES.has(r.status)) {
    return (
      <Alert tone="warning" title="No voucher for this booking">
        Vouchers are issued for confirmed bookings. This booking is {r.status.toLowerCase().replace("_", " ")}.
        <div className="mt-3">
          <LinkButton href={`/rentals/${r.id}`} size="sm" variant="outline">
            View booking
          </LinkButton>
        </div>
      </Alert>
    );
  }

  // The QR encodes the reference plus a staff lookup URL (the admin page requires an admin login).
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const qrPayload = `${appUrl}/admin/reservations?q=${encodeURIComponent(r.reference)}`;
  const qr = await QRCode.toDataURL(qrPayload, { margin: 1, width: 360, errorCorrectionLevel: "M" });

  return (
    <div className="space-y-6">
      {sp.confirmed ? (
        <Alert tone="success" title="Booking confirmed">
          Payment received and your deposit is held. Show this voucher at the counter.
        </Alert>
      ) : null}

      <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:shadow-none" aria-label="Pick-up voucher">
        <header className="flex items-center justify-between gap-4 bg-brand-700 px-6 py-4 text-white">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-200">DriveEasy pick-up voucher</p>
            <p className="font-mono text-2xl font-bold tracking-wider" data-testid="voucher-reference">
              {r.reference}
            </p>
          </div>
          <ReservationStatusBadge status={r.status} />
        </header>
        <div className="grid gap-6 p-6 sm:grid-cols-[1fr_auto]">
          <div className="space-y-5">
            <TripSummary
              vehicle={r.vehicle}
              pickupBranch={r.pickupBranch}
              returnBranch={r.returnBranch}
              pickupAt={r.pickupAt}
              returnAt={r.returnAt}
              compact
            />
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-500">Main driver</dt>
                <dd className="text-slate-900">{r.driver?.fullName ?? r.customer.name}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Licence number</dt>
                <dd className="text-slate-900">{r.driver?.licenceNumber ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Paid</dt>
                <dd className="text-slate-900">{formatAED(r.quote.totalFils)} incl. VAT</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Deposit held</dt>
                <dd className="text-slate-900">{r.deposit ? formatAED(r.deposit.amountFils) : "—"}</dd>
              </div>
              {r.quote.extras.length > 0 ? (
                <div className="sm:col-span-2">
                  <dt className="font-medium text-slate-500">Extras</dt>
                  <dd className="text-slate-900">
                    {r.quote.extras.map((e) => (e.quantity > 1 ? `${e.name} x${e.quantity}` : e.name)).join(", ")}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
          <div className="flex flex-col items-center gap-2 sm:border-l sm:border-dashed sm:border-slate-200 sm:pl-6">
            {/* Data URL generated on the server; plain img is intended here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt={`QR code for reservation ${r.reference}`} width={180} height={180} className="size-44" />
            <p className="text-center text-xs text-slate-500">Scan at the counter</p>
          </div>
        </div>
        <footer className="border-t border-slate-100 bg-slate-50 px-6 py-4 text-xs text-slate-600">
          Bring the main driver&apos;s original driving licence, passport or Emirates ID, and the card used for payment.
          Times are local to each branch.
        </footer>
      </article>

      <div className="no-print flex flex-wrap gap-3">
        <PrintButton />
        <LinkButton href={`/rentals/${r.id}`} variant="ghost">
          Manage booking
        </LinkButton>
        <Link href="/rentals" className="inline-flex h-10 items-center text-sm font-semibold text-slate-600 hover:text-slate-900">
          All rentals
        </Link>
      </div>
    </div>
  );
}
