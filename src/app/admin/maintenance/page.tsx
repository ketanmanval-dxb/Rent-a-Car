import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StatusBadge } from "@/components/booking/status-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, titleCase } from "@/lib/format";
import { TIME_SLOTS } from "@/lib/search-params";
import { requireAdmin } from "@/app/_data/session";
import { adminListMaintenanceBlocks, adminListVehicles } from "@/server/admin";
import { AdminForm } from "../admin-form";
import { createMaintenanceAction, setMaintenanceStatusAction } from "../actions";

export const metadata: Metadata = { title: "Maintenance" };

export default function MaintenancePage() {
  return (
    <>
      <PageHeader title="Maintenance blocks" description="Block a car for service. Blocked periods are hidden from search and can't overlap bookings." />
      <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}

const NEXT: Record<string, { status: string; label: string }[]> = {
  SCHEDULED: [
    { status: "IN_PROGRESS", label: "Start" },
    { status: "CANCELLED", label: "Cancel" },
  ],
  IN_PROGRESS: [{ status: "COMPLETED", label: "Complete" }],
};

async function Content() {
  const admin = await requireAdmin("/admin/maintenance");
  const [blocks, vehicles] = await Promise.all([adminListMaintenanceBlocks(admin.id), adminListVehicles(admin.id)]);
  if (!blocks.ok) return <Alert tone="error">{blocks.message}</Alert>;

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_24rem]">
      <section aria-label="Upcoming maintenance" className="space-y-3">
        {blocks.blocks.length === 0 ? (
          <EmptyState title="No upcoming maintenance" description="Schedule a block with the form." />
        ) : (
          blocks.blocks.map((b) => (
            <Card key={b.id}>
              <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/fleet/${b.vehicleId}`} className="font-semibold text-brand-700 hover:underline">
                      {b.vehicle}
                    </Link>
                    <StatusBadge status={b.status} />
                  </div>
                  <p className="text-sm text-slate-700">
                    {formatDateTime(b.startAt, b.timezone)} → {formatDateTime(b.endAt, b.timezone)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {b.branchName} · {b.reason}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(NEXT[b.status] ?? []).map((n) => (
                    <AdminForm
                      key={n.status}
                      action={setMaintenanceStatusAction}
                      submitLabel={n.label}
                      variant={n.status === "CANCELLED" ? "ghost" : "outline"}
                      inline
                      confirm={n.status === "CANCELLED" ? "Cancel this maintenance block?" : undefined}
                    >
                      <input type="hidden" name="blockId" value={b.id} />
                      <input type="hidden" name="status" value={n.status} />
                    </AdminForm>
                  ))}
                  {!NEXT[b.status] ? <span className="text-xs text-slate-500">{titleCase(b.status)}</span> : null}
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </section>
      <Card className="self-start">
        <CardHeader>
          <CardTitle>Schedule maintenance</CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">Times are in the vehicle&apos;s branch time zone.</p>
        </CardHeader>
        <CardBody>
          <AdminForm
            action={createMaintenanceAction}
            submitLabel="Schedule block"
            resetOnSuccess
            labels={{ vehicleId: "Vehicle", startDate: "Start date", endDate: "End date", reason: "Reason" }}
          >
            <Field label="Vehicle" htmlFor="m-vehicle" required>
              <Select id="m-vehicle" name="vehicleId" defaultValue="" required>
                <option value="" disabled>
                  Select a vehicle
                </option>
                {vehicles.ok &&
                  vehicles.vehicles
                    .filter((v) => v.status !== "RETIRED")
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plateNumber} · {v.make} {v.model} ({v.branchName})
                      </option>
                    ))}
              </Select>
            </Field>
            <fieldset className="min-w-0">
              <legend className="text-sm font-medium text-slate-700">Start</legend>
              <div className="mt-1.5 flex gap-2">
                <Input type="date" name="startDate" aria-label="Start date" required className="min-w-0 flex-1" />
                <div className="w-28 shrink-0">
                  <Select name="startTime" aria-label="Start time" defaultValue="08:00">
                    {TIME_SLOTS.map((t) => <option key={t}>{t}</option>)}
                  </Select>
                </div>
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="text-sm font-medium text-slate-700">End</legend>
              <div className="mt-1.5 flex gap-2">
                <Input type="date" name="endDate" aria-label="End date" required className="min-w-0 flex-1" />
                <div className="w-28 shrink-0">
                  <Select name="endTime" aria-label="End time" defaultValue="18:00">
                    {TIME_SLOTS.map((t) => <option key={t}>{t}</option>)}
                  </Select>
                </div>
              </div>
            </fieldset>
            <Field label="Reason" htmlFor="m-reason" required>
              <Textarea id="m-reason" name="reason" required minLength={3} maxLength={500} className="min-h-16" placeholder="e.g. 20,000 km service" />
            </Field>
          </AdminForm>
        </CardBody>
      </Card>
    </div>
  );
}
