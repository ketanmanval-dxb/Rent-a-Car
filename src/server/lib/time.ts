// Time-zone helpers without external deps. All instants are JS Dates (UTC);
// local dates are 'YYYY-MM-DD' strings in an IANA zone.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Offset (ms) of `timeZone` from UTC at `instant` (positive east of UTC). */
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** UTC instant of local wall-clock time `date` + `time` (HH:mm) in `timeZone`. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [h, m] = time.split(":").map(Number);
  const guess = new Date(`${date}T00:00:00Z`).getTime() + (h * 60 + m) * 60_000;
  // Two passes handle DST transitions (not relevant for Asia/Dubai, but correct elsewhere).
  let utc = guess - tzOffsetMs(new Date(guess), timeZone);
  utc = guess - tzOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

/** Next local date string. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
