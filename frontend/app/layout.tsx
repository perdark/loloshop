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
  title: "لولو شوب — أوشحة وروبات التخرج",
  description: "صمم وشاح تخرجك مع لولو شوب",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "لولو شوب",
  },
};

export const viewport: Viewport = {
  themeColor: "#f47b42",
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
