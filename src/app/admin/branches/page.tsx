import type { Metadata } from "next";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { filsToAEDInput, formatAED } from "@/lib/format";
import { requireAdmin } from "@/app/_data/session";
import { adminListBranches } from "@/server/admin";
import type { Branch } from "@/server/catalog";
import { AdminForm } from "../admin-form";
import { createBranchAction, toggleBranchAction, updateBranchAction } from "../actions";

export const metadata: Metadata = { title: "Branches" };

const LABELS = {
  code: "Code",
  name: "Name",
  city: "City",
  emirate: "Emirate",
  address: "Address",
  phone: "Phone",
  email: "Email",
  timezone: "Time zone",
  openingHours: "Opening hours",
  latitude: "Latitude",
  longitude: "Longitude",
  locationFee: "Location fee",
};

export default function AdminBranchesPage() {
  return (
    <>
      <PageHeader title="Branches" description="Locations, opening hours, time zones and location fees." />
      <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}

function BranchFields({ b, prefix }: { b?: Branch; prefix: string }) {
  const id = (s: string) => `${prefix}-${s}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Code" htmlFor={id("code")} hint="e.g. DXB-MAR" required>
        <Input id={id("code")} name="code" defaultValue={b?.code} required className="uppercase" />
      </Field>
      <Field label="Name" htmlFor={id("name")} required>
        <Input id={id("name")} name="name" defaultValue={b?.name} required />
      </Field>
      <Field label="Phone" htmlFor={id("phone")} required>
        <Input id={id("phone")} name="phone" type="tel" defaultValue={b?.phone} required />
      </Field>
      <Field label="City" htmlFor={id("city")} required>
        <Input id={id("city")} name="city" defaultValue={b?.city} required />
      </Field>
      <Field label="Emirate" htmlFor={id("emirate")} required>
        <Input id={id("emirate")} name="emirate" defaultValue={b?.emirate} required />
      </Field>
      <Field label="Email" htmlFor={id("email")}>
        <Input id={id("email")} name="email" type="email" defaultValue={b?.email ?? ""} />
      </Field>
      <Field label="Address" htmlFor={id("address")} required className="sm:col-span-2 lg:col-span-3">
        <Input id={id("address")} name="address" defaultValue={b?.address} required />
      </Field>
      <Field label="Opening hours" htmlFor={id("hours")} required>
        <Input id={id("hours")} name="openingHours" defaultValue={b?.openingHours ?? "Daily 08:00-22:00"} required />
      </Field>
      <Field label="Time zone (IANA)" htmlFor={id("tz")} required>
        <Input id={id("tz")} name="timezone" defaultValue={b?.timezone ?? "Asia/Dubai"} required />
      </Field>
      <Field label="Location fee per rental (AED)" htmlFor={id("fee")}>
        <Input id={id("fee")} name="locationFee" inputMode="decimal" defaultValue={b ? filsToAEDInput(b.locationFeeFils) : "0.00"} />
      </Field>
      <Field label="Latitude" htmlFor={id("lat")}>
        <Input id={id("lat")} name="latitude" inputMode="decimal" defaultValue={b?.latitude ?? ""} />
      </Field>
      <Field label="Longitude" htmlFor={id("lng")}>
        <Input id={id("lng")} name="longitude" inputMode="decimal" defaultValue={b?.longitude ?? ""} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
        <input type="checkbox" name="isActive" defaultChecked={b?.isActive ?? true} className="size-4 rounded border-slate-300 text-brand-600" />
        Open for bookings
      </label>
    </div>
  );
}

async function Content() {
  const admin = await requireAdmin("/admin/branches");
  const res = await adminListBranches(admin.id);
  if (!res.ok) return <Alert tone="error">{res.message}</Alert>;
  return (
    <div className="mt-6 space-y-4">
      {res.branches.map((b) => (
        <Card key={b.id}>
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-slate-500">{b.code}</span>
                <h2 className="font-semibold text-slate-900">{b.name}</h2>
                {b.isActive ? <Badge tone="success">Open</Badge> : <Badge tone="neutral">Closed</Badge>}
              </div>
              <p className="text-sm text-slate-600">{b.address}</p>
              <p className="text-xs text-slate-500">
                {b.openingHours} · {b.timezone} · location fee {formatAED(b.locationFeeFils)}
              </p>
            </div>
            <AdminForm
              action={toggleBranchAction}
              submitLabel={b.isActive ? "Close branch" : "Reopen branch"}
              variant="outline"
              inline
              confirm={b.isActive ? "Close this branch for new bookings?" : undefined}
            >
              <input type="hidden" name="branchId" value={b.id} />
              <input type="hidden" name="isActive" value={b.isActive ? "false" : "true"} />
            </AdminForm>
          </CardBody>
          <details className="border-t border-slate-100">
            <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-brand-700">Edit branch</summary>
            <div className="px-5 pb-5">
              <AdminForm action={updateBranchAction} submitLabel="Save branch" labels={LABELS}>
                <input type="hidden" name="branchId" value={b.id} />
                <BranchFields b={b} prefix={`b-${b.code}`} />
              </AdminForm>
            </div>
          </details>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>Add branch</CardTitle>
        </CardHeader>
        <CardBody>
          <AdminForm action={createBranchAction} submitLabel="Create branch" labels={LABELS} resetOnSuccess>
            <BranchFields prefix="new" />
          </AdminForm>
        </CardBody>
      </Card>
    </div>
  );
}
