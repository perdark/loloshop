import type { MetadataRoute } from "next";

const SITE = "https://lolo-shop96.com";

// Keep the role/back-office areas out of search results; let the storefront crawl.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/staff",
        "/wholesaler",
        "/login",
        "/verify-otp",
        "/reset-password",
        "/forgot-password",
        "/join",
      ],
    },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
