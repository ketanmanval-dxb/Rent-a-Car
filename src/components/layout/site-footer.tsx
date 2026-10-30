import Link from "next/link";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="no-print mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-slate-600">
            Car rental across the UAE. Transparent prices in AED, VAT included at checkout.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Rent</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>
              <Link href="/search" className="hover:text-slate-900">
                Find a car
              </Link>
            </li>
            <li>
              <Link href="/branches" className="hover:text-slate-900">
                Branches
              </Link>
            </li>
            <li>
              <Link href="/rentals" className="hover:text-slate-900">
                My rentals
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Account</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>
              <Link href="/profile" className="hover:text-slate-900">
                Profile and licence
              </Link>
            </li>
            <li>
              <Link href="/login" className="hover:text-slate-900">
                Sign in
              </Link>
            </li>
            <li>
              <Link href="/register" className="hover:text-slate-900">
                Create account
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-100 py-4 text-center text-xs text-slate-500">
        DriveEasy demo. Payments run in test mode; no real cards are charged.
      </div>
    </footer>
  );
}
