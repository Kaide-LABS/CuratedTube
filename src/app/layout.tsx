import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { QuotaBadge } from "@/components/QuotaBadge";

export const metadata: Metadata = {
  title: "CuratedTube",
  description: "Keep the discovery, kill the rabbit hole. A focus-oriented scoped YouTube client.",
  applicationName: "CuratedTube",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-100 text-sm font-bold text-zinc-900">
                C
              </span>
              <span className="text-zinc-100">CuratedTube</span>
            </Link>
            <QuotaBadge />
          </div>
        </header>
        <main className="mx-auto max-w-7xl">{children}</main>
      </body>
    </html>
  );
}
