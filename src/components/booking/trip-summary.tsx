import { VehicleImage } from "@/components/vehicle/vehicle-image";
import { formatDateTime } from "@/lib/format";

type BranchLike = { name: string; address: string; timezone: string };

/** Vehicle + pick-up/return summary used on checkout, rental detail and voucher. */
export function TripSummary({
  vehicle,
  pickupBranch,
  returnBranch,
  pickupAt,
  returnAt,
  compact,
}: {
  vehicle: { make: string; model: string; imageUrl: string | null; category: { name: string } };
  pickupBranch: BranchLike;
  returnBranch: BranchLike;
  pickupAt: Date | string;
  returnAt: Date | string;
  compact?: boolean;
}) {
  const name = `${vehicle.make} ${vehicle.model}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {!compact ? <VehicleImage src={vehicle.imageUrl} alt={name} className="aspect-[16/10] w-32 shrink-0" /> : null}
        <div>
          <p className="text-sm text-slate-500">{vehicle.category.name}</p>
          <p className="text-lg font-semibold text-slate-900">{name}</p>
          <p className="text-xs text-slate-500">or similar</p>
        </div>
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium text-slate-500">Pick-up</dt>
          <dd className="font-semibold text-slate-900">{formatDateTime(pickupAt, pickupBranch.timezone)}</dd>
          <dd className="text-slate-700">{pickupBranch.name}</dd>
          <dd className="text-xs text-slate-500">{pickupBranch.address}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Return</dt>
          <dd className="font-semibold text-slate-900">{formatDateTime(returnAt, returnBranch.timezone)}</dd>
          <dd className="text-slate-700">{returnBranch.name}</dd>
          <dd className="text-xs text-slate-500">{returnBranch.address}</dd>
        </div>
      </dl>
      <p className="text-xs text-slate-500">Times shown in each branch&apos;s local time ({pickupBranch.timezone.replace("_", " ")}).</p>
    </div>
  );
}
