"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CalendarDay } from "@/lib/types";
import { cn } from "@/lib/cn";
import { buttonClasses } from "@/components/ui/button";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Monday-first weekday index of a YYYY-MM-DD date. */
function weekdayIndex(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * Per-vehicle availability calendar (days are in the branch time zone).
 * If `bookHref` is given, the user can pick a start and end day and continue to booking
 * with `pd`/`rd` appended to that URL.
 */
export function AvailabilityCalendar({
  days,
  selectedStart,
  selectedEnd,
  bookHref,
}: {
  days: CalendarDay[];
  selectedStart?: string;
  selectedEnd?: string;
  bookHref?: string;
}) {
  const months = useMemo(() => {
    const map = new Map<string, CalendarDay[]>();
    for (const d of days) {
      const k = monthKey(d.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(d);
    }
    return [...map.entries()];
  }, [days]);
  const statusByDate = useMemo(() => new Map(days.map((d) => [d.date, d.status])), [days]);

  const [index, setIndex] = useState(() => {
    const i = selectedStart ? months.findIndex(([k]) => k === monthKey(selectedStart)) : 0;
    return Math.max(0, i);
  });
  const [start, setStart] = useState<string | undefined>(selectedStart);
  const [end, setEnd] = useState<string | undefined>(selectedEnd);
  const [message, setMessage] = useState<string | null>(null);

  if (months.length === 0) {
    return <p className="text-sm text-slate-600">No availability data for this period.</p>;
  }

  const [key, monthDays] = months[index];
  const leading = weekdayIndex(monthDays[0].date);

  const rangeHasConflict = (a: string, b: string) =>
    days.some((d) => d.date >= a && d.date < b && d.status !== "available");

  const pick = (date: string) => {
    if (!bookHref) return;
    setMessage(null);
    if (!start || (start && end) || date <= start) {
      setStart(date);
      setEnd(undefined);
      return;
    }
    if (rangeHasConflict(start, date)) {
      setMessage("That range includes unavailable days. Choose different dates.");
      return;
    }
    setEnd(date);
  };

  const inRange = (date: string) => start && end && date > start && date < end;

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          className={buttonClasses("ghost", "sm")}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label="Previous month"
        >
          ‹
        </button>
        <h3 className="text-sm font-semibold text-slate-900" aria-live="polite">
          {monthLabel(key)}
        </h3>
        <button
          type="button"
          className={buttonClasses("ghost", "sm")}
          onClick={() => setIndex((i) => Math.min(months.length - 1, i + 1))}
          disabled={index === months.length - 1}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label={`Availability for ${monthLabel(key)}`}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1 font-medium text-slate-500" role="columnheader">
            {w}
          </div>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <div key={`pad-${i}`} aria-hidden />
        ))}
        {monthDays.map((d) => {
          const status = statusByDate.get(d.date);
          const selected = d.date === start || d.date === end;
          const label = `${d.date}: ${status === "available" ? "available" : status === "maintenance" ? "unavailable (maintenance)" : "booked"}`;
          const dayNum = Number(d.date.slice(8));
          const clickable = Boolean(bookHref) && (status === "available" || (start && !end && d.date > start));
          return (
            <button
              key={d.date}
              type="button"
              role="gridcell"
              aria-label={label}
              aria-selected={selected || undefined}
              disabled={!clickable}
              onClick={() => pick(d.date)}
              className={cn(
                "aspect-square rounded-lg text-sm font-medium transition-colors",
                status === "available" && "bg-emerald-50 text-emerald-800",
                status === "booked" && "bg-red-50 text-red-700 line-through decoration-red-300",
                status === "maintenance" && "bg-amber-50 text-amber-800 line-through decoration-amber-300",
                inRange(d.date) && "bg-brand-100 text-brand-900",
                selected && "bg-brand-600 text-white",
                clickable && !selected && "hover:ring-2 hover:ring-brand-400",
                !bookHref && "cursor-default",
              )}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-emerald-100 ring-1 ring-emerald-300" aria-hidden /> Available
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-red-100 ring-1 ring-red-300" aria-hidden /> Booked
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-amber-100 ring-1 ring-amber-300" aria-hidden /> Maintenance
        </li>
      </ul>
      {bookHref ? (
        <div className="mt-4 space-y-2">
          {message ? (
            <p className="text-sm text-red-600" role="alert">
              {message}
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              {!start ? "Select a pick-up day." : !end ? "Now select a return day." : `Selected ${start} to ${end}.`}
            </p>
          )}
          {start && end ? (
            <Link
              href={`${bookHref}${bookHref.includes("?") ? "&" : "?"}pd=${start}&rd=${end}`}
              className={buttonClasses("primary", "md", "w-full")}
            >
              Continue with these dates
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
