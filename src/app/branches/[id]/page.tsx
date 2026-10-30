import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Container } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchForm } from "@/components/search/search-form";
import { VehicleCard } from "@/components/vehicle/vehicle-card";
import { formatTime, timeZoneLabel, zonedToUtc } from "@/lib/format";
import { defaultTripDates, toQueryString } from "@/lib/search-params";
import { loadBranch, loadBranchOptions, runSearch } from "@/app/_data/catalog";

export const metadata: Metadata = { title: "Branch" };

export default function BranchPage({ params }: PageProps<"/branches/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BranchContent params={params} />
    </Suspense>
  );
}

async function BranchContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const branch = await loadBranch(decodeURIComponent(id));
  if (!branch) notFound();
  const branches = await loadBranchOptions();
  const now = new Date();
  const d = defaultTripDates(now, branch.timezone);
  const pickupAt = zonedToUtc(d.pd, d.pt, branch.timezone)!;
  const returnAt = zonedToUtc(d.rd, d.rt, branch.timezone)!;
  const outcome = await runSearch({
    pickupBranchId: branch.id,
    returnBranchId: branch.id,
    pickupAt,
    returnAt,
    sort: "price_asc",
  });
  const days = outcome.ok ? outcome.days : 0;
  const results = outcome.ok ? outcome.results : [];
  const qs = toQueryString({ pickup: branch.id, return: branch.id, pd: d.pd, pt: d.pt, rd: d.rd, rt: d.rt });
  const mapsHref =
    branch.latitude != null && branch.longitude != null
      ? `https://www.openstreetmap.org/?mlat=${branch.latitude}&mlon=${branch.longitude}#map=16/${branch.latitude}/${branch.longitude}`
      : null;

  return (
    <Container className="py-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
        <Link href="/branches" className="hover:text-slate-900">
          ← All branches
        </Link>
      </nav>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">{branch.city}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{branch.name}</h1>
          <p className="mt-2 text-slate-600">{branch.address}</p>
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-slate-900">Book from this branch</h2>
            <SearchForm branches={branches} values={{ ...d, pickup: branch.id }} minDate={d.today} layout="compact" />
          </div>
        </div>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Branch information</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-medium text-slate-500">Opening hours</dt>
                <dd className="text-slate-900">{branch.openingHours}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Local time</dt>
                <dd className="text-slate-900">
                  {formatTime(now, branch.timezone)} {timeZoneLabel(branch.timezone, now)} ({branch.timezone})
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Phone</dt>
                <dd>
                  <a className="text-brand-700 hover:underline" href={`tel:${branch.phone.replace(/\s/g, "")}`}>
                    {branch.phone}
                  </a>
                </dd>
              </div>
              {branch.email ? (
                <div>
                  <dt className="font-medium text-slate-500">Email</dt>
                  <dd>
                    <a className="text-brand-700 hover:underline" href={`mailto:${branch.email}`}>
                      {branch.email}
                    </a>
                  </dd>
                </div>
              ) : null}
              {mapsHref ? (
                <div>
                  <dt className="font-medium text-slate-500">Map</dt>
                  <dd>
                    <a className="text-brand-700 hover:underline" href={mapsHref} target="_blank" rel="noopener noreferrer">
                      Open in map
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardBody>
        </Card>
      </div>

      <section className="mt-10" aria-labelledby="fleet-heading">
        <h2 id="fleet-heading" className="text-xl font-bold tracking-tight text-slate-900">
          Available here {d.pd} to {d.rd}
        </h2>
        <p className="text-sm text-slate-600">Change dates above to check other periods.</p>
        {results.length === 0 ? (
          <EmptyState className="mt-4" title="No cars free for these dates" description="Try different dates using the form above." />
        ) : (
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {results.slice(0, 9).map((r) => (
              <VehicleCard
                key={r.vehicle.id}
                vehicle={r.vehicle}
                dailyRateFils={r.dailyRateFils}
                totalFils={r.totalFils}
                days={days}
                href={`/book/${r.vehicle.id}${qs}`}
                detailsHref={`/vehicles/${r.vehicle.id}${qs}`}
              />
            ))}
          </div>
        )}
      </section>
    </Container>
  );
}
