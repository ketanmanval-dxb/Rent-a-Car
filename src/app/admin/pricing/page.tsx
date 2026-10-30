import type { Metadata } from "next";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { filsToAEDInput, formatAED, titleCase } from "@/lib/format";
import { requireAdmin } from "@/app/_data/session";
import { adminListBranches, adminListCategories, adminListExtras, adminListPricingRules } from "@/server/admin";
import { AdminForm } from "../admin-form";
import { createRuleAction, deleteRuleAction, toggleRuleAction, updateCategoryAction, updateExtraAction } from "../actions";

export const metadata: Metadata = { title: "Pricing" };

export default function AdminPricingPage() {
  return (
    <>
      <PageHeader title="Pricing" description="Base rates, deposits, extras and pricing rules. All prices exclude 5% VAT." />
      <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const admin = await requireAdmin("/admin/pricing");
  const [cats, extras, rules, branches] = await Promise.all([
    adminListCategories(admin.id),
    adminListExtras(admin.id),
    adminListPricingRules(admin.id),
    adminListBranches(admin.id),
  ]);
  if (!cats.ok || !extras.ok || !rules.ok || !branches.ok) return <Alert tone="error">Could not load pricing data.</Alert>;
  const branchName = new Map(branches.branches.map((b) => [b.id, b.name]));
  const catName = new Map(cats.categories.map((c) => [c.id, c.name]));

  const describeRule = (r: (typeof rules.rules)[number]) => {
    const scope = [r.categoryId ? catName.get(r.categoryId) : "All categories", r.branchId ? branchName.get(r.branchId) : null].filter(Boolean).join(" · ");
    const pct = r.adjustmentBps != null ? `${r.adjustmentBps > 0 ? "+" : ""}${r.adjustmentBps / 100}%` : "";
    switch (r.kind) {
      case "SEASONAL":
        return `${pct} on ${r.validFrom} to ${r.validTo} · ${scope}`;
      case "WEEKEND":
        return `${pct} on Fri/Sat pick-up days · ${scope}`;
      case "DURATION_DISCOUNT":
        return `${pct} for ${r.minDays}+ days · ${scope}`;
      case "ONE_WAY_FEE":
        return `${formatAED(r.amountFils ?? 0)} from ${branchName.get(r.fromBranchId ?? "") ?? "?"} to ${branchName.get(r.toBranchId ?? "") ?? "?"}`;
    }
  };

  return (
    <div className="mt-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {cats.categories.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 p-4">
              <p className="mb-3 font-semibold text-slate-900">{c.name}</p>
              <AdminForm action={updateCategoryAction} submitLabel="Save" variant="outline" size="sm" labels={{ dailyRate: "Daily rate", deposit: "Deposit", lateFeePerHour: "Late fee" }}>
                <input type="hidden" name="categoryId" value={c.id} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Daily rate (AED)" htmlFor={`c-rate-${c.id}`}>
                    <Input id={`c-rate-${c.id}`} name="dailyRate" inputMode="decimal" defaultValue={filsToAEDInput(c.dailyRateFils)} required />
                  </Field>
                  <Field label="Deposit (AED)" htmlFor={`c-dep-${c.id}`}>
                    <Input id={`c-dep-${c.id}`} name="deposit" inputMode="decimal" defaultValue={filsToAEDInput(c.depositFils)} required />
                  </Field>
                  <Field label="Late fee per hour (AED)" htmlFor={`c-late-${c.id}`}>
                    <Input id={`c-late-${c.id}`} name="lateFeePerHour" inputMode="decimal" defaultValue={filsToAEDInput(c.lateFeePerHourFils)} required />
                  </Field>
                </div>
              </AdminForm>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Extras</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {extras.extras.map((e) => (
            <div key={e.id} className="rounded-xl border border-slate-200 p-4">
              <p className="mb-3 font-semibold text-slate-900">
                {e.name} <span className="text-sm font-normal text-slate-500">({e.pricing === "per_day" ? "per day" : "per rental"})</span>
              </p>
              <AdminForm action={updateExtraAction} submitLabel="Save" variant="outline" size="sm" labels={{ price: "Price", maxQuantity: "Max quantity" }}>
                <input type="hidden" name="extraId" value={e.id} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Price (AED)" htmlFor={`e-price-${e.id}`}>
                    <Input id={`e-price-${e.id}`} name="price" inputMode="decimal" defaultValue={filsToAEDInput(e.priceFils)} required />
                  </Field>
                  <Field label="Max quantity" htmlFor={`e-qty-${e.id}`}>
                    <Input id={`e-qty-${e.id}`} name="maxQuantity" type="number" min={1} max={10} defaultValue={e.maxQuantity} required />
                  </Field>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                    <input type="checkbox" name="isActive" defaultChecked={e.isActive} className="size-4 rounded border-slate-300 text-brand-600" />
                    Offered to customers
                  </label>
                </div>
              </AdminForm>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pricing rules</CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">Seasonal and weekend rules adjust the daily rate; duration discounts adjust the rental; one-way fees apply between branches.</p>
        </CardHeader>
        <CardBody className="space-y-3">
          {rules.rules.length === 0 ? <p className="text-sm text-slate-600">No rules yet.</p> : null}
          {rules.rules.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">{titleCase(r.kind)}</Badge>
                  <span className="font-medium text-slate-900">{r.name}</span>
                  {!r.isActive ? <Badge>Disabled</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-slate-600">{describeRule(r)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <AdminForm action={toggleRuleAction} submitLabel={r.isActive ? "Disable" : "Enable"} variant="outline" inline>
                  <input type="hidden" name="ruleId" value={r.id} />
                  <input type="hidden" name="isActive" value={r.isActive ? "false" : "true"} />
                </AdminForm>
                <AdminForm action={deleteRuleAction} submitLabel="Delete" variant="ghost" inline confirm={`Delete rule "${r.name}"?`}>
                  <input type="hidden" name="ruleId" value={r.id} />
                </AdminForm>
              </div>
            </div>
          ))}

          <details className="rounded-xl border border-dashed border-slate-300 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-brand-700">Add a pricing rule</summary>
            <div className="mt-4">
              <AdminForm
                action={createRuleAction}
                submitLabel="Create rule"
                resetOnSuccess
                labels={{ name: "Name", kind: "Type", adjustmentPct: "Adjustment", amount: "Amount", minDays: "Minimum days", validFrom: "From", validTo: "To" }}
              >
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Name" htmlFor="r-name" required>
                    <Input id="r-name" name="name" required />
                  </Field>
                  <Field label="Type" htmlFor="r-kind" required>
                    <Select id="r-kind" name="kind" defaultValue="SEASONAL">
                      <option value="SEASONAL">Seasonal (date range)</option>
                      <option value="WEEKEND">Weekend (Fri/Sat)</option>
                      <option value="DURATION_DISCOUNT">Duration discount</option>
                      <option value="ONE_WAY_FEE">One-way fee</option>
                    </Select>
                  </Field>
                  <Field label="Priority" htmlFor="r-priority" hint="Higher wins when rules compete">
                    <Input id="r-priority" name="priority" type="number" defaultValue={0} />
                  </Field>
                  <Field label="Category" htmlFor="r-cat">
                    <Select id="r-cat" name="categoryId" defaultValue="">
                      <option value="">All categories</option>
                      {cats.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Pick-up branch" htmlFor="r-branch">
                    <Select id="r-branch" name="branchId" defaultValue="">
                      <option value="">All branches</option>
                      {branches.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Adjustment (%)" htmlFor="r-pct" hint="Seasonal, weekend, duration: e.g. 20 or -10">
                    <Input id="r-pct" name="adjustmentPct" inputMode="decimal" />
                  </Field>
                  <Field label="Valid from" htmlFor="r-from" hint="Seasonal only">
                    <Input id="r-from" name="validFrom" type="date" />
                  </Field>
                  <Field label="Valid to" htmlFor="r-to" hint="Seasonal only">
                    <Input id="r-to" name="validTo" type="date" />
                  </Field>
                  <Field label="Minimum days" htmlFor="r-min" hint="Duration discount only">
                    <Input id="r-min" name="minDays" type="number" min={1} />
                  </Field>
                  <Field label="One-way: from branch" htmlFor="r-fromb">
                    <Select id="r-fromb" name="fromBranchId" defaultValue="">
                      <option value="">—</option>
                      {branches.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="One-way: to branch" htmlFor="r-tob">
                    <Select id="r-tob" name="toBranchId" defaultValue="">
                      <option value="">—</option>
                      {branches.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="One-way fee (AED)" htmlFor="r-amount">
                    <Input id="r-amount" name="amount" inputMode="decimal" />
                  </Field>
                </div>
              </AdminForm>
            </div>
          </details>
        </CardBody>
      </Card>
    </div>
  );
}
