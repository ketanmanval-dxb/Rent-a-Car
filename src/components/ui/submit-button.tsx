"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { Spinner } from "./spinner";

/** Submit button that disables itself and shows a spinner while its form's action is pending. */
export function SubmitButton({
  children,
  pendingText,
  variant,
  size,
  disabled,
  ...props
}: ComponentProps<"button"> & { pendingText?: string; variant?: ButtonVariant; size?: ButtonSize }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending || disabled} aria-busy={pending} {...props}>
      {pending ? (
        <>
          <Spinner className="size-4" />
          {pendingText ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
