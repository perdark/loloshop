import type { Metadata } from "next";
import { Suspense } from "react";
import { getShopFeedServer } from "@/lib/catalog-server";
import { CatalogBrowser } from "@/components/shop/CatalogBrowser";

/**
 * «القطع» — the whole catalog in one grid.
 *
 * This route used to `redirect("/")` because the grid lived on the home page.
 * The storefront-D home replaced that grid with one slider per family, so the
 * full list needs a home of its own — it is the «القطع» tab, the target of every
 * «كل الأوشحة» link, and where the top bar's search lands.
 */

export const metadata: Metadata = {
  title: "القطع — لولو شوب",
  description:
    "كل أوشحة وروبات وقبعات وشالات التخرّج من لولو شوب — بأسماء الطلاب وكلياتهم، مخيوطة ومطرّزة بورشتنا في ديالى.",
};

/**
 * ⚠️ Without this, the whole page ships EMPTY. This route was statically
 * prerendered, and during static prerender `useSearchParams` inside
 * CatalogBrowser suspends to the boundary below — so the built HTML was the
 * `fallback={null}`: zero tiles, «جارٍ التحميل» forever on any phone where JS
 * is slow or broken (measured on prod 2026-08-17: 0 product links in the HTML,
 * while the home page — dynamic via ISR — carried all of its tiles). Forcing a
 * per-request render makes `useSearchParams` resolve on the server, so the grid
 * is in the first HTML byte again. The feed fetch itself is revalidate-cached
 * (SHOP_FEED_REVALIDATE_SECONDS), so this does not add backend load.
 */
export const dynamic = "force-dynamic";

export default async function ShopPage() {
  // Fetched here rather than in CatalogBrowser's effect so the first grid tiles
  // ship in the server HTML. They were previously the LCP element AND lazy-loaded,
  // which Next itself warns about — nothing could request them until the client
  // had downloaded, hydrated and fetched.
  const feed = await getShopFeedServer();

  // useSearchParams inside CatalogBrowser requires a Suspense boundary (Next 16).
  return (
    <Suspense fallback={null}>
      <CatalogBrowser initialFeed={feed} />
    </Suspense>
  );
}
