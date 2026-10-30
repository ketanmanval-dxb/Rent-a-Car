import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BookingForm } from "./booking-form";
import { SearchForm } from "@/components/search/search-form";
import { VehicleImage } from "@/components/vehicle/vehicle-image";
import { VehicleSpecs } from "@/components/vehicle/vehicle-card";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { Container } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  defaultTripDates,
  parseTrip,
  resolveTripInstants,
  toQueryString,
  tripToQuery,
  type RawSearchParams,
} from "@/lib/search-params";
import { loadBranchOptions, loadExtras, loadVehicle } from "@/app/_data/catalog";
import { loadDriverProfile, profileStatus } from "@/app/_data/profile";
import { requireUser } from "@/app/_data/session";
import { quoteRental } from "@/server/pricing";
import { toQuoteView } from "@/app/_data/quote";

export const metadata: Metadata = { title: "Book your car" };

export default function BookPage({ params, searchParams }: PageProps<"/book/[vehicleId]">) {
  return (
    <Container className="py-8">
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <BookContent params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

function Steps({ current }: { current: number }) {
  const steps = ["Dates", "Extras", "Driver", "Payment"];
  return (
    <ol className="mb-6 flex flex-wrap gap-2 text-sm" aria-label="Booking steps">
      {steps.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? "step" : undefined}
          className={
            i < current
              ? "rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700"
              : i === current
                ? "rounded-full bg-brand-600 px-3 py-1 font-semibold text-white"
                : "rounded-full bg-slate-100 px-3 py-1 text-slate-500"
          }
        >
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  );
}

async function BookContent({
  params,
  searchParams,
}: {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const [{ vehicleId }, raw] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(vehicleId).success) notFound();
  const parsed = parseTrip(raw);
  const selfPath = `/book/${vehicleId}${parsed.ok ? toQueryString(tripToQuery(parsed.trip)) : ""}`;
  const user = await requireUser(selfPath);

  const [vehicle, branches] = await Promise.all([loadVehicle(vehicleId), loadBranchOptions()]);
  if (!vehicle) notFound();
  const name = `${vehicle.make} ${vehicle.model}`;
  const now = new Date();
  const defaults = defaultTripDates(now, vehicle.branch.timezone);

  const vehicleHeader = (
    <Card className="mb-6">
      <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <VehicleImage src={vehicle.imageUrl} alt={name} className="aspect-[16/10] w-full sm:w-44" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-500">{vehicle.category.name}</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{name}</h1>
          <VehicleSpecs vehicle={vehicle} className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600" />
        </div>
        <Link href={`/vehicles/${vehicle.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
          View availability
        </Link>
      </CardBody>
    </Card>
  );

  // Vehicles are rented from their current branch.
  const pickupBranchId = vehicle.branch.id;
  const tripValues = {
    pickup: pickupBranchId,
    return: parsed.ok ? parsed.trip.returnBranchId : parsed.partial.returnBranchId ?? pickupBranchId,
    pd: parsed.ok ? parsed.trip.pd : parsed.partial.pd ?? defaults.pd,
    pt: parsed.ok ? parsed.trip.pt : parsed.partial.pt ?? defaults.pt,
    rd: parsed.ok ? parsed.trip.rd : parsed.partial.rd ?? defaults.rd,
    rt: parsed.ok ? parsed.trip.rt : parsed.partial.rt ?? defaults.rt,
  };
  const pickupOnly = branches.filter((b) => b.id === pickupBranchId);
  const datesForm = (
    <Card className="mb-6">
      <CardBody>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Dates and branches</h2>
        <SearchForm
          branches={pickupOnly.length ? pickupOnly : branches}
          returnBranches={branches}
          values={tripValues}
          minDate={defaults.today}
          layout="compact"
          action={`/book/${vehicle.id}`}
          submitLabel="Update dates"
        />
        {branches.length > 1 ? (
          <ReturnBranchNote />
        ) : null}
      </CardBody>
    </Card>
  );

  if (!parsed.ok) {
    return (
      <>
        <Steps current={0} />
        {vehicleHeader}
        {datesForm}
      </>
    );
  }

  const trip = { ...parsed.trip, pickupBranchId };
  const returnBranch = branches.find((b) => b.id === trip.returnBranchId);
  if (!returnBranch) {
    return (
      <>
        <Steps current={0} />
        {vehicleHeader}
        {datesForm}
        <Alert tone="error">The selected return branch is not available. Please choose another.</Alert>
      </>
    );
  }
  const instants = resolveTripInstants(trip, vehicle.branch.timezone, returnBranch.timezone, now);
  if (!instants.ok) {
    return (
      <>
        <Steps current={0} />
        {vehicleHeader}
        {datesForm}
        <Alert tone="error" title="Check your dates">
          {instants.message}
        </Alert>
      </>
    );
  }

  const base = {
    vehicleId: vehicle.id,
    pickupBranchId,
    returnBranchId: returnBranch.id,
    pickupAt: instants.pickupAt.toISOString(),
    returnAt: instants.returnAt.toISOString(),
  };
  const idempotencyKey = randomUUID();
  const [extras, quoteRes, profile] = await Promise.all([
    loadExtras(),
    quoteRental({ ...base, pickupAt: instants.pickupAt, returnAt: instants.returnAt, extras: [] }),
    loadDriverProfile(user.id),
  ]);

  if (!quoteRes.ok) {
    return (
      <>
        <Steps current={0} />
        {vehicleHeader}
        {datesForm}
        <Alert tone="error" title="We could not price these dates">
          {quoteRes.message}
        </Alert>
      </>
    );
  }

  const status = profileStatus(profile);
  const profileHref = `/profile?next=${encodeURIComponent(selfPath)}`;

  return (
    <>
      <Steps current={status.complete ? 1 : 2} />
      {vehicleHeader}
      <Card className="mb-6">
        <CardBody className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="font-medium text-slate-500">Pick-up</p>
            <p className="font-semibold text-slate-900">{vehicle.branch.name}</p>
            <p className="text-slate-700">{formatDateTime(instants.pickupAt, vehicle.branch.timezone)}</p>
          </div>
          <div>
            <p className="font-medium text-slate-500">Return</p>
            <p className="font-semibold text-slate-900">{returnBranch.name}</p>
            <p className="text-slate-700">{formatDateTime(instants.returnAt, returnBranch.timezone)}</p>
          </div>
          <details className="sm:text-right">
            <summary className="cursor-pointer font-semibold text-brand-700">Change dates</summary>
            <div className="mt-3 text-left">{datesForm}</div>
          </details>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Driver details and licence</h2>
            {status.complete && profile ? (
              <p className="text-sm text-slate-600">
                {profile.fullName} · Licence {profile.licenceNumber} ({profile.licenceCountry}), valid until{" "}
                {formatDate(profile.licenceExpiry + "T12:00:00Z", "UTC")}
              </p>
            ) : (
              <ul className="mt-1 list-inside list-disc text-sm text-amber-800">
                {status.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
          </div>
          <LinkButton href={profileHref} variant={status.complete ? "outline" : "primary"} size="sm">
            {status.complete ? "Edit details" : "Add driver details"}
          </LinkButton>
        </CardBody>
      </Card>

      <BookingForm
        base={{ ...base, idempotencyKey }}
        extras={extras}
        initialQuote={toQuoteView(quoteRes.quote)}
        canReserve={status.complete}
        blockedReason={
          <Alert tone="warning" title="Driver details needed">
            Add your driver details and upload your driving licence before reserving.{" "}
            <Link href={profileHref} className="font-semibold underline">
              Complete your profile
            </Link>
          </Alert>
        }
      />
    </>
  );
}

function ReturnBranchNote() {
  return (
    <p className="mt-2 text-xs text-slate-500">
      Tick &quot;Return to a different branch&quot; to drop the car elsewhere; a one-way fee may apply.
    </p>
  );
}
