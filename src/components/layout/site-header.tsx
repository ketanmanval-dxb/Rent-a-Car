import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Logo } from "./logo";
import { MobileNav, NavLinks, PlainNavLinks, type NavItem } from "./mobile-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonClasses } from "@/components/ui/button";

export type HeaderUser = { name: string; email: string; role: "customer" | "admin" } | null;

const NAV: NavItem[] = [
  { href: "/search", label: "Find a car" },
  { href: "/branches", label: "Branches" },
  { href: "/rentals", label: "My rentals" },
];

/**
 * Static header shell. `account` is a server component that reads the session; it is
 * rendered inside Suspense so the rest of the header is part of the static shell.
 */
export function SiteHeader({ account }: { account: ReactNode }) {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <div className="relative mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Logo />
          <Suspense fallback={<PlainNavLinks items={NAV} />}>
            <NavLinks items={NAV} />
          </Suspense>
        </div>
        <Suspense fallback={<Skeleton className="h-9 w-28" />}>{account}</Suspense>
      </div>
    </header>
  );
}

/** Account area once the session is known. */
export function AccountArea({ user, signOutAction }: { user: HeaderUser; signOutAction: () => Promise<void> }) {
  const signOut = (
    <form action={signOutAction}>
      <button type="submit" className={buttonClasses("ghost", "sm", "w-full justify-start md:w-auto")}>
        Sign out
      </button>
    </form>
  );

  const mobileItems: NavItem[] = [
    ...NAV,
    ...(user ? [{ href: "/profile", label: "Profile and licence" }] : []),
    ...(user?.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <div className="flex items-center gap-2">
      <div className="hidden items-center gap-2 md:flex">
        {user ? (
          <>
            {user.role === "admin" ? (
              <Link href="/admin" className={buttonClasses("outline", "sm")}>
                Admin
              </Link>
            ) : null}
            <Link href="/profile" className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-100">
              <span
                className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700"
                aria-hidden
              >
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-32 truncate font-medium text-slate-700">{user.name}</span>
            </Link>
            {signOut}
          </>
        ) : (
          <>
            <Link href="/login" className={buttonClasses("ghost", "sm")}>
              Sign in
            </Link>
            <Link href="/register" className={buttonClasses("primary", "sm")}>
              Create account
            </Link>
          </>
        )}
      </div>
      <MobileNav
        items={mobileItems}
        footer={
          user ? (
            <div className="space-y-2">
              <p className="px-3 text-sm text-slate-500">Signed in as {user.email}</p>
              {signOut}
            </div>
          ) : (
            <div className="flex gap-2">
              <Link href="/login" className={buttonClasses("outline", "md", "flex-1")}>
                Sign in
              </Link>
              <Link href="/register" className={buttonClasses("primary", "md", "flex-1")}>
                Create account
              </Link>
            </div>
          )
        }
      />
    </div>
  );
}
