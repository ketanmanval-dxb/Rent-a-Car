import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { TripSummary } from "@/components/booking/trip-summary";
import { ReservationStatusBadge, StatusBadge } from "@/components/booking/status-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatAED, formatDateTime, formatFuelLevel, titleCase } from "@/lib/format";
import { requireAdmin } from "@/app/_data/session";
import { toQuoteView } from "@/app/_data/quote";
import { adminGetReservation, adminListDamageReports, CHECKOUT_EARLY_HOURS } from "@/server/admin";
import { licenceUrl } from "@/server/profile";
import { AdminForm } from "../../admin-form";
import { DamageReportForm, FuelLevelField, MileageField } from "../../admin-fields";
import { adminCancelAction, chargeDamageAction, checkInAction, checkOutAction } from "./actions";

export const metadata: Metadata = { title: "Reservation" };

export default function AdminReservationPage({ params }: PageProps<"/admin/reservations/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin(`/admin/reservations/${id}`);
  const ref = decodeURIComponent(id);
  if (!z.uuid().safeParse(ref).success && !/^[A-Z0-9-]{4,20}$/i.test(ref)) notFound();
  const res = await adminGetReservation(admin.id, ref);
  if (!res.ok) {
    if (res.code === "NOT_FOUND") notFound();
    return <Alert tone="error">{res.message}</Alert>;
  }
  const r = res.reservation;
  const damage = await adminListDamageReports(admin.id, { reservationId: r.id });
  const reports = damage.ok ? damage.reports : [];
  const tz = r.pickupBranch.timezone;
  const quote = toQuoteView(r.quote);
  const a = r.agreement;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
        <Link href="/admin/reservations" className="hover:text-slate-900">
          ← Reservations
        </Link>
      </nav>
      <PageHeader
        eyebrow={<span className="font-mono">{r.reference}</span>}
        title={`${r.vehicle.make} ${r.vehicle.model} · ${r.vehicle.plateNumber}`}
        description={`${r.customer.name} (${r.customer.email}) · booked ${formatDateTime(r.createdAt, tz)}`}
        actions={<ReservationStatusBadge status={r.status} />}
      />

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {r.status === "CONFIRMED" ? (
            <Card>
              <CardHeader>
                <CardTitle>Check out (hand over the car)</CardTitle>
                <p className="mt-0.5 text-xs text-slate-500">
                  Opens {CHECKOUT_EARLY_HOURS} hours before pick-up. Verify the driver&apos;s licence first.
                </p>
              </CardHeader>
              <CardBody>
                <AdminForm action={checkOutAction} submitLabel="Check out vehicle" pendingLabel="Checking out…" labels={{ mileageKm: "Mileage", fuelLevel: "Fuel" }}>
                  <input type="hidden" name="reservationId" value={r.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <MileageField id="co-mileage" label="Odometer at pick-up (km)" />
                    <FuelLevelField id="co-fuel" label="Fuel level at pick-up" />
                    <Field label="Notes" htmlFor="co-notes" className="sm:col-span-2">
                      <Textarea id="co-notes" name="notes" maxLength={2000} className="min-h-16" placeholder="Existing scratches, accessories handed over…" />
                    </Field>
                  </div>
                </AdminForm>
              </CardBody>
            </Card>
          ) : null}

          {r.status === "PICKED_UP" && a ? (
            <Card>
              <CardHeader>
                <CardTitle>Check in (car returned)</CardTitle>
                <p className="mt-0.5 text-xs text-slate-500">
                  Late fees and fuel charges are calculated on the server and charged automatically.
                </p>
              </CardHeader>
              <CardBody>
                <AdminForm action={checkInAction} submitLabel="Check in vehicle" pendingLabel="Checking in…" labels={{ mileageKm: "Mileage", fuelLevel: "Fuel" }}>
                  <input type="hidden" name="reservationId" value={r.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <MileageField id="ci-mileage" label="Odometer at return (km)" min={a.pickupMileageKm} />
                    <FuelLevelField id="ci-fuel" label="Fuel level at return" defaultValue={a.pickupFuelLevel} />
                    <Field label="Notes" htmlFor="ci-notes" className="sm:col-span-2">
                      <Textarea id="ci-notes" name="notes" maxLength={2000} className="min-h-16" />
                    </Field>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="holdDeposit" className="size-4 rounded border-slate-300 text-brand-600" />
                      Keep deposit on hold (damage being assessed)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="needsMaintenance" className="size-4 rounded border-slate-300 text-brand-600" />
                      Send vehicle to maintenance
                    </label>
                  </div>
                </AdminForm>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Trip</CardTitle>
            </CardHeader>
            <CardBody>
              <TripSummary
                vehicle={r.vehicle}
                pickupBranch={r.pickupBranch}
                returnBranch={r.returnBranch}
                pickupAt={r.pickupAt}
                returnAt={r.returnAt}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Driver</CardTitle>
            </CardHeader>
            <CardBody className="text-sm">
              {r.driver ? (
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Name</dt>
                    <dd className="font-medium text-slate-900">{r.driver.fullName}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Phone</dt>
                    <dd className="text-slate-900">{r.driver.phone}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Licence</dt>
                    <dd className="text-slate-900">
                      {r.driver.licenceNumber} ({r.driver.licenceCountry}), expires {r.driver.licenceExpiry}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Licence file</dt>
                    <dd>
                      {r.driver.hasLicenceFile ? (
                        <a href={licenceUrl(r.customer.id)} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 hover:underline">
                          View licence
                        </a>
                      ) : (
                        <span className="text-amber-700">Not uploaded</span>
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-slate-600">No driver details recorded.</p>
              )}
            </CardBody>
          </Card>

          {a ? (
            <Card>
              <CardHeader>
                <CardTitle>Rental agreement</CardTitle>
              </CardHeader>
              <CardBody>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Checked out</dt>
                    <dd className="text-slate-900">{formatDateTime(a.checkedOutAt, tz)}</dd>
                    <dd className="text-slate-700">
                      {a.pickupMileageKm.toLocaleString("en-AE")} km · fuel {formatFuelLevel(a.pickupFuelLevel)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Checked in</dt>
                    {a.checkedInAt ? (
                      <>
                        <dd className="text-slate-900">{formatDateTime(a.checkedInAt, r.returnBranch.timezone)}</dd>
                        <dd className="text-slate-700">
                          {a.returnMileageKm?.toLocaleString("en-AE")} km · fuel {formatFuelLevel(a.returnFuelLevel ?? 0)}
                        </dd>
                        <dd className="text-slate-700">
                          Driven {((a.returnMileageKm ?? 0) - a.pickupMileageKm).toLocaleString("en-AE")} km
                          {a.lateMinutes > 0 ? ` · ${a.lateMinutes} min late (${formatAED(a.lateFeeFils)})` : ""}
                          {a.fuelChargeFils > 0 ? ` · fuel charge ${formatAED(a.fuelChargeFils)}` : ""}
                        </dd>
                      </>
                    ) : (
                      <dd className="text-slate-600">On rent</dd>
                    )}
                  </div>
                </dl>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Damage reports</CardTitle>
            </CardHeader>
            <CardBody className="space-y-6">
              {reports.length === 0 ? <p className="text-sm text-slate-600">No damage recorded for this booking.</p> : null}
              {reports.map((d) => (
                <div key={d.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={d.severity} />
                    <span className="text-sm text-slate-600">
                      {titleCase(d.stage)} · {formatDateTime(d.createdAt, tz)}
                    </span>
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
                          <img src={u} alt={`Damage photo ${i + 1}`} className="size-24 rounded-lg object-cover ring-1 ring-slate-200" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {r.deposit && r.deposit.status === "HELD" ? (
                    <div className="mt-3">
                      <AdminForm action={chargeDamageAction} submitLabel="Charge from deposit" variant="outline" inline confirm="Capture this amount from the customer's deposit?">
                        <input type="hidden" name="reportId" value={d.id} />
                        <label htmlFor={`charge-${d.id}`} className="sr-only">
                          Amount in AED
                        </label>
                        <Input id={`charge-${d.id}`} name="amount" inputMode="decimal" placeholder="AED" className="h-8 w-28" required />
                      </AdminForm>
                    </div>
                  ) : null}
                </div>
              ))}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-slate-900">Report new damage</h3>
                <DamageReportForm vehicleId={r.vehicle.id} reservationId={r.id} defaultStage={r.status === "CONFIRMED" ? "PICKUP" : "RETURN"} />
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Card>
            <CardBody>
              <PriceBreakdown quote={quote} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              {r.payments.length === 0 ? <p className="text-slate-600">No payments yet.</p> : null}
              {r.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2">
                  <span className="text-slate-700">
                    {titleCase(p.kind)} {formatAED(p.amountFils)}
                    {p.refundedFils ? <span className="text-xs text-slate-500"> (refunded {formatAED(p.refundedFils)})</span> : null}
                  </span>
                  <StatusBadge status={p.status} />
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                <span className="text-slate-700">Deposit {r.deposit ? formatAED(r.deposit.amountFils) : ""}</span>
                {r.deposit ? <StatusBadge status={r.deposit.status} /> : <span className="text-slate-500">None</span>}
              </div>
            </CardBody>
          </Card>
          {r.status === "PENDING" || r.status === "CONFIRMED" ? (
            <Card>
              <CardHeader>
                <CardTitle>Cancel booking</CardTitle>
              </CardHeader>
              <CardBody>
                <AdminForm action={adminCancelAction} submitLabel="Cancel booking" variant="danger" confirm="Cancel this booking and refund the customer?">
                  <input type="hidden" name="reservationId" value={r.id} />
                  <Field label="Reason" htmlFor="cancel-reason">
                    <Input id="cancel-reason" name="reason" maxLength={500} placeholder="Shown in the audit log" />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="waiveFee" className="size-4 rounded border-slate-300 text-brand-600" />
                    Waive cancellation fee
                  </label>
                </AdminForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
