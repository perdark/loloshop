import { WHY_WORKSHOP, type StorefrontCopy } from "@/lib/copy-ar";

/**
 * «ليش لولو شوب؟» — the answer to direction D's one weakness.
 *
 * D leads with the goods and no marketing hero, which is fast but never says why
 * this shop rather than any other. Putting the answer in the GAP between the
 * first and second rails earns the story without pushing a single product down.
 *
 * All four claims are things the shop can stand behind: hand embroidery and the
 * in-house workshop (the atelier band says the same), the real Diyala shop
 * (StoreLocation pins it on a map — the pin has always been in Diyala; only this
 * copy said Baghdad, corrected 2026-08-14), and cash on delivery (the only payment
 * method the system has). No delivery-time promise is made here — see copy-ar.
 */
export function WhyLoloShop({ copy }: { copy: StorefrontCopy }) {
  const rows = [copy.why1, WHY_WORKSHOP, copy.why3, copy.why4];

  return (
    <section
      aria-labelledby="why-title"
      className="mt-8 rounded-card bg-[var(--shop-sink)] px-4 py-6"
    >
      <h2
        id="why-title"
        className="font-display-ar text-2xl font-bold leading-[1.45] text-ink"
      >
        ليش لولو شوب؟
      </h2>
      <ul className="mt-4 flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.lead} className="flex gap-3 text-sm leading-relaxed text-ink-soft">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="mt-[5px] h-[17px] w-[17px] shrink-0"
              fill="none"
              stroke="var(--color-orange-ink)"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m20 6-11 11-5-5" />
            </svg>
            <span>
              <b className="font-bold text-ink">{row.lead}</b> — {row.rest}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
