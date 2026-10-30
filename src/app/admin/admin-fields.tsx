import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { FUEL_LEVEL_LABELS } from "@/lib/format";
import { AdminForm } from "./admin-form";
import { createDamageReportAction } from "./damage/actions";

export function FuelLevelField({ id, label, defaultValue = 8 }: { id: string; label: string; defaultValue?: number }) {
  return (
    <Field label={label} htmlFor={id} required>
      <Select id={id} name="fuelLevel" defaultValue={String(defaultValue)} required>
        {FUEL_LEVEL_LABELS.map((l, i) => (
          <option key={l} value={i}>
            {l}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function MileageField({ id, label, min }: { id: string; label: string; min?: number }) {
  return (
    <Field label={label} htmlFor={id} hint={min !== undefined ? `At least ${min.toLocaleString("en-AE")} km` : undefined} required>
      <Input id={id} name="mileageKm" type="number" inputMode="numeric" min={min ?? 0} step={1} required defaultValue={min} />
    </Field>
  );
}

/** Damage report form. Pass `vehicles` for a picker, or fix `vehicleId` (and optional reservation). */
export function DamageReportForm({
  vehicles,
  vehicleId,
  reservationId,
  defaultStage = "RETURN",
  idPrefix = "dmg",
}: {
  vehicles?: { id: string; label: string }[];
  vehicleId?: string;
  reservationId?: string;
  defaultStage?: "PICKUP" | "RETURN" | "OTHER";
  idPrefix?: string;
}) {
  const p = (s: string) => `${idPrefix}-${s}`;
  return (
    <AdminForm
      action={createDamageReportAction}
      submitLabel="Save damage report"
      pendingLabel="Uploading…"
      resetOnSuccess
      labels={{
        vehicleId: "Vehicle",
        severity: "Severity",
        description: "Description",
        estimatedCost: "Estimated cost",
        image: "Photo",
      }}
    >
      {vehicleId ? <input type="hidden" name="vehicleId" value={vehicleId} /> : null}
      {reservationId ? <input type="hidden" name="reservationId" value={reservationId} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {!vehicleId && vehicles ? (
          <Field label="Vehicle" htmlFor={p("vehicle")} required className="sm:col-span-2">
            <Select id={p("vehicle")} name="vehicleId" required defaultValue="">
              <option value="" disabled>
                Select a vehicle
              </option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="When found" htmlFor={p("stage")}>
          <Select id={p("stage")} name="stage" defaultValue={defaultStage}>
            <option value="PICKUP">At pick-up</option>
            <option value="RETURN">At return</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Severity" htmlFor={p("severity")} required>
          <Select id={p("severity")} name="severity" defaultValue="MINOR" required>
            <option value="MINOR">Minor</option>
            <option value="MODERATE">Moderate</option>
            <option value="MAJOR">Major</option>
          </Select>
        </Field>
        <Field label="Description" htmlFor={p("description")} required className="sm:col-span-2">
          <Textarea id={p("description")} name="description" required minLength={3} maxLength={4000} placeholder="Location and nature of the damage" />
        </Field>
        <Field label="Estimated repair cost (AED)" htmlFor={p("cost")}>
          <Input id={p("cost")} name="estimatedCost" inputMode="decimal" placeholder="0.00" />
        </Field>
        <Field label="Photo" htmlFor={p("image")} hint="One JPG or PNG, up to 4 MB.">
          <Input id={p("image")} name="image" type="file" accept="image/jpeg,image/png" aria-describedby={`${p("image")}-hint`} />
        </Field>
      </div>
    </AdminForm>
  );
}
