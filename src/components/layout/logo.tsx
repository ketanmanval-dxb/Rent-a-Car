import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-bold tracking-tight text-slate-900" aria-label="DriveEasy home">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
          <path d="M3 13l2-6a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 7l2 6v4a1 1 0 0 1-1 1h-1.5M3 13v4a1 1 0 0 0 1 1h1.5M3 13h18" />
          <circle cx="7.5" cy="17.5" r="1.8" />
          <circle cx="16.5" cy="17.5" r="1.8" />
        </svg>
      </span>
      <span className="text-lg">
        Drive<span className="text-brand-600">Easy</span>
      </span>
    </Link>
  );
}
