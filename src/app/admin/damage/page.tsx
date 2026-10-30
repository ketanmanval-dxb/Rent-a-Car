import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StatusBadge } from "@/components/booking/status-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAED, formatDateTime, titleCase } from "@/lib/format";
import { requireAdmin } from "@/app/_data/session";
import { adminListDamageReports, adminListVehicles } from "@/server/admin";
import { DamageReportForm } from "../admin-fields";

export const metadata: Metadata = { title: "Damage reports" };

export default function DamagePage() {
  return (
    <>
      <PageHeader title="Damage reports" description="Record damage with photos. To charge a deposit, open the linked reservation." />
      <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const admin = await requireAdmin("/admin/damage");
  const [reports, vehicles] = await Promise.all([adminListDamageReports(admin.id), adminListVehicles(admin.id)]);
  if (!reports.ok) return <Alert tone="error">{reports.message}</Alert>;
  const vehicleOptions = vehicles.ok
    ? vehicles.vehicles.map((v) => ({ id: v.id, label: `${v.plateNumber} · ${v.make} ${v.model} (${v.branchName})` }))
    : [];

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_24rem]">
      <section aria-label="Reports" className="space-y-4">
        {reports.reports.length === 0 ? (
          <EmptyState title="No damage reported" description="Reports created here or during check-in will appear in this list." />
        ) : (
          reports.reports.map((d) => (
            <Card key={d.id}>
              <CardBody>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={d.severity} />
                  <span className="font-mono text-sm font-semibold text-slate-900">{d.plateNumber}</span>
                  <span className="text-sm text-slate-500">
                    {titleCase(d.stage)} · {formatDateTime(d.createdAt)}
                  </span>
                  {d.reservationReference && d.reservationId ? (
                    <Link href={`/admin/reservations/${d.reservationId}`} className="font-mono text-sm text-brand-700 hover:underline">
                      {d.reservationReference}
                    </Link>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-slate-800">{d.description}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Estimate {formatAED(d.estimatedCostFils)} · charged {formatAED(d.chargedFils)}
                </p>
                {d.imageUrls.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {d.imageUrls.map((u, i) => (
                      <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                        {/* Private, auth-checked file route; plain img is intended. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt={`Damage photo ${i + 1} for ${d.plateNumber}`} className="size-24 rounded-lg object-cover ring-1 ring-slate-200" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ))
        )}
      </section>
      <Card className="self-start">
        <CardHeader>
          <CardTitle>New damage report</CardTitle>
        </CardHeader>
        <CardBody>
          <DamageReportForm vehicles={vehicleOptions} defaultStage="OTHER" />
        </CardBody>
      </Card>
    </div>
  );
}
