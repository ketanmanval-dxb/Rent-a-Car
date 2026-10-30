"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, Input, fieldAria } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/lib/action-state";
import { loginAction, registerAction } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(loginAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email" error={fe.email}>
        <Input
          {...fieldAria("email", fe.email)}
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
        />
      </Field>
      <Field label="Password" htmlFor="password" error={fe.password}>
        <Input {...fieldAria("password", fe.password)} type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingText="Signing in…">
        Sign in
      </SubmitButton>
      <p className="text-center text-sm text-slate-600">
        New to DriveEasy?{" "}
        <Link href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"} className="font-semibold text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(registerAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Full name" htmlFor="name" error={fe.name} required>
        <Input {...fieldAria("name", fe.name)} autoComplete="name" required defaultValue={state.values?.name} />
      </Field>
      <Field label="Email" htmlFor="email" error={fe.email} required>
        <Input {...fieldAria("email", fe.email)} type="email" autoComplete="email" required defaultValue={state.values?.email} />
      </Field>
      <Field label="Password" htmlFor="password" error={fe.password} hint="At least 8 characters." required>
        <Input {...fieldAria("password", fe.password, true)} type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirm password" htmlFor="confirmPassword" error={fe.confirmPassword} required>
        <Input {...fieldAria("confirmPassword", fe.confirmPassword)} type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingText="Creating account…">
        Create account
      </SubmitButton>
      <p className="text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-semibold text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
