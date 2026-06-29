import type { MetadataRoute } from "next";

const SITE = "https://lolo-shop96.com";

// Public, crawlable storefront routes. Role areas are intentionally excluded
// (also disallowed in robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/showcase", "/privacy", "/terms", "/delete-account"];
  return routes.map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
}
