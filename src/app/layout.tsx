import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { QuotaBadge } from "@/components/QuotaBadge";
import { SessionGuard } from "@/components/SessionGuard";
import { InstallPrompt } from "@/components/InstallPrompt";

export const metadata: Metadata = {
  title: "HalalTube",
  description: "Keep the discovery, kill the rabbit hole. A focus-oriented scoped YouTube client.",
  applicationName: "HalalTube",
  manifest: "/manifest.webmanifest",
  // iOS standalone hints (beforeinstallprompt is unsupported there — PRD §9 / context.md §9).
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "HalalTube" },
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
                H
              </span>
              <span className="text-zinc-100">HalalTube</span>
            </Link>
            <div className="flex items-center gap-3">
              <Link
                href="/watch-later"
                className="text-sm font-medium text-zinc-400 hover:text-zinc-200"
              >
                Watch Later
              </Link>
              <InstallPrompt />
              <QuotaBadge />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl">{children}</main>
        {/* Focus limiter: a background monitor that prompts a break, never advances playback. */}
        <SessionGuard />
      </body>
    </html>
  );
}
