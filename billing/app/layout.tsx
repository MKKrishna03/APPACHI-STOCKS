import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import RateBoard from "@/components/RateBoard";
import Sidebar from "@/components/Sidebar";
import StaffIdentityCapture from "@/components/StaffIdentityCapture";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "Appachi Jewellery",
  description: "Quotation and billing system",
};

// viewportFit: "cover" lets the page draw under the status bar/notch (needed
// when embedded edge-to-edge in the Stocks app's Capacitor WebView) and is
// what makes env(safe-area-inset-top) resolve to a real value below, instead
// of just 0 — without it the header's safe-area padding would be a no-op.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <StaffIdentityCapture />
        <header
          className="sticky top-0 z-40 flex items-center justify-between px-4 sm:px-6 pb-3 border-b"
          style={{
            background:
              "linear-gradient(to right, #2b2420, #3a2f26)",
            borderColor: "var(--primary)",
            // Extends the header's solid background up under the status bar
            // instead of app content merging with it, and keeps the actual
            // title/rate-board row pushed below the status bar/notch.
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)",
          }}
        >
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="heading text-lg sm:text-xl font-semibold tracking-wide"
              style={{ color: "var(--primary)" }}
            >
              Appachi Jewellery
            </Link>
            {/* Plain <a> on purpose: basePath only prefixes <Link>, so this
                leaves /billing and goes back to the Stocks app at "/". */}
            <a
              href="/"
              className="text-xs font-semibold hover:underline"
              style={{ color: "#d8c9a8" }}
            >
              ← Stocks
            </a>
          </div>
          <RateBoard />
        </header>
        <div className="flex flex-1">
          <Sidebar />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
