import type { ShopProductCard } from "./types";

/** Featured pieces float to the front of any list. */
export function featuredFirst(list: ShopProductCard[]): ShopProductCard[] {
  return [...list].sort((a, b) => Number(b.featured) - Number(a.featured));
}

/**
 * Round-robin interleave across type buckets: bucket0[0], bucket1[0], …,
 * bucket0[1], bucket1[1], … so the "الكل" grid alternates categories
 * (sash, cap, robe, sash, …) instead of showing each type in a block.
 * Deterministic — guarantees a mixed look with no clumping (which a random
 * shuffle can't promise) and no hydration mismatch.
 */
export function interleaveByType(buckets: ShopProductCard[][]): ShopProductCard[] {
  const out: ShopProductCard[] = [];
  const max = buckets.reduce((m, b) => Math.max(m, b.length), 0);
  for (let i = 0; i < max; i++) {
    for (const b of buckets) {
      if (i < b.length) out.push(b[i]);
    }
  }
  return out;
}
