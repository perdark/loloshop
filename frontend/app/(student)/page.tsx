import type { Metadata } from "next";
import { getMaintenanceServer, getShopFeedServer } from "@/lib/catalog-server";
import { StudentHome } from "@/components/shop/StudentHome";

/**
 * The storefront home, as a Server Component.
 *
 * This page used to be `"use client"` and fetched its data in a useEffect. The
 * cost, from CrUX field data on this exact URL: LCP 3905 ms, of which **2113 ms
 * was "load delay"** — the gap before the browser could even discover the hero
 * image — against only 289 ms of "load duration" once it started. The bytes were
 * already optimised; the *waterfall* was the bug. HTML shell → download JS →
 * hydrate → fetch feed → and only then request an image.
 *
 * Fetching here collapses that: the first byte of HTML already contains the LCP
 * image and every product tile. See lib/catalog-server.ts for why fetching the
 * feed unauthenticated is correct (short version: the backend already hands
 * guests the retail price book, and the audience filter is the same SQL for both).
 *
 * `generateMetadata`/`metadata` is possible for the first time as a side effect —
 * a client component could never export it.
 */

export const metadata: Metadata = {
  title: "لولو شوب — أوشحة وروبات التخرّج",
  description:
    "صمّم وشاح تخرّجك وروبك مع لولو شوب. أوشحة، روبات، قبعات وشالات مخيوطة بورشتنا.",
};

export default async function StudentHomePage() {
  // Concurrent, not serial. These are independent: the maintenance flag decides
  // whether the shop is DISPLAYED, never whether it is worth FETCHING. Chaining
  // them was a real defect on the client version, fixed in baceb73 — do not
  // reintroduce it by awaiting one before starting the other.
  const [feed, maintenance] = await Promise.all([
    getShopFeedServer(),
    getMaintenanceServer(),
  ]);

  return <StudentHome initialFeed={feed} initialMaintenance={maintenance} />;
}
