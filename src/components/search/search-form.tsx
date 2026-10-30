"use client";

import Form from "next/form";
import { useState } from "react";
import { Field, Select, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { TIME_SLOTS } from "@/lib/search-params";
import type { BranchOption } from "@/lib/types";
import { addDaysToDateString } from "@/lib/format";

export type SearchFormValues = {
  pickup?: string;
  return?: string;
  pd: string;
  pt: string;
  rd: string;
  rt: string;
};

/**
 * GET form to /search. Works without JavaScript; with JS it does client navigation.
 * `hidden` carries active filters when used on the results page.
 */
export function SearchForm({
  branches,
  values,
  minDate,
  hidden,
  layout = "hero",
  errors,
  action = "/search",
  submitLabel,
  returnBranches,
}: {
  branches: BranchOption[];
  values: SearchFormValues;
  minDate: string;
  hidden?: Record<string, string | undefined>;
  layout?: "hero" | "compact";
  errors?: Record<string, string>;
  /** GET target; defaults to /search. The booking page points it at itself. */
  action?: string;
  submitLabel?: string;
  /** Return-branch choices when they differ from pick-up choices. */
  returnBranches?: BranchOption[];
}) {
  const [differentReturn, setDifferentReturn] = useState(Boolean(values.return && values.return !== values.pickup));
  const [pd, setPd] = useState(values.pd);
  const [rd, setRd] = useState(values.rd);
  const [pickup, setPickup] = useState(values.pickup ?? "");
  const pickupTz = branches.find((b) => b.id === pickup)?.timezone;

  const onPickupDate = (v: string) => {
    setPd(v);
    if (v && rd && rd <= v) setRd(addDaysToDateString(v, 1));
  };

  return (
    <Form action={action} className="space-y-4" aria-label={action === "/search" ? "Search for a rental car" : "Trip details"}>
      {hidden
        ? Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))
        : null}
      <div className={"grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto]"}>
        <div className="space-y-3 sm:col-span-2 lg:col-span-1">
          <Field label="Pick-up branch" htmlFor="pickup" error={errors?.pickup} required>
            <Select
              id="pickup"
              name="pickup"
              required
              value={pickup}
              onChange={(e) => setPickup(e.target.value)}
              aria-invalid={errors?.pickup ? true : undefined}
            >
              <option value="" disabled>
                Select a branch
              </option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.city})
                </option>
              ))}
            </Select>
          </Field>
          {differentReturn ? (
            <Field label="Return branch" htmlFor="return" error={errors?.return}>
              <Select id="return" name="return" defaultValue={values.return ?? values.pickup ?? ""} required>
                <option value="" disabled>
                  Select a branch
                </option>
                {(returnBranches ?? branches).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.city})
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={differentReturn}
              onChange={(e) => setDifferentReturn(e.target.checked)}
            />
            Return to a different branch
          </label>
        </div>

        <fieldset className="min-w-0 space-y-1.5">
          <legend className="text-sm font-medium text-slate-700">Pick-up date and time</legend>
          <div className="flex gap-2">
            <Input
              type="date"
              className="min-w-0 flex-1"
              name="pd"
              aria-label="Pick-up date"
              required
              min={minDate}
              value={pd}
              onChange={(e) => onPickupDate(e.target.value)}
              aria-invalid={errors?.pd ? true : undefined}
            />
            <div className="w-28 shrink-0">
            <Select name="pt" aria-label="Pick-up time" defaultValue={values.pt}>
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            </div>
          </div>
          {errors?.pd ? <p className="text-sm text-red-600">{errors.pd}</p> : null}
        </fieldset>

        <fieldset className="min-w-0 space-y-1.5">
          <legend className="text-sm font-medium text-slate-700">Return date and time</legend>
          <div className="flex gap-2">
            <Input
              type="date"
              className="min-w-0 flex-1"
              name="rd"
              aria-label="Return date"
              required
              min={pd || minDate}
              value={rd}
              onChange={(e) => setRd(e.target.value)}
              aria-invalid={errors?.rd ? true : undefined}
            />
            <div className="w-28 shrink-0">
            <Select name="rt" aria-label="Return time" defaultValue={values.rt}>
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            </div>
          </div>
          {errors?.rd ? <p className="text-sm text-red-600">{errors.rd}</p> : null}
        </fieldset>

        <div className="flex items-start sm:col-span-2 lg:col-span-1 lg:pt-7">
          <Button type="submit" size="lg" className="w-full lg:w-auto">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
            {submitLabel ?? (layout === "hero" ? "Find cars" : "Update")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Times are local to the branch{pickupTz ? ` (${pickupTz.replace("_", " ")})` : ""}.
      </p>
    </Form>
  );
}
