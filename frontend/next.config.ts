import type { NextConfig } from "next";

const apiHost = process.env.NEXT_PUBLIC_API_URL
  ? new URL(process.env.NEXT_PUBLIC_API_URL).hostname
  : "localhost";

const nextConfig: NextConfig = {
  // Don't advertise the framework (LS-16). nginx needs `server_tokens off;` for its half.
  poweredByHeader: false,
  // Allow the dev server's HMR/assets to be served to the LAN IP (phone testing on
  // the same Wi-Fi). Derived from NEXT_PUBLIC_API_URL so it tracks the machine IP
  // automatically. Dev-only; ignored in production.
  allowedDevOrigins: [apiHost, "localhost", "127.0.0.1"],
  experimental: {
    // Wraps client route navigations in document.startViewTransition so
    // CSS `view-transition-name` shared elements morph between pages.
    viewTransition: true,
  },
  images: {
    remotePatterns: [
      { protocol: "http", hostname: apiHost, pathname: "/uploads/**" },
      { protocol: "https", hostname: apiHost, pathname: "/uploads/**" },
      { protocol: "http", hostname: "localhost", pathname: "/uploads/**" },
      { protocol: "https", hostname: "**.amazonaws.com", pathname: "/**" },
    ],
    unoptimized: process.env.NODE_ENV === "development",
  },
  // Part of LS-06. These are the headers that are safe to set from the app and can't break
  // it — anti-framing matters because JWTs and 90-day device tokens live in localStorage,
  // so a clickjacked privileged page is a real path to them. The Capacitor shell loads the
  // site as a top-level WebView document, not an iframe, so DENY doesn't affect the app.
  // HSTS and CSP are deliberately NOT here: they belong at nginx (HSTS must cover the API
  // too) and CSP needs a report-only soak first. Do those with the server move.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // No camera/mic anywhere in the app (logo upload is a plain file input, which
          // this doesn't gate). `geolocation` is deliberately NOT denied — the store-location
          // map embed would lose "my location". `interest-cohort` is omitted because FLoC
          // is gone from Chrome and naming it just logs an "unrecognized feature" warning.
          { key: "Permissions-Policy", value: "camera=(), microphone=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
