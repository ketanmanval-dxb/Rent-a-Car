import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { VehicleImage } from "@/components/vehicle/vehicle-image";
import { VehicleSpecs } from "@/components/vehicle/vehicle-card";
import { AvailabilityCalendar } from "@/components/vehicle/availability-calendar";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Container } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { addDaysToDateString, formatAED, formatDateTime, zonedDateString, zonedToUtc } from "@/lib/format";
import { parseTrip, toQueryString, tripToQuery, type RawSearchParams } from "@/lib/search-params";
import { loadCalendar, loadVehicle } from "@/app/_data/catalog";

export const metadata: Metadata = { title: "Vehicle details" };

export default function VehiclePage({ params, searchParams }: PageProps<"/vehicles/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={2} />}>
      <VehicleContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function VehicleContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const [{ id }, raw] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const vehicle = await loadVehicle(id);
  if (!vehicle) notFound();

  const tz = vehicle.branch.timezone;
  const today = zonedDateString(new Date(), tz);
  const calendarEnd = addDaysToDateString(today, 119);
  const calendar = await loadCalendar(vehicle.id, today, calendarEnd);

  const parsed = parseTrip(raw);
  const trip = parsed.ok ? parsed.trip : null;
  const name = `${vehicle.make} ${vehicle.model}`;
  const bookBase = `/book/${vehicle.id}${toQueryString({
    pickup: trip?.pickupBranchId ?? vehicle.branch.id,
    return: trip?.returnBranchId ?? vehicle.branch.id,
    pt: trip?.pt ?? "10:00",
    rt: trip?.rt ?? "10:00",
  })}`;

  return (
    <Container className="py-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
        <Link href={trip ? `/search${toQueryString(tripToQuery(trip))}` : "/search"} className="hover:text-slate-900">
          ← Back to results
        </Link>
      </nav>
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <VehicleImage src={vehicle.imageUrl} alt={name} className="aspect-[16/9] w-full" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{vehicle.category.name}</Badge>
              <span className="text-sm text-slate-500">{vehicle.year} · or similar</span>
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{name}</h1>
            <VehicleSpecs vehicle={vehicle} className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600" />
            {vehicle.description ? <p className="mt-4 text-slate-700">{vehicle.description}</p> : null}
          </div>
          {vehicle.features.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Features</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  {vehicle.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="size-4 text-emerald-600" aria-hidden>
                        <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Pick-up branch</CardTitle>
            </CardHeader>
            <CardBody className="text-sm text-slate-700">
              <p className="font-semibold text-slate-900">
                <Link href={`/branches/${vehicle.branch.id}`} className="hover:underline">
                  {vehicle.branch.name}
                </Link>
              </p>
              <p>{vehicle.branch.address}</p>
              <p className="mt-1 text-slate-500">{vehicle.branch.openingHours}</p>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardBody className="space-y-4">
              <div>
                <p className="text-sm text-slate-500">From</p>
                <p className="text-3xl font-bold text-slate-900">
                  {formatAED(vehicle.dailyRateFromFils)}
                  <span className="text-base font-normal text-slate-500"> / day</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Final price depends on dates and extras. Security deposit {formatAED(vehicle.depositFils)} (refundable).
                </p>
              </div>
              {trip ? (
                <TripCta trip={trip} tz={tz} bookHref={`/book/${vehicle.id}${toQueryString(tripToQuery(trip))}`} />
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Availability</CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">Dates in branch local time ({tz.replace("_", " ")})</p>
            </CardHeader>
            <CardBody>
              <AvailabilityCalendar
                days={calendar}
                selectedStart={trip?.pd}
                selectedEnd={trip?.rd}
                bookHref={bookBase}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </Container>
  );
}

function TripCta({
  trip,
  tz,
  bookHref,
}: {
  trip: { pd: string; pt: string; rd: string; rt: string };
  tz: string;
  bookHref: string;
}) {
  const start = zonedToUtc(trip.pd, trip.pt, tz);
  const end = zonedToUtc(trip.rd, trip.rt, tz);
  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-3 text-sm">
      {start && end ? (
        <p className="text-slate-700">
          <span className="font-medium">Your trip:</span> {formatDateTime(start, tz)} to {formatDateTime(end, tz)}
        </p>
      ) : null}
      <LinkButton href={bookHref} className="w-full" size="lg">
        Book this car
      </LinkButton>
    </div>
  );
}
