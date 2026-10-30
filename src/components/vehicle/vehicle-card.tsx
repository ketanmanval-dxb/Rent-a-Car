import Link from "next/link";
import { VehicleImage } from "./vehicle-image";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { formatAED, pluralize, titleCase } from "@/lib/format";
import type { VehicleSummaryView } from "@/lib/types";

export function VehicleSpecs({ vehicle, className }: { vehicle: VehicleSummaryView; className?: string }) {
  const specs = [
    pluralize(vehicle.seats, "seat"),
    titleCase(vehicle.transmission),
    titleCase(vehicle.fuelType),
    pluralize(vehicle.bags, "bag"),
    pluralize(vehicle.doors, "door"),
  ];
  return (
    <ul className={className ?? "flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600"} aria-label="Specifications">
      {specs.map((s) => (
        <li key={s} className="flex items-center gap-1">
          <span className="size-1 rounded-full bg-slate-300" aria-hidden />
          {s}
        </li>
      ))}
    </ul>
  );
}

export function VehicleCard({
  vehicle,
  dailyRateFils,
  totalFils,
  days,
  oneWayFeeFils,
  href,
  detailsHref,
}: {
  vehicle: VehicleSummaryView;
  dailyRateFils: number;
  totalFils?: number;
  days?: number;
  oneWayFeeFils?: number;
  href: string;
  detailsHref: string;
}) {
  const name = `${vehicle.make} ${vehicle.model}`;
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <Link href={detailsHref} className="block p-3 pb-0" tabIndex={-1} aria-hidden>
        <VehicleImage src={vehicle.imageUrl} alt={name} className="aspect-[16/10] w-full" />
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-slate-900">
              <Link href={detailsHref} className="hover:underline">
                {name}
              </Link>
            </h3>
            <p className="text-sm text-slate-500">
              {vehicle.year} · or similar
            </p>
          </div>
          <Badge tone="brand">{vehicle.category.name}</Badge>
        </div>
        <VehicleSpecs vehicle={vehicle} className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600" />
        {vehicle.features.length > 0 ? (
          <p className="mt-2 line-clamp-1 text-xs text-slate-500">{vehicle.features.slice(0, 4).join(" · ")}</p>
        ) : null}
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div>
            <p className="text-lg font-bold text-slate-900">
              {formatAED(dailyRateFils)}
              <span className="text-sm font-normal text-slate-500"> / day</span>
            </p>
            {totalFils !== undefined && days ? (
              <p className="text-xs text-slate-500">
                {formatAED(totalFils)} total for {pluralize(days, "day")} incl. VAT
                {oneWayFeeFils ? ` and ${formatAED(oneWayFeeFils)} one-way fee` : ""}, before extras
              </p>
            ) : null}
          </div>
          <Link href={href} className={buttonClasses("primary", "md")} aria-label={`Select ${name}`}>
            Select
          </Link>
        </div>
      </div>
    </article>
  );
}
