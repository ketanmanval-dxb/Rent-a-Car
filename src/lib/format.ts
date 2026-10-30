// Client-safe formatting helpers. Money is integer fils (1 AED = 100 fils).
// Instants are UTC; we always render them in the branch's IANA time zone.

export const DEFAULT_TIMEZONE = "Asia/Dubai";

const aedFormatter = new Intl.NumberFormat("en-AE", {
  style: "currency",
  currency: "AED",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 12345 -> "AED 123.45" */
export function formatAED(fils: number): string {
  if (!Number.isFinite(fils)) return "—";
  return aedFormatter.format(fils / 100).replace(/ /g, " ");
}

/** Whole-dirham display for compact places (cards): 12345 -> "AED 123" */
export function formatAEDShort(fils: number): string {
  if (!Number.isFinite(fils)) return "—";
  return `AED ${Math.round(fils / 100).toLocaleString("en-AE")}`;
}

/** Parse a user-entered dirham amount ("123.45") into integer fils. Returns null when invalid. */
export function parseAEDToFils(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Integer fils -> "123.45" for form default values. */
export function filsToAEDInput(fils: number): string {
  return (fils / 100).toFixed(2);
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDateTime(value: Date | string | number, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(toDate(value));
}

export function formatDate(value: Date | string | number, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(toDate(value));
}

export function formatTime(value: Date | string | number, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(toDate(value));
}

/** Short tz label such as "GST" / "GMT+4" for the given zone at the given instant. */
export function timeZoneLabel(timeZone: string = DEFAULT_TIMEZONE, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** Wall-clock parts of an instant in a zone. */
export function zonedParts(value: Date | string | number, timeZone: string = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(toDate(value));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

/** "YYYY-MM-DD" of an instant in the zone. */
export function zonedDateString(value: Date | string | number, timeZone: string = DEFAULT_TIMEZONE): string {
  return zonedParts(value, timeZone).date;
}

/**
 * Convert a wall-clock date + time in `timeZone` to the UTC instant.
 * `date` is "YYYY-MM-DD", `time` is "HH:mm". Returns null when malformed.
 */
export function zonedToUtc(date: string, time: string, timeZone: string = DEFAULT_TIMEZONE): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const [h, mi] = [Number(tm[1]), Number(tm[2])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes handle DST edges for zones that have them.
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(guess, timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += asUtc - shown;
  }
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}

/** Add whole days to a "YYYY-MM-DD" string. */
export function addDaysToDateString(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export const FUEL_LEVEL_LABELS = ["Empty", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8", "Full"] as const;

export function formatFuelLevel(eighths: number): string {
  return FUEL_LEVEL_LABELS[Math.max(0, Math.min(8, Math.round(eighths)))];
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
