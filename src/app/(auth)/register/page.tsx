import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "../auth-forms";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create your account</h1>
      <p className="mt-1 text-sm text-slate-600">You will add your driver details and licence before your first booking.</p>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          {searchParams.then((sp) => (
            <RegisterForm next={typeof sp.next === "string" ? sp.next : undefined} />
          ))}
        </Suspense>
      </div>
    </>
  );
}
