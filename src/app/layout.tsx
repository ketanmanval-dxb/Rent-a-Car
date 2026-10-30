import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { HeaderAccount } from "./_components/header-account";

export const metadata: Metadata = {
  title: {
    default: "DriveEasy | Car rental in the UAE",
    template: "%s | DriveEasy",
  },
  description: "Rent a car across UAE branches. Transparent AED pricing, instant confirmation and digital pick-up vouchers.",
};

export const viewport: Viewport = {
  themeColor: "#1b5ef5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">
        <SiteHeader account={<HeaderAccount />} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
