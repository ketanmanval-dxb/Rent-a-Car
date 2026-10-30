// Map db's server-computed Quote onto the display model. No price math happens here
// beyond formatting line labels; every amount comes from the pricing engine.
import type { Quote } from "@/server/pricing";
import type { QuoteView } from "@/lib/types";
import { formatAED } from "@/lib/format";

export function toQuoteView(q: Quote): QuoteView {
  const otherLines: QuoteView["otherLines"] = [];
  if (q.discountFils) {
    otherLines.push({ label: q.discountLabel ?? "Discount", amountFils: -Math.abs(q.discountFils) });
  }
  if (q.locationFeeFils) {
    otherLines.push({ label: "Location fee", amountFils: q.locationFeeFils });
  }
  return {
    days: q.days,
    dailyRateFils: q.dailyRateFils,
    baseFils: q.baseFils,
    extras: q.extras.map((e) => ({
      name: e.name,
      quantity: e.quantity,
      totalFils: e.totalFils,
      detail:
        e.pricingType === "PER_DAY"
          ? `${formatAED(e.unitFils)} per day${e.quantity > 1 ? " each" : ""}`
          : `${formatAED(e.unitFils)} per rental${e.quantity > 1 ? " each" : ""}`,
    })),
    extrasFils: q.extrasFils,
    oneWayFeeFils: q.oneWayFeeFils,
    otherLines,
    subtotalFils: q.subtotalFils,
    vatBps: q.vatBps,
    vatFils: q.vatFils,
    totalFils: q.totalFils,
    depositFils: q.depositFils,
  };
}
