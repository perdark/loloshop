import type { Metadata, Viewport } from "next";
import { Amiri, Cairo, Great_Vibes, Playfair_Display } from "next/font/google";
import { DeepLinkHandler } from "@/components/DeepLinkHandler";
import { PwaRegistrar } from "@/components/PwaRegistrar";
import { PushRegistrar } from "@/components/PushRegistrar";
import { StaffAppBeacon } from "@/components/StaffAppBeacon";
import { ToasterProvider } from "@/components/providers/ToasterProvider";
import { APP_ONLY, buildGateScript } from "@/lib/app-gate";
import "./globals.css";

const amiri = Amiri({
  variable: "--font-amiri",
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
});

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const greatVibes = Great_Vibes({
  variable: "--font-great-vibes",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  // Absolute base for OG/Twitter/manifest URLs — without it they resolve against
  // localhost at build time and break link previews in production.
  metadataBase: new URL("https://lolo-shop96.com"),
  title: {
    default: "لولو شوب — أوشحة وروبات التخرج",
    template: "%s · لولو شوب",
  },
  description:
    "صمم وشاح تخرجك أو روبك الخاص مع لولو شوب — أزياء التخرج الفاخرة للجامعات العراقية.",
  applicationName: "لولو شوب",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "لولو شوب",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "ar_IQ",
    siteName: "لولو شوب",
    title: "لولو شوب — أوشحة وروبات التخرج",
    description:
      "صمم وشاح تخرجك أو روبك الخاص مع لولو شوب — أزياء التخرج الفاخرة للجامعات العراقية.",
    images: [
      {
        url: "/gown-sash.png",
        width: 1402,
        height: 1122,
        alt: "لولو شوب — أوشحة وروبات التخرج",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#faf4ea",
  width: "device-width",
  initialScale: 1,
  /**
   * ⚠️ THIS LINE IS WHAT MAKES `env(safe-area-inset-*)` WORK AT ALL.
   *
   * Owner report (2026-08-05): «some android phones the app have no margin from
   * top and iphone too so they can't search or press the logo or login».
   *
   * Two separate things caused that, and both need fixing together:
   *
   * ① **Android 15+ (API 35) forces edge-to-edge and removed the opt-out.** We
   *    ship `targetSdkVersion = 36` (android/variables.gradle), so on those
   *    phones the WebView already draws underneath the status bar. Nothing in
   *    the app asked for that; the platform does it.
   * ② **Without `viewport-fit: cover`, `env(safe-area-inset-*)` resolves to 0.**
   *    The codebase already had 13 safe-area usages — the bottom tab bar, the
   *    auth card, the onboarding portal — and every one of them was silently
   *    computing to zero. They looked correct in review and did nothing on a
   *    device.
   *
   * So ① pushed content under the notch while ② disabled the only mechanism that
   * could push it back out. Setting this makes the insets report real values, and
   * the sticky top bars (`.safe-top` in globals.css) finally reserve room for the
   * status bar instead of hiding the logo, search and login behind it.
   *
   * ⚠️ Do NOT remove this without also removing every `.safe-top` / `env()` use:
   * on iOS this is what puts the page edge-to-edge in the first place, so the two
   * halves are a matched pair.
   */
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      dir="rtl"
      lang="ar"
      suppressHydrationWarning
      className={`${amiri.variable} ${cairo.variable} ${playfair.variable} ${greatVibes.variable} h-full`}
    >
      <body className="min-h-full flex flex-col font-sans antialiased">
        {/*
          App-only gate. FIRST element in <body> deliberately: it must run before any of the
          page's DOM parses, so a browser visitor never sees a flash of the real storefront
          before being sent to the store. Capacitor injects its bridge at document start, so
          `window.Capacitor` is already readable this early — see lib/app-gate.ts.
          Emitted only when NEXT_PUBLIC_APP_ONLY=1, so the kill switch removes it entirely.
        */}
        {APP_ONLY && (
          <script dangerouslySetInnerHTML={{ __html: buildGateScript() }} />
        )}
        <PwaRegistrar />
        {/*
          Deep-link router for the native shells. Renders nothing; inert in a browser.
          Mounted in the root layout because a link can arrive at any moment, on any
          route — including before the student has navigated anywhere themselves.
        */}
        <DeepLinkHandler />
        {/*
          Push notifications. Renders nothing; inert in a browser and while signed out.
          Root layout because the tap that OPENS the app has to find a listener already
          attached, whatever route the shell happens to boot on.
        */}
        <PushRegistrar />
        {/*
          «هل فتح الموظف التطبيق اليوم؟» (migration 084). Renders nothing and is inert for
          everyone except role === 'staff'. Root layout because a staff member who opens the
          app and lands ANYWHERE has opened the app — gating it to /staff would under-count
          exactly the casual opens the daily report is asking about.
        */}
        <StaffAppBeacon />
        {children}
        <ToasterProvider />
      </body>
    </html>
  );
}
