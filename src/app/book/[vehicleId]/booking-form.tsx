"use client";

import Link from "next/link";
import { useActionState, useRef, useState, useTransition } from "react";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { Spinner } from "@/components/ui/spinner";
import { formatAED } from "@/lib/format";
import type { ExtraView, QuoteView } from "@/lib/types";
import { quoteAction, reserveAction, type RentalInput, type ReserveState } from "./actions";

export function BookingForm({
  base,
  extras,
  initialQuote,
  canReserve,
  blockedReason,
}: {
  base: Omit<RentalInput, "extras">;
  extras: ExtraView[];
  initialQuote: QuoteView;
  canReserve: boolean;
  blockedReason?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState(initialQuote);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestId = useRef(0);
  const [state, formAction] = useActionState<ReserveState, FormData>(reserveAction, {});

  const extrasList = Object.entries(selected)
    .filter(([, q]) => q > 0)
    .map(([extraId, quantity]) => ({ extraId, quantity }));

  const update = (extraId: string, quantity: number) => {
    const next = { ...selected, [extraId]: quantity };
    setSelected(next);
    const id = ++requestId.current;
    const list = Object.entries(next)
      .filter(([, q]) => q > 0)
      .map(([eid, q]) => ({ extraId: eid, quantity: q }));
    startTransition(async () => {
      const res = await quoteAction({ ...base, extras: list });
      if (id !== requestId.current) return; // a newer request superseded this one
      if (res.ok) {
        setQuote(res.quote);
        setQuoteError(null);
      } else {
        setQuoteError(res.message);
      }
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader>
          <CardTitle>Add extras</CardTitle>
          <p className="mt-0.5 text-sm text-slate-500">Optional. Prices update instantly and include server-side pricing rules.</p>
        </CardHeader>
        <CardBody>
          {extras.length === 0 ? (
            <p className="text-sm text-slate-600">No extras are available for this rental.</p>
          ) : (
            <fieldset>
              <legend className="sr-only">Extras</legend>
              <ul className="divide-y divide-slate-100">
                {extras.map((e) => {
                  const qty = selected[e.id] ?? 0;
                  const id = `extra-${e.id}`;
                  return (
                    <li key={e.id} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <label htmlFor={id} className="font-medium text-slate-900">
                          {e.name}
                        </label>
                        {e.description ? <p className="text-sm text-slate-600">{e.description}</p> : null}
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {formatAED(e.priceFils)}
                          <span className="font-normal text-slate-500">{e.pricing === "per_day" ? " / day" : " / rental"}</span>
                        </p>
                      </div>
                      {e.maxQuantity > 1 ? (
                        <select
                          id={id}
                          value={qty}
                          onChange={(ev) => update(e.id, Number(ev.target.value))}
                          className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none"
                        >
                          {Array.from({ length: e.maxQuantity + 1 }, (_, n) => (
                            <option key={n} value={n}>
                              {n === 0 ? "None" : n}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={id}
                          type="checkbox"
                          checked={qty > 0}
                          onChange={(ev) => update(e.id, ev.target.checked ? 1 : 0)}
                          className="mt-1 size-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}
        </CardBody>
      </Card>

      <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card>
          <CardBody className="relative">
            <div aria-live="polite" aria-busy={pending}>
              <PriceBreakdown quote={quote} />
            </div>
            {pending ? (
              <div className="absolute right-4 top-4 flex items-center gap-1 text-xs text-slate-500">
                <Spinner className="size-3.5" /> Updating
              </div>
            ) : null}
            {quoteError ? (
              <Alert tone="error" className="mt-3">
                {quoteError}
              </Alert>
            ) : null}
          </CardBody>
        </Card>

        {state.message ? (
          <Alert tone="error" title={state.code === "UNAVAILABLE" ? "No longer available" : "Could not reserve"}>
            {state.message}
            {state.code === "UNAVAILABLE" ? (
              <p className="mt-1">
                <Link href="/search" className="font-semibold underline">
                  Search again
                </Link>
              </p>
            ) : null}
          </Alert>
        ) : null}

        {canReserve ? (
          <form action={formAction}>
            <input type="hidden" name="payload" value={JSON.stringify({ ...base, extras: extrasList })} />
            <SubmitButton size="lg" className="w-full" pendingText="Reserving…" disabled={pending || Boolean(quoteError)}>
              Continue to payment
            </SubmitButton>
            <p className="mt-2 text-center text-xs text-slate-500">
              We hold the car for you while you pay. You are not charged yet.
            </p>
          </form>
        ) : (
          blockedReason
        )}
      </div>
    </div>
  );
}
