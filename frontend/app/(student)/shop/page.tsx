import type { Metadata } from "next";
import { Suspense } from "react";
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
    "كل أوشحة وروبات وقبعات وشالات التخرّج من لولو شوب — بأسماء الطلاب وكلياتهم، مخيوطة ومطرّزة بورشتنا في بغداد.",
};

export default function ShopPage() {
  // useSearchParams inside CatalogBrowser requires a Suspense boundary (Next 16).
  return (
    <Suspense fallback={null}>
      <CatalogBrowser />
    </Suspense>
  );
}
