"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select, Field, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { formatAED } from "@/lib/format";
import { TIME_SLOTS } from "@/lib/search-params";
import { cancelAction, changeDatesAction, type CancelState, type ChangeState } from "./actions";

export function ChangeDatesForm({
  reservationId,
  pickupBranchId,
  returnBranchId,
  initial,
  minDate,
  idempotencyKey,
}: {
  reservationId: string;
  pickupBranchId: string;
  returnBranchId: string;
  initial: { pd: string; pt: string; rd: string; rt: string };
  minDate: string;
  idempotencyKey: string;
}) {
  const [state, action] = useActionState<ChangeState, FormData>(changeDatesAction, {});
  const [values, setValues] = useState(initial);
  const key = `${values.pd}T${values.pt}|${values.rd}T${values.rt}`;
  const preview = state.preview && state.preview.key === key ? state.preview : undefined;
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="reservationId" value={reservationId} />
      <input type="hidden" name="pickupBranchId" value={pickupBranchId} />
      <input type="hidden" name="returnBranchId" value={returnBranchId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      {state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="min-w-0 space-y-1.5">
          <legend className="text-sm font-medium text-slate-700">New pick-up</legend>
          <div className="flex gap-2">
            <Input type="date" name="pd" aria-label="New pick-up date" min={minDate} value={values.pd} onChange={set("pd")} className="min-w-0 flex-1" required />
            <div className="w-28 shrink-0">
              <Select name="pt" aria-label="New pick-up time" value={values.pt} onChange={set("pt")}>
                {TIME_SLOTS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </div>
          </div>
        </fieldset>
        <fieldset className="min-w-0 space-y-1.5">
          <legend className="text-sm font-medium text-slate-700">New return</legend>
          <div className="flex gap-2">
            <Input type="date" name="rd" aria-label="New return date" min={values.pd || minDate} value={values.rd} onChange={set("rd")} className="min-w-0 flex-1" required />
            <div className="w-28 shrink-0">
              <Select name="rt" aria-label="New return time" value={values.rt} onChange={set("rt")}>
                {TIME_SLOTS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </div>
          </div>
        </fieldset>
      </div>

      {preview ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {!preview.available ? (
            <Alert tone="error">The car is not available for these dates. Try different dates.</Alert>
          ) : (
            <>
              <PriceBreakdown quote={preview.quote} title="New price" />
              <p className="text-sm font-medium text-slate-900">
                {preview.dueNowFils > 0
                  ? `You will be charged ${formatAED(preview.dueNowFils)} now.`
                  : preview.dueNowFils < 0
                    ? `You will be refunded ${formatAED(-preview.dueNowFils)}.`
                    : preview.differenceFils !== 0
                      ? `The new total differs by ${formatAED(preview.differenceFils)}; it will be included when you pay.`
                      : "No price change."}
              </p>
            </>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="preview" variant="outline" pendingText="Checking…">
          Check new price
        </SubmitButton>
        {preview?.available ? (
          <SubmitButton name="intent" value="confirm" pendingText="Changing…">
            Confirm new dates
          </SubmitButton>
        ) : null}
      </div>
    </form>
  );
}

export function CancelForm({
  reservationId,
  refundFils,
  feeFils,
  free,
  pending,
}: {
  reservationId: string;
  refundFils: number;
  feeFils: number;
  free: boolean;
  pending: boolean;
}) {
  const [state, action] = useActionState<CancelState, FormData>(cancelAction, {});
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => setConfirming(true)}>
        Cancel booking
      </Button>
    );
  }
  return (
    <form action={action} className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
      <input type="hidden" name="reservationId" value={reservationId} />
      <p className="text-sm font-semibold text-red-900">Cancel this booking?</p>
      <p className="text-sm text-red-900">
        {pending
          ? "This booking is unpaid, so cancelling is free."
          : free
            ? `You will be refunded ${formatAED(refundFils)} in full and your deposit hold released.`
            : `A cancellation fee of ${formatAED(feeFils)} applies. You will be refunded ${formatAED(refundFils)} and your deposit hold released.`}
      </p>
      {state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <Field label="Reason (optional)" htmlFor="reason">
        <Textarea id="reason" name="reason" maxLength={500} className="min-h-16" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="danger" pendingText="Cancelling…">
          Yes, cancel booking
        </SubmitButton>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Keep booking
        </Button>
      </div>
    </form>
  );
}
