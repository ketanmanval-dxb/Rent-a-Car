import { customType, timestamp } from "drizzle-orm/pg-core";

/** timestamptz, always UTC, mapped to JS Date. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * PostgreSQL tstzrange. We only ever use it as a GENERATED column derived from
 * (start, end) timestamps, half-open `[start, end)`, so the app reads/writes the
 * plain timestamp columns and the database maintains the range.
 */
export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tstzrange";
  },
});
