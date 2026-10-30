import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { StatusBadge } from "@/components/booking/status-badge";
import { AvailabilityCalendar } from "@/components/vehicle/availability-calendar";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { addDaysToDateString, formatAED, formatDateTime, titleCase, zonedDateString } from "@/lib/format";
import { requireAdmin } from "@/app/_data/session";
import { adminGetVehicle, adminListBranches, adminListCategories, adminListDamageReports, adminListMaintenanceBlocks } from "@/server/admin";
import { getAvailabilityCalendar, getBranch, listFeatures } from "@/server/catalog";
import { VehicleForm } from "../vehicle-form";

export const metadata: Metadata = { title: "Vehicle" };

export default function AdminVehiclePage({ params }: PageProps<"/admin/fleet/[id]">) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
        <Link href="/admin/fleet" className="hover:text-slate-900">← Fleet</Link>
      </nav>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content params={params} />
      </Suspense>
    </>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const admin = await requireAdmin(`/admin/fleet/${id}`);
  const res = await adminGetVehicle(admin.id, id);
  if (!res.ok) {
    if (res.code === "NOT_FOUND") notFound();
    return <Alert tone="error">{res.message}</Alert>;
  }
  const v = res.vehicle;
  const branch = await getBranch(v.branchId);
  const tz = branch?.timezone ?? "Asia/Dubai";
  const today = zonedDateString(new Date(), tz);
  const [branches, categories, features, calendar, blocks, damage] = await Promise.all([
    adminListBranches(admin.id),
    adminListCategories(admin.id),
    listFeatures(),
    getAvailabilityCalendar(v.id, today, addDaysToDateString(today, 89)),
    adminListMaintenanceBlocks(admin.id, { vehicleId: v.id }),
    adminListDamageReports(admin.id, { vehicleId: v.id }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={<span className="font-mono">{v.plateNumber}</span>}
        title={`${v.make} ${v.model} ${v.year}`}
        description={`${v.categoryName} · ${v.branchName} · ${formatAED(v.effectiveDailyRateFils)}/day`}
        actions={<StatusBadge status={v.status} />}
      />
      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardBody>
            {branches.ok && categories.ok ? (
              <VehicleForm vehicle={v} branches={branches.branches} categories={categories.categories} features={features} />
            ) : (
              <Alert tone="error">Could not load branches or categories.</Alert>
            )}
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Next 90 days</CardTitle></CardHeader>
            <CardBody><AvailabilityCalendar days={calendar} /></CardBody>
          </Card>
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Maintenance</CardTitle>
              <Link href="/admin/maintenance" className="text-sm font-semibold text-brand-700 hover:underline">Schedule</Link>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              {blocks.ok && blocks.blocks.length ? (
                blocks.blocks.map((b) => (
                  <div key={b.id}>
                    <p className="text-slate-900">{formatDateTime(b.startAt, b.timezone)} → {formatDateTime(b.endAt, b.timezone)}</p>
                    <p className="text-slate-500">{b.reason} · {titleCase(b.status)}</p>
                  </div>
                ))
              ) : (
                <p className="text-slate-600">No upcoming maintenance.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Damage history</CardTitle>
              <Link href="/admin/damage" className="text-sm font-semibold text-brand-700 hover:underline">Report</Link>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              {damage.ok && damage.reports.length ? (
                damage.reports.map((d) => (
                  <div key={d.id} className="flex items-start justify-between gap-2">
                    <p className="text-slate-700">{d.description}</p>
                    <StatusBadge status={d.severity} />
                  </div>
                ))
              ) : (
                <p className="text-slate-600">No damage reported.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
