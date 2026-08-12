"use client";

/**
 * «لولو» — the floating storefront launcher and its panel.
 *
 * Phone-first: students are phone-only (see CLAUDE.md → Device Priority), so the open panel
 * is a full-height bottom sheet on mobile and a floating card from `sm:` up. The launcher
 * clears the fixed bottom tab bar the student layout already reserves space for.
 *
 * The conversation itself is NOT owned here — it lives in SupportChatProvider so this panel
 * and the home-page stage are two views of one thread. See that file for why.
 */

import { useEffect, useRef, useState } from "react";
import { GREETING, SUGGESTIONS, useCountdown, useSupportChat } from "./SupportChatProvider";
import { ChatBubble, TypingDots } from "./ChatBubble";
import { LoloFace } from "./LoloFace";

export function SupportChat() {
  const { turns, busy, error, unavailable, emotion, send, retry, reset } = useSupportChat();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const waitLeft = useCountdown(error?.retryAfterSec);

  // Pin to the newest message whenever the thread grows or the typing indicator toggles.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes the sheet, and focus returns to the launcher that opened it — on mobile
  // this panel covers the entire screen including the tab bar, so "how do I get out" must
  // have more than one answer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        launcherRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    await send(question);
  }

  if (unavailable) return null;

  const lastAssistant = turns.map((t) => t.role).lastIndexOf("assistant");

  if (!open) {
    return (
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="افتح محادثة لولو"
        className="fixed z-40 flex h-16 w-16 items-center justify-center rounded-full bg-brand-gradient shadow-[0_10px_26px_rgba(196,86,26,0.38)] transition hover:scale-105 active:scale-95"
        style={{
          insetInlineEnd: "1rem",
          // Sits above the fixed bottom tab bar (56px) plus the phone's home indicator.
          bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {/* The mascot IS the launcher. A generic chat glyph was one more anonymous bubble in
            the corner; the face is the brand and it is what makes people tap it. */}
        <LoloFace emotion={emotion} size={52} float />
      </button>
    );
  }

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="محادثة لولو"
      // Mobile: full-screen sheet, which deliberately covers the bottom tab bar.
      // sm+: floating card — bottom-24 (6rem) clears the same fixed 56px tab bar the
      // launcher clears, otherwise the composer row lands on top of the nav.
      className="fixed inset-0 z-50 flex flex-col bg-surface sm:inset-auto sm:bottom-24 sm:end-4 sm:h-[34rem] sm:w-[23rem] sm:rounded-3xl sm:border sm:border-line sm:shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-line bg-[linear-gradient(180deg,#fff6ea_0%,#ffe7cf_100%)] px-4 py-3 sm:rounded-t-3xl">
        <LoloFace emotion={emotion} size={42} float />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">لولو</p>
          <p className="text-xs text-muted">
            {busy ? "يكتب الآن…" : "يجاوبك عن طلبك وعن المتجر"}
          </p>
        </div>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={reset}
            aria-label="محادثة جديدة"
            title="محادثة جديدة"
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition hover:bg-surface-sink hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="سكّر المحادثة"
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition hover:bg-surface-sink hover:text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Thread. aria-live so a screen-reader user hears the reply instead of having to go
          hunting for what changed. */}
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-atomic="false"
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        <ChatBubble role="assistant" text={GREETING} showFace />
        {turns.map((t, i) => (
          <ChatBubble
            key={i}
            role={t.role}
            text={t.content}
            actions={t.actions}
            animate={Boolean(t.fresh) && i === lastAssistant}
            showFace={i === lastAssistant}
          />
        ))}
        {busy && <TypingDots />}

        {/* Suggestions live INSIDE the thread on an untouched panel. Opening the bubble on a
            product page used to show an empty box and a text field, which is the moment most
            people close it again. */}
        {turns.length === 0 && !busy && (
          <div className="flex flex-wrap gap-2 pt-1">
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="min-h-10 rounded-pill border border-orange/30 bg-cream px-3.5 py-2 text-[13px] font-semibold text-ink-soft transition hover:border-orange hover:text-orange-ink active:scale-95"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-xl bg-blush px-3 py-2.5 text-center">
            <p className="text-sm text-danger">{error.message}</p>
            {/* A throttle is a wait, not a failure: offering «أعد المحاولة» here would be a
                button whose only possible outcome is the same error. So it counts down and
                only becomes a retry when retrying can actually work. */}
            {error.kind === "wait" && waitLeft > 0 ? (
              <p className="mt-1 text-xs font-bold text-orange-ink">
                جرّب بعد {waitLeft} ثانية
              </p>
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
              <div className="mt-2 flex flex-wrap justify-center gap-2">
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
      </div>

      {/* Composer */}
      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-line px-3 py-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {/* NOT disabled while busy. Disabling an input on Android dismisses the keyboard, so
            the old version threw the student out of the conversation on every single message
            and made them tap back in. Only the send button locks. */}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="اكتب سؤالك هنا…"
          maxLength={600}
          enterKeyHint="send"
          className="h-11 min-w-0 flex-1 rounded-full border border-line bg-cream px-4 text-sm text-ink outline-none transition placeholder:text-muted focus:border-orange"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label="أرسل"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white transition disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 -scale-x-100" aria-hidden="true">
            <path d="m22 2-7 20-4-9-9-4 20-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}
