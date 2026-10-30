"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatAED } from "@/lib/format";
import { payAction, type PayState } from "./actions";

const CHARGE_OPTIONS = [
  { value: "succeed", label: "Payment succeeds" },
  { value: "fail", label: "Card declined" },
  { value: "cancel", label: "Customer cancels" },
] as const;

const DEPOSIT_OPTIONS = [
  { value: "succeed", label: "Deposit hold succeeds" },
  { value: "fail", label: "Deposit hold declined" },
] as const;

export function PaymentForm({
  reservationId,
  initialAttemptId,
  totalFils,
  depositFils,
}: {
  reservationId: string;
  initialAttemptId: string;
  totalFils: number;
  depositFils: number;
}) {
  const [state, action] = useActionState<PayState, FormData>(payAction, { attemptId: initialAttemptId });
  const isRetry = Boolean(state.message);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="reservationId" value={reservationId} />
      <input type="hidden" name="attemptId" value={state.attemptId ?? initialAttemptId} />

      {state.message ? (
        <Alert tone="error" title={state.code === "CANCELLED" ? "Payment cancelled" : "Payment not completed"}>
          {state.message}
          {state.code === "EXPIRED" ? (
            <p className="mt-1">
              <Link href="/search" className="font-semibold underline">
                Search again
              </Link>
            </p>
          ) : (
            <p className="mt-1">No money was taken for the failed attempt. You can try again below.</p>
          )}
        </Alert>
      ) : null}

      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">Test mode: simulate the payment result</p>
        <p className="text-xs text-amber-800">No real card is used. Choose what the payment provider should do.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="text-sm font-medium text-slate-800">Rental charge ({formatAED(totalFils)})</legend>
            <div className="mt-2 space-y-1.5">
              {CHARGE_OPTIONS.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="simulate"
                    value={o.value}
                    defaultChecked={o.value === "succeed"}
                    className="size-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium text-slate-800">Security deposit ({formatAED(depositFils)})</legend>
            <div className="mt-2 space-y-1.5">
              {DEPOSIT_OPTIONS.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="depositSimulate"
                    value={o.value}
                    defaultChecked={o.value === "succeed"}
                    className="size-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>

      <SubmitButton size="lg" className="w-full" pendingText="Processing payment…">
        {isRetry ? "Try payment again" : `Pay ${formatAED(totalFils)}`}
      </SubmitButton>
      <p className="text-center text-xs text-slate-500">
        You will be charged {formatAED(totalFils)} now and a refundable {formatAED(depositFils)} deposit will be held.
      </p>
    </form>
  );
}
