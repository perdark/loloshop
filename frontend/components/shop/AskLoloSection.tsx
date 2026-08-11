"use client";

/**
 * «عندك سؤال؟» — the assistant as a real section of the home page, not only a floating bubble.
 *
 * Why a section AND a launcher: the bubble is discoverable only if you already suspect help
 * exists. A student deciding whether this is «محل حقيقي لو حساب إنستغرام؟» does not tap an
 * unlabelled circle — they scroll. So the section carries the shop's four actual FAQs as
 * tappable chips, which also means the most common questions arrive as identical strings (the
 * key a response cache would use when one is added).
 *
 * It shares one thread with the floating panel via SupportChatProvider — see that file for why
 * two independent chats would misrepresent what the bot knows.
 *
 * Placed last on the home page, right before «موقعنا»: a student who has scrolled the whole
 * catalogue without ordering is exactly the one with an unanswered question.
 */

import { useState } from "react";
import { SUGGESTIONS, useSupportChat } from "./SupportChatProvider";
import { ChatBubble, TypingDots } from "./ChatBubble";

export function AskLoloSection() {
  const { turns, busy, error, unavailable, send, retry } = useSupportChat();
  const [draft, setDraft] = useState("");

  // The API says the assistant is off (no OPENROUTER_API_KEY). Rendering a dead section on the
  // home page is worse than rendering none.
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
      className="mx-auto max-w-2xl px-4 pt-14 sm:px-6 sm:pt-20"
    >
      <div className="text-center">
        <h2
          id="ask-lolo-title"
          className="font-display-ar text-[clamp(1.6rem,4.5vw,2.4rem)] font-bold leading-tight text-ink"
        >
          عندك سؤال؟
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          اسأل لولو — يجاوبك عن طلبك، عن الأسعار، وعن ممثل جامعتك.
        </p>
      </div>

      <div className="mt-7 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)] sm:p-5">
        {/* The thread only appears once there is one. Before that the card is an invitation,
            not an empty chat window pretending a conversation is in progress. */}
        {started && (
          <div
            aria-live="polite"
            aria-atomic="false"
            className="mb-4 max-h-80 space-y-3 overflow-y-auto"
          >
            {turns.map((t, i) => (
              <ChatBubble key={i} role={t.role} text={t.content} />
            ))}
            {busy && <TypingDots />}
          </div>
        )}

        {busy && !started && (
          <div className="mb-4">
            <TypingDots />
          </div>
        )}

        {error && (
          <div role="alert" className="mb-4 rounded-xl bg-blush px-3 py-2 text-center">
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

        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="اكتب سؤالك هنا…"
            aria-label="سؤالك للولو"
            maxLength={600}
            disabled={busy}
            className="h-12 min-w-0 flex-1 rounded-full border border-line bg-cream px-4 text-sm text-ink outline-none transition placeholder:text-muted focus:border-orange disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="أرسل"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-orange text-white transition hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 -scale-x-100" aria-hidden="true">
              <path d="m22 2-7 20-4-9-9-4 20-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </button>
        </form>

        {/* Suggestions retire once the student is talking — at that point they are noise, and
            they would push the actual answer off a phone screen. */}
        {!started && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold text-muted">أسئلة شائعة:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  disabled={busy}
                  className="min-h-11 rounded-full border border-line bg-cream px-4 py-2 text-[13px] font-semibold text-ink-soft transition hover:border-orange hover:text-orange-ink active:scale-95 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
