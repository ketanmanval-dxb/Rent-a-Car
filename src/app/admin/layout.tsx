import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminNav, AdminNavLinks } from "./admin-nav";

export const metadata: Metadata = { title: { default: "Admin", template: "%s | DriveEasy Admin" } };

// Every admin page calls requireAdmin() itself; this layout is only the frame.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <p className="mb-2 hidden px-3 text-xs font-semibold uppercase tracking-wider text-slate-500 lg:block">Admin</p>
          <div className="-mx-4 border-b border-slate-200 px-4 pb-3 lg:mx-0 lg:border-0 lg:px-0 lg:pb-0">
            <Suspense fallback={<AdminNavLinks />}>
              <AdminNav />
            </Suspense>
          </div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
