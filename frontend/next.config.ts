import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pin the workspace root. Next infers it by walking UP for a lockfile and taking the
// OUTERMOST match — and a stray empty `package-lock.json` in the home directory (no
// package.json beside it) made it choose `/home/mint`, i.e. the developer's entire home
// folder, as the project root. That inflates filesystem watching and cache validation on
// every build, and the same thing happens on the VPS if a stray lockfile exists there.
// Pinning it makes the build deterministic regardless of what sits above the repo.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const apiHost = process.env.NEXT_PUBLIC_API_URL
  ? new URL(process.env.NEXT_PUBLIC_API_URL).hostname
  : "localhost";

const nextConfig: NextConfig = {
  // Don't advertise the framework (LS-16). nginx needs `server_tokens off;` for its half.
  poweredByHeader: false,
  turbopack: { root: projectRoot },
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
      // The live host, spelled out. On prod this is what `apiHost` already
      // resolves to, so it changes nothing there — it is here for LOCAL runs:
      // the dev database is a production snapshot, so every `image_url` in it is
      // an absolute https://lolo-shop96.com/uploads/… URL. Without this line a
      // local production build (`next start`) rejects all 54 catalog photos with
      // «hostname not configured» → 400, and the storefront renders imageless.
      { protocol: "https", hostname: "lolo-shop96.com", pathname: "/uploads/**" },
      { protocol: "https", hostname: "www.lolo-shop96.com", pathname: "/uploads/**" },
      { protocol: "https", hostname: "**.amazonaws.com", pathname: "/**" },
    ],
    // ⚠️ WHY LOCAL DEV LOADS PHOTOS SLOWLY, AND WHY THIS LINE MUST STAY.
    // With the optimizer off, every <Image> falls back to a plain <img> on the
    // RAW url. That is harmless where dev uploads live on disk, and expensive
    // here: the dev database is a PRODUCTION SNAPSHOT, so every image_url is an
    // absolute https://lolo-shop96.com/uploads/… and localhost pulls the 4-6 MB
    // originals off the live VPS — measured 20.0 MB for the four tiles above the
    // fold, re-fetched on EVERY reload and back-navigation because /uploads is
    // `private, no-store`. Prod is unaffected: NODE_ENV=production keeps the
    // optimizer on and serves the same photo as 17,778 B of WebP.
    //
    // DO NOT "fix" this by setting it to false. Tried and measured 2026-08-03:
    // the optimizer must first fetch the original, and Next hard-codes
    // `AbortSignal.timeout(7000)` on that fetch (server/image-optimizer.js:924)
    // with NO config surface. One 6,003,607 B photo takes 9.7 s to pull from the
    // VPS, so every catalog image 500s with «upstream image response timed out»
    // and dev renders NO photos at all — strictly worse than slow ones.
    // The real fix is to stop dev pointing at prod: mirror the catalog photos to
    // the local backend's /uploads (shrunk with the same sharp policy
    // lib/upload.js applies) and rewrite the dev DB's absolute URLs to
    // localhost:4000. Then the optimizer works locally and this can go.
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
