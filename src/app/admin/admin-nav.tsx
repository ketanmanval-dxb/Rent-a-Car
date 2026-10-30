"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export const ADMIN_NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/reservations", label: "Reservations" },
  { href: "/admin/fleet", label: "Fleet" },
  { href: "/admin/branches", label: "Branches" },
  { href: "/admin/pricing", label: "Pricing" },
  { href: "/admin/damage", label: "Damage reports" },
  { href: "/admin/maintenance", label: "Maintenance" },
];

export function AdminNav() {
  const pathname = usePathname();
  return <AdminNavLinks active={(href) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href))} />;
}

export function AdminNavLinks({ active }: { active?: (href: string) => boolean }) {
  return (
    <nav aria-label="Admin" className="flex gap-1 overflow-x-auto lg:flex-col">
      {ADMIN_NAV.map((item) => {
        const isActive = active?.(item.href) ?? false;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium",
              isActive ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
