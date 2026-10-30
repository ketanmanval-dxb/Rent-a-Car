import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "../auth-forms";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Manage your rentals and book faster.</p>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-72 w-full" />}>
          {searchParams.then((sp) => (
            <LoginForm next={typeof sp.next === "string" ? sp.next : undefined} />
          ))}
        </Suspense>
      </div>
    </>
  );
}
