import Form from "next/form";
import Link from "next/link";
import { Field, Select, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import type { CategoryOption } from "@/lib/types";
import type { FilterParams, TripParams } from "@/lib/search-params";
import { toQueryString, tripToQuery } from "@/lib/search-params";

/** GET filter form; keeps the trip in hidden fields. Works without JS. */
export function SearchFilters({
  trip,
  filters,
  categories,
}: {
  trip: TripParams;
  filters: FilterParams;
  categories: CategoryOption[];
}) {
  const tripQuery = tripToQuery(trip);
  return (
    <Form action="/search" className="space-y-4" aria-label="Filter results">
      {Object.entries(tripQuery).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Field label="Category" htmlFor="category">
        <Select id="category" name="category" defaultValue={filters.category ?? ""}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Transmission" htmlFor="transmission">
        <Select id="transmission" name="transmission" defaultValue={filters.transmission ?? ""}>
          <option value="">Any</option>
          <option value="automatic">Automatic</option>
          <option value="manual">Manual</option>
        </Select>
      </Field>
      <Field label="Minimum seats" htmlFor="seats">
        <Select id="seats" name="seats" defaultValue={filters.seats ? String(filters.seats) : ""}>
          <option value="">Any</option>
          {[2, 4, 5, 7, 8].map((n) => (
            <option key={n} value={n}>
              {n}+
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Fuel type" htmlFor="fuel">
        <Select id="fuel" name="fuel" defaultValue={filters.fuel ?? ""}>
          <option value="">Any</option>
          <option value="petrol">Petrol</option>
          <option value="diesel">Diesel</option>
          <option value="hybrid">Hybrid</option>
          <option value="electric">Electric</option>
        </Select>
      </Field>
      <Field label="Max price per day (AED)" htmlFor="maxPrice">
        <Input
          id="maxPrice"
          name="maxPrice"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          placeholder="No limit"
          defaultValue={filters.maxPrice ?? ""}
        />
      </Field>
      <Field label="Sort by" htmlFor="sort">
        <Select id="sort" name="sort" defaultValue={filters.sort ?? "price_asc"}>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </Select>
      </Field>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1">
          Apply filters
        </Button>
        <Link href={`/search${toQueryString(tripQuery)}`} className="inline-flex h-10 items-center px-3 text-sm font-medium text-slate-600 hover:text-slate-900">
          Clear
        </Link>
      </div>
    </Form>
  );
}
