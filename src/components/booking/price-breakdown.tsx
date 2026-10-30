import { formatAED, pluralize } from "@/lib/format";
import type { QuoteView } from "@/lib/types";
import { cn } from "@/lib/cn";

/** Server-computed price summary. Never compute prices client-side; only display. */
export function PriceBreakdown({ quote, className, title = "Price breakdown" }: { quote: QuoteView; className?: string; title?: string }) {
  const vatPct = (quote.vatBps / 100).toLocaleString("en-AE", { maximumFractionDigits: 2 });
  return (
    <section aria-label={title} className={cn("text-sm", className)}>
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <dl className="mt-3 space-y-2">
        <Row
          label={`Rental (${pluralize(quote.days, "day")})`}
          detail={`${formatAED(quote.dailyRateFils)} avg. per day`}
          value={quote.baseFils}
        />
        {quote.extras.map((e) => (
          <Row
            key={e.name}
            label={e.quantity > 1 ? `${e.name} x${e.quantity}` : e.name}
            detail={e.detail}
            value={e.totalFils}
          />
        ))}
        {quote.oneWayFeeFils > 0 ? <Row label="One-way fee" value={quote.oneWayFeeFils} /> : null}
        {quote.otherLines.map((l) => (
          <Row key={l.label} label={l.label} detail={l.detail} value={l.amountFils} />
        ))}
        <div className="border-t border-slate-200 pt-2">
          <Row label="Subtotal" value={quote.subtotalFils} />
        </div>
        <Row label={`VAT (${vatPct}%)`} value={quote.vatFils} />
        <div className="flex items-baseline justify-between border-t border-slate-200 pt-3">
          <dt className="text-base font-semibold text-slate-900">Total to pay</dt>
          <dd className="text-xl font-bold text-slate-900" data-testid="quote-total">
            {formatAED(quote.totalFils)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-slate-700">
            Refundable security deposit
            <span className="block text-xs text-slate-500">Held on your card, released after return</span>
          </dt>
          <dd className="whitespace-nowrap font-semibold text-slate-900">{formatAED(quote.depositFils)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Row({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-600">
        {label}
        {detail ? <span className="block text-xs text-slate-500">{detail}</span> : null}
      </dt>
      <dd className={cn("whitespace-nowrap font-medium tabular-nums", value < 0 ? "text-emerald-700" : "text-slate-900")}>{formatAED(value)}</dd>
    </div>
  );
}
