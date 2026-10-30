"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui/button";

/** Shared body for error.tsx boundaries. */
export function RouteError({
  error,
  retry,
  title = "Something went wrong",
}: {
  error: unknown;
  retry: () => void;
  title?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest =
    typeof error === "object" && error !== null && "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <div role="alert" className="rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-6">
            <path d="M12 8v5M12 16.5h.01" strokeLinecap="round" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">
          We could not load this page. Please try again. If the problem continues, contact your branch.
        </p>
        {digest ? <p className="mt-2 font-mono text-xs text-slate-400">Reference: {digest}</p> : null}
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={() => retry()}>Try again</Button>
          <LinkButton href="/" variant="outline">
            Go home
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
