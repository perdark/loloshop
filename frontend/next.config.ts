import type { NextConfig } from "next";

const apiHost = process.env.NEXT_PUBLIC_API_URL
  ? new URL(process.env.NEXT_PUBLIC_API_URL).hostname
  : "localhost";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
