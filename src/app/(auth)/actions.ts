"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { signInEmail, signOut, signUpEmail } from "@/server/auth";
import { formValues, fromFailure, safeNext, validationFailure, type ActionState } from "@/app/_lib/action-result";

const loginSchema = z.object({
  email: z.email("Enter a valid email address").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
});

const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name").max(100),
    email: z.email("Enter a valid email address").trim().toLowerCase(),
    password: z.string().min(8, "Use at least 8 characters").max(128),
    confirmPassword: z.string(),
    next: z.string().optional(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData, ["email", "next"]);
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error, values);
  const res = await signInEmail({ email: parsed.data.email, password: parsed.data.password });
  if (!res.ok) return fromFailure(res, values);
  redirect(safeNext(parsed.data.next, "/"));
}

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData, ["name", "email", "next"]);
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error, values);
  const res = await signUpEmail({ name: parsed.data.name, email: parsed.data.email, password: parsed.data.password });
  if (!res.ok) return fromFailure(res, values);
  redirect(safeNext(parsed.data.next, "/profile?welcome=1"));
}

export async function signOutAction(): Promise<void> {
  const res = await signOut();
  if (!res.ok) console.error("signOut failed", res.message);
  redirect("/");
}
