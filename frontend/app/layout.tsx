import type { Metadata, Viewport } from "next";
import { Amiri, Cairo, Great_Vibes, Playfair_Display } from "next/font/google";
import { ToasterProvider } from "@/components/providers/ToasterProvider";
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
        {children}
        <ToasterProvider />
      </body>
    </html>
  );
}
