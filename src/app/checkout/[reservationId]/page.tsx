import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { TripSummary } from "@/components/booking/trip-summary";
import { HoldCountdown } from "@/components/booking/hold-countdown";
import { ReservationStatusBadge } from "@/components/booking/status-badge";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Container, PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireUser } from "@/app/_data/session";
import { loadReservation } from "@/app/_data/reservations";
import { toQuoteView } from "@/app/_data/quote";
import { abandonAction } from "./actions";
import { PaymentForm } from "./payment-form";

export const metadata: Metadata = { title: "Checkout" };

export default function CheckoutPage({ params }: PageProps<"/checkout/[reservationId]">) {
  return (
    <Container className="py-8">
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <CheckoutContent params={params} />
      </Suspense>
    </Container>
  );
}

async function CheckoutContent({ params }: { params: Promise<{ reservationId: string }> }) {
  const { reservationId } = await params;
  if (!z.uuid().safeParse(reservationId).success) notFound();
  const user = await requireUser(`/checkout/${reservationId}`);
  const r = await loadReservation(user.id, reservationId);
  if (!r) notFound();

  if (r.status === "CONFIRMED" || r.status === "PICKED_UP" || r.status === "RETURNED") {
    redirect(`/rentals/${r.id}/voucher`);
  }

  const quote = toQuoteView(r.quote);
  // db computes canPay (pending + hold not expired) at query time.
  const holdActive = r.canPay && r.holdExpiresAt !== null;

  return (
    <>
      <PageHeader
        eyebrow={`Reservation ${r.reference}`}
        title="Checkout"
        description="Review your booking and pay to confirm."
        actions={<ReservationStatusBadge status={r.status} />}
      />
      <ol className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Booking steps">
        {["Dates", "Extras", "Driver"].map((s, i) => (
          <li key={s} className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
            {i + 1}. {s}
          </li>
        ))}
        <li aria-current="step" className="rounded-full bg-brand-600 px-3 py-1 font-semibold text-white">
          4. Payment
        </li>
      </ol>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your rental</CardTitle>
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
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardBody>
              {r.status !== "PENDING" ? (
                <Alert tone="warning" title={r.status === "EXPIRED" ? "Your hold expired" : "This booking cannot be paid"}>
                  {r.status === "EXPIRED"
                    ? "We held the car for a limited time and the hold has run out. The car may still be free."
                    : "This booking is no longer awaiting payment."}
                  <div className="mt-3">
                    <LinkButton href={`/vehicles/${r.vehicle.id}`} size="sm">
                      Check availability again
                    </LinkButton>
                  </div>
                </Alert>
              ) : !holdActive ? (
                <Alert tone="warning" title="Your hold has expired">
                  Please start a new booking.{" "}
                  <Link className="font-semibold underline" href={`/vehicles/${r.vehicle.id}`}>
                    Check availability
                  </Link>
                </Alert>
              ) : (
                <div className="space-y-5">
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    We are holding this car for you for{" "}
                    <HoldCountdown expiresAt={new Date(r.holdExpiresAt!).toISOString()} />.
                  </p>
                  {r.payment?.status === "FAILED" || r.payment?.status === "CANCELLED" ? (
                    <Alert tone="error" title="Previous payment attempt did not go through">
                      {r.payment.failureReason ?? "The payment was not completed."} You can try again.
                    </Alert>
                  ) : null}
                  <PaymentForm
                    reservationId={r.id}
                    initialAttemptId={randomUUID()}
                    totalFils={quote.totalFils}
                    depositFils={quote.depositFils}
                  />
                </div>
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
          {r.status === "PENDING" ? (
            <form action={abandonAction} className="text-center">
              <input type="hidden" name="reservationId" value={r.id} />
              <SubmitButton variant="ghost" size="sm" pendingText="Cancelling…">
                Cancel this booking
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </div>
    </>
  );
}
