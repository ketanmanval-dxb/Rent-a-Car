import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { ReservationStatusBadge } from "@/components/booking/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAED, formatDateTime, zonedToUtc, DEFAULT_TIMEZONE } from "@/lib/format";
import { requireAdmin } from "@/app/_data/session";
import { loadBranches } from "@/app/_data/catalog";
import { queryReservations } from "@/server/reservations";

export const metadata: Metadata = { title: "Reservations" };

const STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"] as const;

const filterSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(STATUSES).optional().catch(undefined),
  branch: z.uuid().optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
});

export default function AdminReservationsPage({ searchParams }: PageProps<"/admin/reservations">) {
  return (
    <>
      <PageHeader title="Reservations" description="Search bookings, then open one to check a car out or in." />
      <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  await requireAdmin("/admin/reservations");
  const f = filterSchema.parse({
    q: first(raw.q),
    status: first(raw.status),
    branch: first(raw.branch),
    from: first(raw.from),
    to: first(raw.to),
  });
  const [branches, rows] = await Promise.all([
    loadBranches(),
    queryReservations({
      q: f.q,
      status: f.status,
      branchId: f.branch,
      from: f.from ? zonedToUtc(f.from, "00:00", DEFAULT_TIMEZONE) ?? undefined : undefined,
      to: f.to ? zonedToUtc(f.to, "23:59", DEFAULT_TIMEZONE) ?? undefined : undefined,
    }),
  ]);

  return (
    <div className="mt-6 space-y-6">
      <Form action="/admin/reservations" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Search" htmlFor="q" className="lg:col-span-2">
          <Input id="q" name="q" placeholder="Reference, customer, email, plate" defaultValue={f.q ?? ""} />
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={f.status ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Branch" htmlFor="branch">
          <Select id="branch" name="branch" defaultValue={f.branch ?? ""}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" htmlFor="from">
          <Input id="from" name="from" type="date" defaultValue={f.from ?? ""} />
        </Field>
        <Field label="To" htmlFor="to">
          <Input id="to" name="to" type="date" defaultValue={f.to ?? ""} />
        </Field>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit">Search</Button>
          <Link href="/admin/reservations" className="inline-flex h-10 items-center px-3 text-sm font-medium text-slate-600 hover:text-slate-900">
            Reset
          </Link>
        </div>
      </Form>

      {rows.length === 0 ? (
        <EmptyState title="No reservations found" description="Try a different search or clear the filters." />
      ) : (
        <div className="relative overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <caption className="sr-only">Reservations</caption>
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">Reference</th>
                <th scope="col" className="px-4 py-3">Customer</th>
                <th scope="col" className="px-4 py-3">Vehicle</th>
                <th scope="col" className="px-4 py-3">Pick-up</th>
                <th scope="col" className="px-4 py-3">Return</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/reservations/${r.id}`} className="font-mono font-semibold text-brand-700 hover:underline">
                      {r.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{r.customerName}</p>
                    <p className="text-xs text-slate-500">{r.customerEmail}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate-900">
                      {r.vehicle.make} {r.vehicle.model}
                    </p>
                    <p className="font-mono text-xs text-slate-500">{r.plateNumber}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <p>{formatDateTime(r.pickupAt, r.pickupBranch.timezone)}</p>
                    <p className="text-xs text-slate-500">{r.pickupBranch.name}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <p>{formatDateTime(r.returnAt, r.returnBranch.timezone)}</p>
                    <p className="text-xs text-slate-500">{r.returnBranch.name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <ReservationStatusBadge status={r.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium">{formatAED(r.totalFils)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
