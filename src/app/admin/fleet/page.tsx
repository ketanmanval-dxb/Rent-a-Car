import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { StatusBadge } from "@/components/booking/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAED, titleCase } from "@/lib/format";
import { requireAdmin } from "@/app/_data/session";
import { adminListBranches, adminListCategories, adminListVehicles } from "@/server/admin";
import { AdminForm } from "../admin-form";
import { setVehicleStatusAction } from "../actions";

export const metadata: Metadata = { title: "Fleet" };

const STATUSES = ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"] as const;
const filters = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  branch: z.uuid().optional().catch(undefined),
  category: z.uuid().optional().catch(undefined),
  status: z.enum(STATUSES).optional().catch(undefined),
});
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default function FleetPage({ searchParams }: PageProps<"/admin/fleet">) {
  return (
    <>
      <PageHeader title="Fleet" description="Vehicles, their branch and status." actions={<LinkButton href="/admin/fleet/new">Add vehicle</LinkButton>} />
      <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const admin = await requireAdmin("/admin/fleet");
  const f = filters.parse({ q: first(raw.q), branch: first(raw.branch), category: first(raw.category), status: first(raw.status) });
  const [list, branches, categories] = await Promise.all([
    adminListVehicles(admin.id, { q: f.q, branchId: f.branch, categoryId: f.category, status: f.status }),
    adminListBranches(admin.id),
    adminListCategories(admin.id),
  ]);
  if (!list.ok) return <Alert tone="error">{list.message}</Alert>;

  return (
    <div className="mt-6 space-y-6">
      <Form action="/admin/fleet" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Search" htmlFor="q" className="lg:col-span-2">
          <Input id="q" name="q" placeholder="Plate, make, model, VIN" defaultValue={f.q ?? ""} />
        </Field>
        <Field label="Branch" htmlFor="branch">
          <Select id="branch" name="branch" defaultValue={f.branch ?? ""}>
            <option value="">All</option>
            {branches.ok && branches.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Category" htmlFor="category">
          <Select id="category" name="category" defaultValue={f.category ?? ""}>
            <option value="">All</option>
            {categories.ok && categories.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={f.status ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
        </Field>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
          <Button type="submit">Filter</Button>
          <Link href="/admin/fleet" className="inline-flex h-10 items-center px-3 text-sm font-medium text-slate-600 hover:text-slate-900">Reset</Link>
        </div>
      </Form>

      {list.vehicles.length === 0 ? (
        <EmptyState title="No vehicles found" action={<LinkButton href="/admin/fleet/new">Add vehicle</LinkButton>} />
      ) : (
        <div className="relative overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <caption className="sr-only">Vehicles</caption>
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">Vehicle</th>
                <th scope="col" className="px-4 py-3">Plate</th>
                <th scope="col" className="px-4 py-3">Branch</th>
                <th scope="col" className="px-4 py-3">Daily rate</th>
                <th scope="col" className="px-4 py-3">Mileage</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.vehicles.map((v) => (
                <tr key={v.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/fleet/${v.id}`} className="font-semibold text-brand-700 hover:underline">
                      {v.make} {v.model}
                    </Link>
                    <p className="text-xs text-slate-500">{v.year} · {v.categoryName} · {titleCase(v.transmission)}</p>
                  </td>
                  <td className="px-4 py-3 font-mono">{v.plateNumber}</td>
                  <td className="px-4 py-3">{v.branchName}</td>
                  <td className="whitespace-nowrap px-4 py-3">{formatAED(v.effectiveDailyRateFils)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{v.mileageKm.toLocaleString("en-AE")} km</td>
                  <td className="px-4 py-3">
                    <div className="space-y-2">
                      <StatusBadge status={v.status} />
                      <AdminForm action={setVehicleStatusAction} submitLabel="Set" variant="outline" inline>
                        <input type="hidden" name="vehicleId" value={v.id} />
                        <label htmlFor={`st-${v.id}`} className="sr-only">New status for {v.plateNumber}</label>
                        <select id={`st-${v.id}`} name="status" defaultValue={v.status} className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs">
                          {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                        </select>
                      </AdminForm>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
