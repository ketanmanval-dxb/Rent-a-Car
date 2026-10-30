"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/cn";

/**
 * Generic admin form: posts to a server action, shows the result and a field-error
 * summary (labels come from `labels`). Fields are passed as children (server-rendered).
 */
export function AdminForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  labels = {},
  className,
  variant,
  size,
  resetOnSuccess,
  confirm,
  inline,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  labels?: Record<string, string>;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  resetOnSuccess?: boolean;
  /** Ask for confirmation before submitting (destructive actions). */
  confirm?: string;
  /** Compact layout for row actions. */
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  const errors = Object.entries(state.fieldErrors ?? {}).filter(([, v]) => v && v.length);

  return (
    <form
      ref={ref}
      action={formAction}
      className={cn(inline ? "inline-flex flex-wrap items-center gap-2" : "space-y-4", className)}
      onSubmit={(e) => {
        // Submit manually so React doesn't reset the inputs after the action
        // (keeps what the admin typed when validation fails). Without JS the
        // native form action still works.
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        const fd = new FormData(e.currentTarget, submitter);
        startTransition(() => formAction(fd));
      }}
    >
      {!inline && state.message ? (
        <Alert tone={state.ok ? "success" : "error"} title={state.ok ? undefined : state.message}>
          {state.ok ? state.message : null}
          {errors.length ? (
            <ul className="list-inside list-disc">
              {errors.map(([k, v]) => (
                <li key={k}>
                  {labels[k] ?? k}: {v![0]}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {children}
      <Button type="submit" variant={variant} size={size ?? (inline ? "sm" : "md")} disabled={pending} aria-busy={pending}>
        {pending ? <Spinner className="size-4" /> : null}
        {pending ? (pendingLabel ?? submitLabel) : submitLabel}
      </Button>
      {inline && state.message ? (
        <span role={state.ok ? "status" : "alert"} className={cn("text-xs", state.ok ? "text-emerald-700" : "text-red-700")}>
          {state.ok ? state.message : (errors[0]?.[1]?.[0] ?? state.message)}
        </span>
      ) : null}
    </form>
  );
}
