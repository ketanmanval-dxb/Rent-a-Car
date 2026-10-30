import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchForm } from "@/components/search/search-form";
import { SearchFilters } from "@/components/search/search-filters";
import { VehicleCard } from "@/components/vehicle/vehicle-card";
import { CardGridSkeleton, Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Container } from "@/components/ui/page-header";
import { formatDateTime, pluralize } from "@/lib/format";
import {
  defaultTripDates,
  parseFilters,
  parseTrip,
  resolveTripInstants,
  toQueryString,
  tripToQuery,
  type RawSearchParams,
} from "@/lib/search-params";
import { loadBranchOptions, loadCategories, runSearch } from "@/app/_data/catalog";

export const metadata: Metadata = { title: "Search cars" };

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <Container className="py-8">
      <Suspense fallback={<SearchSkeleton />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function SearchContent({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams;
  const branches = await loadBranchOptions();
  const now = new Date();
  const defaults = defaultTripDates(now);
  const parsed = parseTrip(raw);
  const hasAnyTrip = Boolean(raw.pickup || raw.pd || raw.rd);

  if (!parsed.ok) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Find a car</h1>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <SearchForm
            branches={branches}
            minDate={defaults.today}
            errors={hasAnyTrip ? parsed.errors : undefined}
            values={{
              pickup: parsed.partial.pickupBranchId ?? branches[0]?.id,
              return: parsed.partial.returnBranchId,
              pd: parsed.partial.pd ?? defaults.pd,
              pt: parsed.partial.pt ?? defaults.pt,
              rd: parsed.partial.rd ?? defaults.rd,
              rt: parsed.partial.rt ?? defaults.rt,
            }}
          />
        </div>
        {!hasAnyTrip ? (
          <EmptyState
            title="Where and when?"
            description="Choose a pick-up branch and your dates to see cars that are free for your whole trip."
          />
        ) : null}
      </div>
    );
  }

  const { trip } = parsed;
  const pickupBranch = branches.find((b) => b.id === trip.pickupBranchId);
  const returnBranch = branches.find((b) => b.id === trip.returnBranchId);
  const filters = parseFilters(raw);

  const formValues = {
    pickup: trip.pickupBranchId,
    return: trip.returnBranchId,
    pd: trip.pd,
    pt: trip.pt,
    rd: trip.rd,
    rt: trip.rt,
  };
  const filterHidden: Record<string, string | undefined> = {
    category: filters.category,
    transmission: filters.transmission,
    seats: filters.seats?.toString(),
    fuel: filters.fuel,
    maxPrice: filters.maxPrice?.toString(),
    sort: filters.sort,
  };

  const header = (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <SearchForm branches={branches} values={formValues} minDate={defaults.today} hidden={filterHidden} layout="compact" />
    </div>
  );

  if (!pickupBranch || !returnBranch) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="error" title="Branch not available">
          The selected branch is not open for bookings. Please choose another branch.
        </Alert>
      </div>
    );
  }

  const instants = resolveTripInstants(trip, pickupBranch.timezone, returnBranch.timezone, now);
  if (!instants.ok) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="error" title="Check your dates">
          {instants.message}
        </Alert>
      </div>
    );
  }

  const [categories, outcome] = await Promise.all([
    loadCategories(),
    runSearch({
      pickupBranchId: pickupBranch.id,
      returnBranchId: returnBranch.id,
      pickupAt: instants.pickupAt,
      returnAt: instants.returnAt,
      categoryId: filters.category,
      transmission: filters.transmission,
      minSeats: filters.seats,
      fuelType: filters.fuel,
      maxDailyFils: filters.maxPrice ? filters.maxPrice * 100 : undefined,
      sort: filters.sort ?? "price_asc",
    }),
  ]);

  if (!outcome.ok) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="error" title="Check your search">
          {outcome.message}
        </Alert>
      </div>
    );
  }
  const { days, results } = outcome;
  const tripQuery = tripToQuery(trip);
  const qs = toQueryString(tripQuery);
  const activeFilterCount = Object.values(filterHidden).filter((v) => v && v !== "price_asc").length;

  return (
    <div className="space-y-6">
      {header}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {pluralize(results.length, "car")} available
          </h1>
          <p className="text-sm text-slate-600">
            {pickupBranch.name}, {formatDateTime(instants.pickupAt, pickupBranch.timezone)} to{" "}
            {returnBranch.id !== pickupBranch.id ? `${returnBranch.name}, ` : ""}
            {formatDateTime(instants.returnAt, returnBranch.timezone)} · {pluralize(days, "rental day")}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside>
          <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-slate-800">
              Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
              <span aria-hidden className="transition group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="border-t border-slate-100 p-4">
              <SearchFilters trip={trip} filters={filters} categories={categories} />
            </div>
          </details>
          <div className="hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:block">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Filters</h2>
            <SearchFilters trip={trip} filters={filters} categories={categories} />
          </div>
        </aside>

        <section aria-label="Results">
          {results.length === 0 ? (
            <EmptyState
              title="No cars match your search"
              description={
                activeFilterCount
                  ? "Try removing some filters, or choose different dates or another branch."
                  : "Every car at this branch is booked for these dates. Try different dates or another branch."
              }
              action={
                activeFilterCount ? (
                  <LinkButton href={`/search${qs}`} variant="outline">
                    Clear filters
                  </LinkButton>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((r) => (
                <VehicleCard
                  key={r.vehicle.id}
                  vehicle={r.vehicle}
                  dailyRateFils={r.dailyRateFils}
                  totalFils={r.totalFils}
                  oneWayFeeFils={r.oneWayFeeFils}
                  days={days}
                  href={`/book/${r.vehicle.id}${qs}`}
                  detailsHref={`/vehicles/${r.vehicle.id}${qs}`}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-8 w-60" />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <Skeleton className="hidden h-96 lg:block" />
        <CardGridSkeleton />
      </div>
    </div>
  );
}
