"use client";

/**
 * «اسأل لولو» — the assistant as a full-bleed stage directly under the hero.
 *
 * Owner's call (2026-08-12): the assistant is not a footnote at the bottom of the page, it is
 * the second thing a student meets. So this is a full-bleed panel with the mascot, one CTA,
 * and the shop's four real FAQs as taps.
 *
 * The chips are not decoration: a student who does not know what to type still gets an answer,
 * and the most common asks arrive as identical strings — which is exactly the key the response
 * cache in supportChatController keys on, so those four are the ones that come back instantly.
 *
 * The mascot is the ROBOT only (owner: "do not use lolo just the robot") — cut from the brand
 * sheet in ~/Downloads to frontend/public/lolo-robot.png.
 *
 * It shares one thread with the floating panel via SupportChatProvider — see that file for why
 * two independent chats would misrepresent what the bot knows.
 */

import { useState } from "react";
import Image from "next/image";
import { SUGGESTIONS, useSupportChat } from "./SupportChatProvider";
import { ChatBubble, TypingDots } from "./ChatBubble";

export function AskLoloSection() {
  const { turns, busy, error, unavailable, send, retry } = useSupportChat();
  const [draft, setDraft] = useState("");

  // The API says the assistant is off (no OPENROUTER_API_KEY). A dead full-page section is
  // far worse than none, so it removes itself entirely.
  if (unavailable) return null;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    await send(question);
  }

  const started = turns.length > 0;

  return (
    <section
      aria-labelledby="ask-lolo-title"
      className="full-bleed mt-10 bg-[linear-gradient(180deg,#fff6ea_0%,#ffe7cf_55%,#faf4ea_100%)]"
    >
      <div className="mx-auto flex min-h-[88svh] w-full max-w-2xl flex-col items-center justify-center px-4 py-14 text-center sm:px-6 sm:py-20">
        {/* Mascot. `priority` is a no-op in Next 16 — this sits just under the hero, so it is
            eagerly fetched at high priority to avoid a pop-in on the first scroll. */}
        <Image
          src="/lolo-robot.png"
          alt="لولو — مساعد لولو شوب"
          width={300}
          height={430}
          loading="eager"
          fetchPriority="high"
          sizes="(max-width: 640px) 150px, 190px"
          className="h-auto w-[150px] drop-shadow-[0_18px_28px_rgba(196,86,26,0.22)] sm:w-[190px]"
        />

        <h2
          id="ask-lolo-title"
          className="mt-5 font-display-ar text-[clamp(2rem,8vw,3rem)] font-bold leading-[1.25] text-ink"
        >
          اسأل لولو
        </h2>
        <p className="mt-3 max-w-[34ch] text-[15px] leading-relaxed text-ink-soft">
          مساعدك الذكي — يجاوبك عن الأسعار، وين وصل طلبك، ومنو ممثل جامعتك. اسأل بأي وقت.
        </p>

        {/* The thread only appears once there is one. Before that this is an invitation, not an
            empty chat window pretending a conversation is under way. */}
        {started && (
          <div
            aria-live="polite"
            aria-atomic="false"
            className="mt-7 w-full max-h-80 space-y-3 overflow-y-auto rounded-2xl border border-line/70 bg-surface/80 p-4 text-start backdrop-blur-sm"
          >
            {turns.map((t, i) => (
              <ChatBubble key={i} role={t.role} text={t.content} />
            ))}
            {busy && <TypingDots />}
          </div>
        )}

        {busy && !started && (
          <div className="mt-7 w-full rounded-2xl border border-line/70 bg-surface/80 p-4 text-start">
            <TypingDots />
          </div>
        )}

        {error && (
          <div role="alert" className="mt-5 w-full rounded-xl bg-blush px-3 py-2">
            <p className="text-sm text-danger">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-1 text-xs font-bold text-orange-ink underline underline-offset-2"
            >
              أعد المحاولة
            </button>
          </div>
        )}

        <form onSubmit={submit} className="mt-7 flex w-full items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="اكتب سؤالك لـ لولو…"
            aria-label="سؤالك للولو"
            maxLength={600}
            disabled={busy}
            className="h-14 min-w-0 flex-1 rounded-pill border border-line bg-surface px-5 text-[15px] text-ink shadow-[var(--shadow-float)] outline-none transition placeholder:text-muted focus:border-orange disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="أرسل"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white shadow-[var(--shadow-float)] transition-transform hover:scale-[1.04] active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 -scale-x-100" aria-hidden="true">
              <path d="m22 2-7 20-4-9-9-4 20-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </button>
        </form>

        {/* Suggestions retire once the student is talking — at that point they are noise, and on
            a phone they would push the actual answer off screen. */}
        {!started && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                disabled={busy}
                className="min-h-11 rounded-pill border border-orange/30 bg-surface/70 px-4 py-2 text-[13px] font-semibold text-ink-soft transition hover:border-orange hover:text-orange-ink active:scale-95 disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
