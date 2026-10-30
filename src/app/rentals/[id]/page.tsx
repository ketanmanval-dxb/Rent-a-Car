import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { TripSummary } from "@/components/booking/trip-summary";
import { ReservationStatusBadge, StatusBadge } from "@/components/booking/status-badge";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Container, PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatAED, formatDateTime, zonedDateString, zonedParts } from "@/lib/format";
import { requireUser } from "@/app/_data/session";
import { loadReservation } from "@/app/_data/reservations";
import { toQuoteView } from "@/app/_data/quote";
import { CANCELLATION_POLICY_TEXT } from "@/server/reservations/policy";
import { CancelForm, ChangeDatesForm } from "./manage-forms";

export const metadata: Metadata = { title: "Rental details" };

export default function RentalPage({ params, searchParams }: PageProps<"/rentals/[id]">) {
  return (
    <Container className="py-8">
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <RentalContent params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function RentalContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const user = await requireUser(`/rentals/${id}`);
  const r = await loadReservation(user.id, id);
  if (!r) notFound();

  const quote = toQuoteView(r.quote);
  const ptz = r.pickupBranch.timezone;
  const rtz = r.returnBranch.timezone;
  const p = zonedParts(r.pickupAt, ptz);
  const ret = zonedParts(r.returnAt, rtz);
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
        <Link href="/rentals" className="hover:text-slate-900">
          ← My rentals
        </Link>
      </nav>
      <PageHeader
        eyebrow={<span className="font-mono">{r.reference}</span>}
        title={`${r.vehicle.make} ${r.vehicle.model}`}
        description={`Booked ${formatDateTime(r.createdAt, ptz)}`}
        actions={
          <>
            <ReservationStatusBadge status={r.status} />
          </>
        }
      />

      {sp.cancelled ? (
        <Alert tone="success" className="mt-6" title="Booking cancelled">
          {r.status === "REFUNDED" ? "Your refund is on its way and the deposit hold has been released." : "Your booking has been cancelled."}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" className="mt-6">
          {error}
        </Alert>
      ) : null}
      {r.status === "PENDING" ? (
        <Alert tone="warning" className="mt-6" title="Payment needed">
          This booking is not confirmed until you pay.
          <div className="mt-3">
            <LinkButton href={`/checkout/${r.id}`} size="sm">
              Complete payment
            </LinkButton>
          </div>
        </Alert>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle>Trip</CardTitle>
              {r.status === "CONFIRMED" || r.status === "PICKED_UP" ? (
                <LinkButton href={`/rentals/${r.id}/voucher`} size="sm">
                  Pick-up voucher
                </LinkButton>
              ) : null}
            </CardHeader>
            <CardBody>
              <TripSummary
                vehicle={r.vehicle}
                pickupBranch={r.pickupBranch}
                returnBranch={r.returnBranch}
                pickupAt={r.pickupAt}
                returnAt={r.returnAt}
              />
              <p className="mt-4 text-sm text-slate-600">
                Main driver: <span className="font-medium text-slate-900">{r.driver?.fullName ?? r.customer.name}</span> · Licence{" "}
                {r.driver?.licenceNumber ?? "—"}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Change dates</CardTitle>
            </CardHeader>
            <CardBody>
              {r.canModify ? (
                <ChangeDatesForm
                  reservationId={r.id}
                  pickupBranchId={r.pickupBranch.id}
                  returnBranchId={r.returnBranch.id}
                  initial={{ pd: p.date, pt: p.time, rd: ret.date, rt: ret.time }}
                  minDate={zonedDateString(new Date(), ptz)}
                  idempotencyKey={randomUUID()}
                />
              ) : (
                <p className="text-sm text-slate-600">{r.modifyReason || "This booking cannot be changed online."}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cancellation</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-sm text-slate-700">{CANCELLATION_POLICY_TEXT}</p>
              {r.cancellation.eligible ? (
                <>
                  <p className="text-sm font-medium text-slate-900">{r.cancellation.reason}</p>
                  <CancelForm
                    reservationId={r.id}
                    refundFils={r.cancellation.refundFils}
                    feeFils={r.cancellation.feeFils}
                    free={r.cancellation.free}
                    pending={r.status === "PENDING"}
                  />
                </>
              ) : (
                <p className="text-sm font-medium text-slate-900">{r.cancellation.reason}</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardBody>
              <PriceBreakdown quote={quote} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-slate-600">Rental payment</dt>
                  <dd>{r.payment ? <StatusBadge status={r.payment.status} /> : <span className="text-slate-500">Not paid</span>}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-600">Deposit {r.deposit ? formatAED(r.deposit.amountFils) : ""}</dt>
                  <dd>{r.deposit ? <StatusBadge status={r.deposit.status} /> : <span className="text-slate-500">None</span>}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
