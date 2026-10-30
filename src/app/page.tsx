import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { SearchForm } from "@/components/search/search-form";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { defaultTripDates } from "@/lib/search-params";
import { loadBranchOptions, loadBranches } from "@/app/_data/catalog";

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 text-white">
        <div
          className="pointer-events-none absolute -right-40 -top-40 size-[32rem] rounded-full bg-brand-500/30 blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto w-full max-w-6xl px-4 pb-28 pt-12 sm:px-6 sm:pt-20">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-200">Car rental across the UAE</p>
          <h1 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
            The right car, at the right branch, at a clear price.
          </h1>
          <p className="mt-4 max-w-xl text-base text-brand-100 sm:text-lg">
            Live availability, all-in AED pricing with VAT shown before you pay, and a digital pick-up voucher on your
            phone.
          </p>
        </div>
      </section>

      <div className="relative mx-auto -mt-20 w-full max-w-6xl px-4 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6">
          <h2 className="sr-only">Search for a car</h2>
          <Suspense fallback={<SearchFormSkeleton />}>
            <HomeSearch />
          </Suspense>
        </div>
      </div>

      <section className="mx-auto mt-16 w-full max-w-6xl px-4 sm:px-6" aria-labelledby="why-heading">
        <h2 id="why-heading" className="text-2xl font-bold tracking-tight text-slate-900">
          Why rent with DriveEasy
        </h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "Real-time availability", body: "Every car shown is free for your exact dates and times." },
            { title: "No surprises", body: "Daily rate, extras, one-way fees, VAT and deposit itemised up front." },
            { title: "Flexible bookings", body: "Change dates or cancel eligible bookings from My rentals." },
            { title: "Digital voucher", body: "Show the QR code at the counter and drive away." },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 w-full max-w-6xl px-4 sm:px-6" aria-labelledby="branches-heading">
        <div className="flex items-end justify-between gap-4">
          <h2 id="branches-heading" className="text-2xl font-bold tracking-tight text-slate-900">
            Our branches
          </h2>
          <Link href="/branches" className="text-sm font-semibold text-brand-700 hover:underline">
            All branches
          </Link>
        </div>
        <Suspense
          fallback={
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          }
        >
          <BranchTeasers />
        </Suspense>
      </section>
    </>
  );
}

async function HomeSearch() {
  await connection();
  const branches = await loadBranchOptions();
  if (branches.length === 0) {
    return <Alert tone="warning">No branches are open for booking right now. Please check back soon.</Alert>;
  }
  const d = defaultTripDates(new Date());
  return <SearchForm branches={branches} values={{ ...d, pickup: branches[0].id }} minDate={d.today} />;
}

async function BranchTeasers() {
  const branches = await loadBranches();
  return (
    <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {branches.slice(0, 6).map((b) => (
        <li key={b.id}>
          <Link
            href={`/branches/${b.id}`}
            className="block h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow"
          >
            <p className="font-semibold text-slate-900">{b.name}</p>
            <p className="mt-1 text-sm text-slate-600">{b.address}</p>
            <p className="mt-2 text-xs text-slate-500">{b.openingHours}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SearchFormSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr_auto]" role="status" aria-live="polite">
      <span className="sr-only">Loading search…</span>
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-12 w-32 self-end" />
    </div>
  );
}
