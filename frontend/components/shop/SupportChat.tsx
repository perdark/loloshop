"use client";

/**
 * «مساعد لولو» — the floating storefront launcher and its panel.
 *
 * Phone-first: students are phone-only (see CLAUDE.md → Device Priority), so the open panel
 * is a full-height bottom sheet on mobile and a floating card from `sm:` up. The launcher
 * clears the fixed bottom tab bar the student layout already reserves space for.
 *
 * The conversation itself is NOT owned here — it lives in SupportChatProvider so this panel
 * and the home-page section are two views of one thread. See that file for why.
 */

import { useEffect, useRef, useState } from "react";
import { GREETING, useSupportChat } from "./SupportChatProvider";
import { ChatBubble, TypingDots } from "./ChatBubble";

export function SupportChat() {
  const { turns, busy, error, unavailable, send, retry } = useSupportChat();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

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

  if (!open) {
    return (
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="افتح مساعد لولو"
        className="fixed z-40 flex h-14 w-14 items-center justify-center rounded-full bg-orange text-white shadow-lg transition hover:scale-105 active:scale-95"
        style={{
          insetInlineEnd: "1rem",
          // Sits above the fixed bottom tab bar (56px) plus the phone's home indicator.
          bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" aria-hidden="true">
          <path
            d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="مساعد لولو"
      // Mobile: full-screen sheet, which deliberately covers the bottom tab bar.
      // sm+: floating card — bottom-24 (6rem) clears the same fixed 56px tab bar the
      // launcher clears, otherwise the composer row lands on top of the nav.
      className="fixed inset-0 z-50 flex flex-col bg-surface sm:inset-auto sm:bottom-24 sm:end-4 sm:h-[32rem] sm:w-[22rem] sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-3 sm:rounded-t-2xl">
        <div>
          <p className="font-semibold text-ink">مساعد لولو</p>
          <p className="text-xs text-muted">يجاوب عن طلبك وعن المتجر</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="سكّر المساعد"
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
        <ChatBubble role="assistant" text={GREETING} />
        {turns.map((t, i) => (
          <ChatBubble key={i} role={t.role} text={t.content} />
        ))}
        {busy && <TypingDots />}
        {error && (
          <div role="alert" className="rounded-xl bg-blush px-3 py-2 text-center">
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
      </div>

      {/* Composer */}
      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-line px-3 py-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="اكتب سؤالك هنا…"
          maxLength={600}
          disabled={busy}
          className="h-11 min-w-0 flex-1 rounded-full border border-line bg-cream px-4 text-sm text-ink outline-none transition placeholder:text-muted focus:border-orange disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label="أرسل"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange text-white transition disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 -scale-x-100" aria-hidden="true">
            <path d="m22 2-7 20-4-9-9-4 20-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}
