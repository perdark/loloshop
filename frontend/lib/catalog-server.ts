import { mapShopFeed } from "./catalog-map";
// Type-only: erased at compile time, so this does NOT pull axios into the server
// bundle even though MaintenanceConfig is declared next to the client fetchers.
import type { MaintenanceConfig } from "./catalog";
import type { ShopFeed } from "./types";

/**
 * Server-only guard. The `server-only` package is NOT a dependency of this
 * project, so this is the zero-dependency equivalent: importing this module from
 * a client component fails loudly instead of silently shipping server URLs to the
 * browser. `API_INTERNAL_URL` has no NEXT_PUBLIC_ prefix, so in a client bundle it
 * would be undefined and every fetch would quietly hit the wrong host.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "lib/catalog-server.ts is server-only — use lib/catalog.ts from client components."
  );
}

/**
 * Server-side shop feed fetch — the thing that lets the storefront render before
 * any JavaScript reaches the phone.
 *
 * ── WHY THIS IS SAFE TO FETCH UNAUTHENTICATED ────────────────────────────────
 * The handoff recorded this as impossible: «getShopFeed() is role-aware and the
 * JWT lives in localStorage, so a Server Component cannot know who is asking» —
 * and therefore SSR risked showing a wholesaler the retail price book. That read
 * of the backend is wrong. From backend/controllers/catalogController.js:
 *
 *   • priceRoleForUser(user):  `if (!user) return 'retail'`
 *     → a guest ALREADY receives the retail price book. Nothing is hidden from
 *       an anonymous caller that a retail student would see.
 *   • buildShopFeed(audience): the visibility filter is the same string,
 *     `AND p.wholesaler_only = FALSE`, for BOTH 'guest' and 'retail'. Only
 *       'wholesaler_student' takes the other branch.
 *
 * So the guest feed and a signed-in retail student's feed are identical apart
 * from an `audience` label the UI never prices off. The one audience that really
 * differs — rep-linked students, who get wholesaler pricing — is redirected to
 * /my-order before the feed is ever rendered (see the client shell). There is no
 * price book to leak and no flash to correct.
 *
 * ⚠️ If anyone ever makes the guest and retail audience filters diverge in
 * buildShopFeed, this function becomes wrong and the home page must go back to
 * fetching per-user. That is the single invariant this depends on.
 *
 * ── WHY API_INTERNAL_URL ─────────────────────────────────────────────────────
 * nginx already proxies /api/ to 127.0.0.1:4000 on the same box. Fetching the
 * public https URL from the Next server would make the machine resolve its own
 * DNS, open a TLS connection to itself and traverse nginx — pure latency on the
 * critical render path. Default straight to Express.
 */
const INTERNAL_BASE = (
  process.env.API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:4000"
).replace(/\/$/, "");

/**
 * Matches the backend's own 120 s memoCache TTL on `cat:shop:*` exactly. Picking
 * a different number would just mean two caches expiring out of step, with the
 * longer one deciding staleness anyway.
 */
export const SHOP_FEED_REVALIDATE_SECONDS = 120;

/**
 * Returns the feed, or `null` if the API could not be reached.
 *
 * Deliberately never throws: a failed fetch here would take the entire storefront
 * to the error boundary. The page falls back to fetching client-side instead, so
 * a backend hiccup costs the SSR optimisation rather than the page.
 */
export async function getShopFeedServer(): Promise<ShopFeed | null> {
  try {
    const res = await fetch(`${INTERNAL_BASE}/api/catalog/shop`, {
      // Next 16 does NOT cache fetch by default (changed in 15) — without this
      // every visitor would hit Express on the render path.
      next: { revalidate: SHOP_FEED_REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.error("[catalog-server] shop feed HTTP", res.status);
      return null;
    }
    const body = (await res.json()) as { data?: Record<string, unknown> };
    if (!body?.data) return null;
    return mapShopFeed(body.data);
  } catch (err) {
    console.error(
      "[catalog-server] shop feed fetch failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Maintenance flag, server-side.
 *
 * This HAS to be fetched here rather than left to the client: the home page gates
 * its entire render behind `maintenanceLoading`, so if the server did not know the
 * flag it would render the loading skeleton — and shipping a skeleton as the
 * server HTML would defeat the whole conversion.
 *
 * 30 s rather than the feed's 120 s. This is a switch the owner flips when
 * something is wrong and expects to take effect quickly; two minutes of a broken
 * storefront staying visible is the wrong trade.
 *
 * On failure returns `{ active: false }` — a maintenance check that cannot be
 * reached must never be the reason the shop appears closed.
 */
export async function getMaintenanceServer(): Promise<MaintenanceConfig> {
  const fallback: MaintenanceConfig = {
    active: false,
    message_ar: "الموقع قيد الصيانة",
  };
  try {
    const res = await fetch(`${INTERNAL_BASE}/api/catalog/maintenance`, {
      next: { revalidate: 30 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as { data?: MaintenanceConfig };
    return body?.data ?? fallback;
  } catch {
    return fallback;
  }
}
