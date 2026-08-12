"use client";

/**
 * «اسأل لولو» — the assistant as a full-bleed stage directly under the hero.
 *
 * Owner's call (2026-08-12): the assistant is not a footnote at the bottom of the page, it is
 * the shop's MAIN MARKETING CONTENT and the second thing a student meets. Everything here
 * follows from that:
 *
 *   · the mascot is large, alive and reacts — it is the brand, not a decoration;
 *   · the chips lead with what sells (what's popular, what it costs) before what supports;
 *   · every answer ends in a tappable next step into the catalogue (server-chosen — see
 *     backend/lib/supportActions.js, the model never emits a link);
 *   · it must never show an error. When the model is unreachable or the day's budget is spent,
 *     the server answers the common questions from the price book with no model at all
 *     (backend/lib/supportFallback.js), so this section stays useful during an outage.
 *
 * The mascot is the ROBOT only (owner: "do not use lolo just the robot"), cut from the official
 * brand sheet. See components/shop/LoloFace.tsx.
 *
 * It shares one thread with the floating panel via SupportChatProvider — see that file for why
 * two independent chats would misrepresent what the bot knows.
 */

import { useState } from "react";
import { SUGGESTIONS, useCountdown, useSupportChat } from "./SupportChatProvider";
import { ChatBubble, TypingDots } from "./ChatBubble";
import { LoloFace } from "./LoloFace";

export function AskLoloSection() {
  const { turns, busy, error, unavailable, emotion, send, retry, reset } = useSupportChat();
  const [draft, setDraft] = useState("");
  const waitLeft = useCountdown(error?.retryAfterSec);

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
  const lastAssistant = turns.map((t) => t.role).lastIndexOf("assistant");

  return (
    <section
      aria-labelledby="ask-lolo-title"
      className="full-bleed mt-10 bg-[linear-gradient(180deg,#fff6ea_0%,#ffe7cf_55%,#faf4ea_100%)]"
    >
      <div className="mx-auto flex min-h-[88svh] w-full max-w-2xl flex-col items-center justify-center px-4 py-14 text-center sm:px-6 sm:py-20">
        {/* The face reacts to the conversation: thinking while it works, delighted at a
            greeting, excited about prices. That reaction is the whole character. */}
        {/* Sized by breakpoint, not fixed: on a 360px phone — which is most of this audience —
            a flat 168px face crowds the headline it is supposed to introduce. */}
        <LoloFace
          emotion={emotion}
          size={168}
          float
          sizeClassName="h-[132px] w-[132px] sm:h-[168px] sm:w-[168px]"
          className="drop-shadow-[0_18px_28px_rgba(196,86,26,0.22)]"
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
            className="mt-7 max-h-80 w-full space-y-3 overflow-y-auto rounded-2xl border border-line/70 bg-surface/80 p-4 text-start backdrop-blur-sm"
          >
            {turns.map((t, i) => (
              <ChatBubble
                key={i}
                role={t.role}
                text={t.content}
                actions={t.actions}
                animate={Boolean(t.fresh) && i === lastAssistant}
              />
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
          <div role="alert" className="mt-5 w-full rounded-xl bg-blush px-3 py-2.5">
            <p className="text-sm text-danger">{error.message}</p>
            {/* Same rule as the panel: a throttle counts down instead of offering a retry
                button that cannot possibly work yet. */}
            {error.kind === "wait" && waitLeft > 0 ? (
              <p className="mt-1 text-xs font-bold text-orange-ink">جرّب بعد {waitLeft} ثانية</p>
            ) : (
              <button
                type="button"
                onClick={retry}
                className="mt-1 text-xs font-bold text-orange-ink underline underline-offset-2"
              >
                أعد المحاولة
              </button>
            )}
            {error.actions && error.actions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {error.actions.map((a) => (
                  <a
                    key={a.id}
                    href={a.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-10 items-center rounded-pill border border-orange/35 bg-surface px-3.5 py-2 text-[13px] font-bold text-orange-ink"
                  >
                    {a.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <form onSubmit={submit} className="mt-7 flex w-full items-center gap-2">
          {/* NOT disabled while busy — disabling an input on Android dismisses the keyboard
              mid-conversation. Only the send button locks. */}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="اكتب سؤالك لـ لولو…"
            aria-label="سؤالك للولو"
            maxLength={600}
            enterKeyHint="send"
            className="h-14 min-w-0 flex-1 rounded-pill border border-line bg-surface px-5 text-[15px] text-ink shadow-[var(--shadow-float)] outline-none transition placeholder:text-muted focus:border-orange"
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
            a phone they would push the actual answer off screen. A way back to them replaces
            them, because a thread with no exit is a trap on a page they came to browse. */}
        {!started ? (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="min-h-11 rounded-pill border border-orange/30 bg-surface/70 px-4 py-2 text-[13px] font-semibold text-ink-soft transition hover:border-orange hover:text-orange-ink active:scale-95"
              >
                {q}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={reset}
            className="mt-4 text-[13px] font-bold text-orange-ink underline underline-offset-4 transition hover:text-orange"
          >
            ابدأ محادثة جديدة
          </button>
        )}
      </div>
    </section>
  );
}
