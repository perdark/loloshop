"use client";

/**
 * «اسأل لولو» — the homepage banner, Khatuna-pattern: a warm card under the hero that IS a
 * link to the dedicated /lolo screen (see khatuna-build's (store)/page.tsx «هلا بيچ خاتونة» →
 * /guide, read for the pattern, not the palette).
 *
 * ── WHY THIS IS NOT THE CHAT ANYMORE ─────────────────────────────────────────────────────
 * This section used to BE the assistant — mascot, thread, composer, all of it, full-bleed
 * under the hero. Owner's call this round: the home page keeps the invitation, the actual
 * conversation moves to /lolo, a dedicated screen with room to show feelings and reactions
 * (see LoloChatPage.tsx). So everything heavy that used to live here — ChatBubble rendering,
 * TypingDots, the composer form, retry/reset, useCountdown — is gone. What is left is a
 * `Link` plus two images plus a `useSupportChat()` read, which is genuinely light: no state,
 * no event handler besides navigation.
 *
 * ── WHY IT IS STILL A CLIENT COMPONENT ───────────────────────────────────────────────────
 * `unavailable` still has to hide this: advertising a chat that cannot answer is worse than
 * not mentioning it (same rule the old version followed). `emotion` still drives the face so
 * it is not a static sticker — if a student is mid-conversation on the floating widget
 * elsewhere on the site, the SAME mascot on this banner reflects that, because it is the same
 * provider. Both are one context read each, not "heavy client JS".
 *
 * ── WHY THE CHIPS ARE THEIR OWN <Link>s, NOT NESTED INSIDE THE BIG ONE ──────────────────
 * "The whole banner is a Link to /lolo" cannot mean literally every pixel is one <a>: each
 * chip needs its OWN destination (/lolo?q=<its own question>), and an <a> inside an <a> is
 * invalid HTML that browsers silently reparent. So the identity block (mascot + greeting) is
 * one Link to the bare screen, and the chips below are separate Links that deep-link a
 * specific opening question — LoloChatPage reads `?q=` once on mount and sends it, then
 * strips the param so a refresh cannot resend it (see its own header comment).
 */

import Link from "next/link";
import { SUGGESTIONS, useSupportChat } from "./SupportChatProvider";
import { LoloFace } from "./LoloFace";

export function AskLoloSection() {
  const { unavailable, emotion } = useSupportChat();

  // Same rule as before: a banner promising an assistant that cannot answer is worse than no
  // banner at all.
  if (unavailable) return null;

  return (
    <section aria-labelledby="ask-lolo-title" className="mt-8 px-4 sm:px-6">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-[1.75rem] border border-orange/15 bg-[linear-gradient(135deg,#fff3e2_0%,#ffe4cf_58%,#ffd9c2_100%)] shadow-[var(--shadow-card)]">
        <Link
          href="/lolo"
          className="flex items-center gap-4 px-5 pb-3 pt-5 transition active:opacity-80 sm:px-7 sm:pt-7"
        >
          <LoloFace
            emotion={emotion}
            size={84}
            float
            sizeClassName="h-16 w-16 sm:h-[84px] sm:w-[84px]"
            className="shrink-0 drop-shadow-[0_10px_18px_rgba(196,86,26,0.22)]"
          />
          <div className="min-w-0 flex-1 text-start">
            <h2 id="ask-lolo-title" className="font-display-ar text-lg font-bold leading-snug text-ink sm:text-xl">
              هلا! آني لولو 🧡
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
              اسألني عن الأسعار، طلبك، أو ممثل جامعتك — أردّ عليك خلال ثواني.
            </p>
          </div>
          {/* Forward chevron, RTL-correct: points start-ward (left), the same direction
              /login's back button points the opposite way for "previous" (see its own
              comment) — a left-pointing chevron reads as "go" here. */}
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 shrink-0 text-orange-ink" aria-hidden="true">
            <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>

        <div className="flex flex-wrap gap-2 px-5 pb-5 sm:px-7 sm:pb-7">
          {SUGGESTIONS.map((q) => (
            <Link
              key={q}
              href={`/lolo?q=${encodeURIComponent(q)}`}
              className="inline-flex min-h-11 items-center rounded-pill border border-orange/30 bg-surface/80 px-3.5 py-2 text-[13px] font-semibold text-ink-soft transition hover:border-orange hover:text-orange-ink active:scale-95"
            >
              {q}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
