/**
 * Pure shape-mapping for the shop feed — no axios, no localStorage, no browser
 * globals, so it is safe to import from a Server Component.
 *
 * WHY THIS FILE EXISTS: the feed is now fetched twice, by two different
 * transports — `lib/catalog.ts` (axios, in the browser, with a Bearer token) and
 * `lib/catalog-server.ts` (native fetch, on the Next server, unauthenticated).
 * They MUST produce byte-identical objects or the server render and the client
 * hydration disagree and React throws away the server HTML — which would undo
 * the entire point of rendering it on the server. One mapper, imported by both.
 */

import type {
  ImageFit,
  PriceRole,
  ShopAudience,
  ShopFeed,
  ShopPackageCard,
  ShopProductCard,
} from "./types";

const baseURL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000";

/** Relative `/uploads/...` paths become absolute; already-absolute URLs pass through. */
export function resolveCatalogMediaUrl(
  url: string | null | undefined
): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${baseURL}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Coerce the raw image_fit value to a known fit, defaulting to "cover". */
export function mapImageFit(raw: unknown): ImageFit {
  return raw === "contain" ? "contain" : "cover";
}

/** Optional «السعر قبل الخصم» — NULL/absent → null, else a finite number. */
export function mapCompareAtPrice(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function mapShopProduct(raw: Record<string, unknown>): ShopProductCard {
  return {
    id: String(raw.id),
    type: raw.type as ShopProductCard["type"],
    nameAr: String(raw.name_ar ?? raw.nameAr),
    description: (raw.description as string | null) ?? null,
    basePrice: Number(raw.base_price ?? raw.basePrice ?? 0),
    compareAtPrice: mapCompareAtPrice(raw.compare_at_price ?? raw.compareAtPrice),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    imageFit: mapImageFit(raw.image_fit ?? raw.imageFit),
    featured: Boolean(raw.featured),
    customizable: Boolean(raw.customizable),
    genderRestriction:
      (raw.gender_restriction as ShopProductCard["genderRestriction"]) ?? null,
  };
}

export function mapShopPackage(raw: Record<string, unknown>): ShopPackageCard {
  return {
    id: String(raw.id),
    nameAr: String(raw.name_ar ?? raw.nameAr),
    price: Number(raw.price ?? 0),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    sort: Number(raw.sort ?? 0),
  };
}

/** The whole `/catalog/shop` payload → ShopFeed. `raw` is the inner `data` object. */
export function mapShopFeed(raw: Record<string, unknown>): ShopFeed {
  const byTypeRaw =
    (raw.by_type as Record<string, Record<string, unknown>[]>) || {};
  const byType: ShopFeed["byType"] = {};
  for (const [type, list] of Object.entries(byTypeRaw)) {
    byType[type as keyof ShopFeed["byType"]] = (list || []).map(mapShopProduct);
  }
  const packages = ((raw.packages as Record<string, unknown>[]) || []).map(
    mapShopPackage
  );
  // Old deployments (and any counting failure) send no `graduates` — normalise the
  // absent case to null so the hero has exactly one "no number" branch to handle.
  const graduatesRaw = Number(raw.graduates);
  return {
    priceRole: (raw.price_role as PriceRole) || "retail",
    audience: (raw.audience as ShopAudience) ?? "guest",
    packages,
    byType,
    graduates:
      Number.isFinite(graduatesRaw) && graduatesRaw > 0 ? graduatesRaw : null,
  };
}
