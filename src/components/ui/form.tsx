import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "block w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500 aria-[invalid=true]:border-red-500";

export function Input({ className, ...props }: ComponentProps<"input">) {
  const isFile = props.type === "file";
  return (
    <input
      className={cn(
        control,
        isFile
          ? "py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-700"
          : "h-10",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "h-10 pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-2", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("block text-sm font-medium text-slate-700", className)} {...props} />;
}

/** Label + control + hint/error wiring. Pass the control's id as `htmlFor`. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
  required,
}: {
  label: ReactNode;
  htmlFor: string;
  error?: string | string[];
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="text-red-600" aria-hidden>
            {" "}
            *
          </span>
        ) : null}
      </Label>
      {children}
      {message ? (
        <p id={`${htmlFor}-error`} className="text-sm text-red-600">
          {message}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** id/name/aria props for a control inside <Field>. */
export function fieldAria(id: string, error?: string | string[], hint?: boolean) {
  const has = Array.isArray(error) ? error.length > 0 : Boolean(error);
  return {
    id,
    name: id,
    "aria-invalid": has || undefined,
    "aria-describedby": has ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}
