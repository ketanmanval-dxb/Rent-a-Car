"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/** Live countdown for a reservation hold. Server remains the source of truth for expiry. */
export function HoldCountdown({ expiresAt, className }: { expiresAt: string; className?: string }) {
  const target = new Date(expiresAt).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) return <span className={className}>…</span>;
  const left = Math.max(0, target - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span
      className={cn("font-mono font-semibold tabular-nums", left < 120000 ? "text-red-700" : "text-slate-900", className)}
      role="timer"
      aria-live="off"
    >
      {left === 0 ? "expired" : `${m}:${String(s).padStart(2, "0")}`}
    </span>
  );
}
