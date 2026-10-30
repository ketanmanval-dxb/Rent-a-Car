import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Container, PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { loadBranches } from "@/app/_data/catalog";

export const metadata: Metadata = { title: "Branches" };

export default function BranchesPage() {
  return (
    <Container className="py-8">
      <PageHeader title="Our branches" description="Pick up and return at any DriveEasy branch. One-way fees may apply." />
      <Suspense
        fallback={
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        }
      >
        <BranchList />
      </Suspense>
    </Container>
  );
}

async function BranchList() {
  const branches = await loadBranches();
  if (branches.length === 0) {
    return <EmptyState className="mt-8" title="No branches yet" description="Branches will appear here once they open." />;
  }
  return (
    <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {branches.map((b) => (
        <li key={b.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{b.city}</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{b.name}</h2>
          <p className="mt-2 text-sm text-slate-600">{b.address}</p>
          <dl className="mt-3 space-y-1 text-sm text-slate-600">
            <div className="flex gap-2">
              <dt className="sr-only">Opening hours</dt>
              <dd>{b.openingHours}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="sr-only">Phone</dt>
              <dd>
                <a href={`tel:${b.phone.replace(/\s/g, "")}`} className="hover:text-slate-900">
                  {b.phone}
                </a>
              </dd>
            </div>
          </dl>
          <div className="mt-auto flex gap-3 pt-4 text-sm font-semibold">
            <Link href={`/branches/${b.id}`} className="text-brand-700 hover:underline">
              Branch details
            </Link>
            <Link href={`/search?pickup=${b.id}`} className="text-slate-700 hover:underline">
              Find cars here
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
