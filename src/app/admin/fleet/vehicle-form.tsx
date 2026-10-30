import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { filsToAEDInput } from "@/lib/format";
import type { AdminVehicle } from "@/server/admin";
import { AdminForm } from "../admin-form";
import { createVehicleAction, updateVehicleAction } from "../actions";

const LABELS: Record<string, string> = {
  branchId: "Branch",
  categoryId: "Category",
  make: "Make",
  model: "Model",
  year: "Year",
  plateNumber: "Plate number",
  vin: "VIN",
  color: "Colour",
  seats: "Seats",
  doors: "Doors",
  bags: "Bags",
  dailyRate: "Daily rate override",
  mileageKm: "Mileage",
  imageUrl: "Image URL",
};

export function VehicleForm({
  vehicle,
  branches,
  categories,
  features,
}: {
  vehicle?: AdminVehicle;
  branches: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  features: { id: string; name: string }[];
}) {
  const v = vehicle;
  return (
    <AdminForm
      action={v ? updateVehicleAction : createVehicleAction}
      submitLabel={v ? "Save vehicle" : "Add vehicle"}
      labels={LABELS}
      resetOnSuccess={!v}
    >
      {v ? <input type="hidden" name="vehicleId" value={v.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Branch" htmlFor="v-branch" required>
          <Select id="v-branch" name="branchId" defaultValue={v?.branchId ?? ""} required>
            <option value="" disabled>
              Select
            </option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category" htmlFor="v-category" required>
          <Select id="v-category" name="categoryId" defaultValue={v?.categoryId ?? ""} required>
            <option value="" disabled>
              Select
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Plate number" htmlFor="v-plate" required>
          <Input id="v-plate" name="plateNumber" defaultValue={v?.plateNumber} required />
        </Field>
        <Field label="Make" htmlFor="v-make" required>
          <Input id="v-make" name="make" defaultValue={v?.make} required />
        </Field>
        <Field label="Model" htmlFor="v-model" required>
          <Input id="v-model" name="model" defaultValue={v?.model} required />
        </Field>
        <Field label="Year" htmlFor="v-year" required>
          <Input id="v-year" name="year" type="number" min={1990} max={2100} defaultValue={v?.year ?? new Date().getUTCFullYear()} required />
        </Field>
        <Field label="VIN" htmlFor="v-vin" hint="17 characters" required>
          <Input id="v-vin" name="vin" defaultValue={v?.vin} required minLength={17} maxLength={17} className="font-mono uppercase" aria-describedby="v-vin-hint" />
        </Field>
        <Field label="Colour" htmlFor="v-color" required>
          <Input id="v-color" name="color" defaultValue={v?.color} required />
        </Field>
        <Field label="Mileage (km)" htmlFor="v-mileage" required>
          <Input id="v-mileage" name="mileageKm" type="number" min={0} defaultValue={v?.mileageKm ?? 0} required />
        </Field>
        <Field label="Transmission" htmlFor="v-trans">
          <Select id="v-trans" name="transmission" defaultValue={(v?.transmission ?? "automatic").toUpperCase()}>
            <option value="AUTOMATIC">Automatic</option>
            <option value="MANUAL">Manual</option>
          </Select>
        </Field>
        <Field label="Fuel" htmlFor="v-fuel">
          <Select id="v-fuel" name="fuelType" defaultValue={(v?.fuelType ?? "petrol").toUpperCase()}>
            <option value="PETROL">Petrol</option>
            <option value="DIESEL">Diesel</option>
            <option value="HYBRID">Hybrid</option>
            <option value="ELECTRIC">Electric</option>
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Seats" htmlFor="v-seats">
            <Input id="v-seats" name="seats" type="number" min={1} max={60} defaultValue={v?.seats ?? 5} required />
          </Field>
          <Field label="Doors" htmlFor="v-doors">
            <Input id="v-doors" name="doors" type="number" min={0} max={10} defaultValue={v?.doors ?? 4} required />
          </Field>
          <Field label="Bags" htmlFor="v-bags">
            <Input id="v-bags" name="bags" type="number" min={0} max={30} defaultValue={v?.bags ?? 2} required />
          </Field>
        </div>
        <Field label="Daily rate override (AED)" htmlFor="v-rate" hint="Leave empty to use the category rate">
          <Input id="v-rate" name="dailyRate" inputMode="decimal" defaultValue={v?.dailyRateFils ? filsToAEDInput(v.dailyRateFils) : ""} aria-describedby="v-rate-hint" />
        </Field>
        <Field label="Image URL" htmlFor="v-image" hint="e.g. /vehicles/accord.jpg" className="lg:col-span-2">
          <Input id="v-image" name="imageUrl" defaultValue={v?.imageUrl ?? ""} aria-describedby="v-image-hint" />
        </Field>
        <Field label="Description" htmlFor="v-desc" className="sm:col-span-2 lg:col-span-3">
          <Textarea id="v-desc" name="description" maxLength={1000} defaultValue={v?.description} className="min-h-16" />
        </Field>
      </div>
      {features.length ? (
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Features</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <label key={f.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="featureIds"
                  value={f.id}
                  defaultChecked={v?.featureIds.includes(f.id)}
                  className="size-4 rounded border-slate-300 text-brand-600"
                />
                {f.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </AdminForm>
  );
}
