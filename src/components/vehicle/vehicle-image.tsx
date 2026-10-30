import { cn } from "@/lib/cn";

/** Vehicle photo, or a neutral illustrated placeholder when the fleet record has no image. */
export function VehicleImage({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-200", className)}>
      {src ? (
        // Vehicle images may be local (/vehicles/...) or provider URLs; keep a plain img to avoid remote-pattern config.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400" role="img" aria-label={alt}>
          <svg viewBox="0 0 64 32" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-1/2 max-w-40">
            <path d="M4 22v-4l6-2 8-7h20l10 7 10 2v4a2 2 0 0 1-2 2h-4M4 22a2 2 0 0 0 2 2h4M22 24h20" strokeLinejoin="round" />
            <circle cx="16" cy="24" r="4" />
            <circle cx="48" cy="24" r="4" />
            <path d="M20 16h26" />
          </svg>
        </div>
      )}
    </div>
  );
}
