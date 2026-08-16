"use client";

/**
 * «لولو» — the dedicated full-page chat at /lolo.
 *
 * Same thread as the floating widget and the (now static) homepage banner — see
 * SupportChatProvider for why one conversation has to live above all three surfaces. This is
 * not a second chatbot; it is more room for the same one.
 *
 * ── WHY NO position:fixed/sticky HERE ────────────────────────────────────────────────────
 * `app/(student)/layout.tsx`'s `<main>` runs `animate-page-in`, and StudentNav's own comment
 * (components/StudentNav.tsx:176-178) already documents the trap: a transformed ancestor
 * becomes the containing block for any `fixed` descendant, so a `fixed` header/composer
 * placed inside a page component here would anchor to <main>'s box mid-animation and to the
 * viewport once it settles — a landmine, not a header. `position: sticky` sidesteps the
 * containing-block special case (it only applies to fixed/absolute), but stacking it under
 * StudentNav's own sticky top bar needs THAT bar's exact height, which varies with
 * `env(safe-area-inset-top)` on notched phones — too fragile to hardcode.
 *
 * So the whole screen is one bounded-height flex column instead: header and composer are
 * ordinary flex-shrink-0 children, the message list is the only thing that scrolls
 * (`flex-1 overflow-y-auto`), and the column's height is sized off `100dvh` with room
 * subtracted for StudentNav's top bar + bottom tab bar + <main>'s own padding. It is the
 * exact structure SupportChat.tsx already uses inside its `fixed inset-0` sheet — only the
 * outer positioning differs, because this is a routed page, not an overlay.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { GREETING, LOLO_PAGE_SUGGESTIONS, useCountdown, useSupportChat } from "./SupportChatProvider";
import { ChatBubble, TypingDots } from "./ChatBubble";
import { LoloFace } from "./LoloFace";
import { useVisualViewportBox, viewportBoxStyle } from "./useKeyboardInsetHeight";

export function LoloChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { turns, busy, error, unavailable, emotion, send, retry, reset } = useSupportChat();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const waitLeft = useCountdown(error?.retryAfterSec);
  const viewportBox = useVisualViewportBox();
  // A portal needs a DOM target, which does not exist during SSR. Rendering the same tree
  // through `createPortal` only after mount keeps the server output and the first client
  // render identical, so there is no hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Guards the ?q= auto-send to exactly once per page load — a re-render (or the
  // router.replace below re-triggering navigation state) must not resend the same question.
  const autoSentRef = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  // The homepage banner's chips deep-link here as /lolo?q=... so tapping one on the home
  // page lands on an already-answered question instead of an empty screen the visitor has
  // to retype into. The param is stripped immediately (not just after sending) so a refresh
  // of THIS page never resends it.
  useEffect(() => {
    const q = searchParams.get("q");
    if (!q || autoSentRef.current) return;
    autoSentRef.current = true;
    router.replace("/lolo", { scroll: false });
    send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per mount, not on every searchParams identity change
  }, []);

  // Same referrer/history guard as /login's back button (app/login/page.tsx) — router.back()
  // is wrong for a visitor who arrived via a WhatsApp deep link or a fresh tab, where the
  // history stack does not actually contain the storefront.
  function goBack() {
    const cameFromUs =
      typeof window !== "undefined" && document.referrer.startsWith(`${window.location.origin}/`);
    if (cameFromUs && window.history.length > 1) router.back();
    else router.replace("/");
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    await send(question);
  }

  if (unavailable) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <LoloFace emotion="sleeping" size={120} />
        <p className="max-w-[28ch] text-sm text-ink-soft">لولو نايمة هسه، جرّب بعد شوي 🧡</p>
        <Link href="/" className="text-sm font-bold text-orange-ink underline underline-offset-4">
          رجوع للرئيسية
        </Link>
      </div>
    );
  }

  const lastAssistant = turns.map((t) => t.role).lastIndexOf("assistant");
  const started = turns.length > 0;

  const screen = (
    <div
      dir="rtl"
      // ── FULL-SCREEN, AND PORTALLED OUT OF <main> ─────────────────────────────────────────
      // Owner call 2026-08-16: «the floating one is the right path, the second is wrong» —
      // so this screen now IS the floating sheet, just routed. No card, no StudentNav, no
      // footer, no tab bar showing through: it covers all of them.
      //
      // The portal is not decoration. `(student)/layout.tsx` runs `animate-page-in` on
      // <main>, and a transformed ancestor becomes the containing block for any `fixed`
      // descendant — so `fixed inset-0` written inside the page would anchor to <main>'s box,
      // not the viewport. That is the exact landmine this file's header has always warned
      // about, and it is why the old version did viewport arithmetic instead. Rendering into
      // document.body sidesteps it completely: no transformed ancestor, no arithmetic, and
      // nothing left to get wrong when a nav bar changes height.
      //
      // ⚠️ The height is `viewportHeight` (visualViewport) with `100dvh` as the fallback, NOT
      // `100dvh` alone: on iOS the keyboard does not shrink the layout viewport, so `100dvh`
      // keeps the composer underneath the keys. See useKeyboardInsetHeight.ts.
      // `app-chrome` is repeated here and not inherited: this tree is portalled to
      // <body>, so it is NOT a descendant of the student layout's `.app-chrome` div the way
      // the floating sheet is. Without it, /lolo would be the one screen where long-press
      // still raises the iOS copy bar.
      className="app-chrome shop-paper fixed inset-0 z-[60] flex flex-col overflow-hidden bg-surface"
      style={viewportBoxStyle(viewportBox)}
    >
      {/* Header — `safe-top safe-x` because this row now starts at y=0, exactly like the
          floating sheet's header, so it sits under the status bar without them. */}
      <div className="safe-top safe-x flex shrink-0 items-center gap-3 border-b border-line bg-[linear-gradient(180deg,#fff6ea_0%,#ffe7cf_100%)] px-3 py-3">
        <button
          type="button"
          onClick={goBack}
          aria-label="رجوع"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-sink hover:text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
            <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <LoloFace emotion={emotion} size={42} float />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">لولو</p>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[#3a8f5c]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#3a8f5c]" aria-hidden="true" />
            متواجدة الآن
          </p>
        </div>
        {started && (
          <button
            type="button"
            onClick={reset}
            aria-label="محادثة جديدة"
            title="محادثة جديدة"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-sink hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
              <path
                d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Thread */}
      <div ref={scrollRef} aria-live="polite" aria-atomic="false" className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!started && !busy ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-6 text-center">
            <LoloFace emotion="sleeping" size={128} />
            <div>
              <p className="font-display-ar text-lg font-bold text-ink">اسأل لولو أي وقت</p>
              <p className="mt-1 max-w-[30ch] text-sm text-ink-soft">
                جربي وحدة من هاي، أو اكتبي سؤالك بالأسفل
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 px-2">
              {LOLO_PAGE_SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="min-h-11 rounded-pill border border-orange/30 bg-cream px-3.5 py-2 text-[13px] font-semibold text-ink-soft transition hover:border-orange hover:text-orange-ink active:scale-95"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <ChatBubble role="assistant" text={GREETING} showFace />
            {turns.map((t, i) => (
              <ChatBubble
                key={i}
                role={t.role}
                text={t.content}
                actions={t.actions}
                animate={Boolean(t.fresh) && i === lastAssistant}
                showFace={t.role === "assistant"}
                mood={t.mood}
                reaction={t.reaction}
              />
            ))}
          </>
        )}

        {busy && (
          <div className="flex items-end gap-2">
            <LoloFace emotion="typing" size={30} className="mb-0.5 shrink-0" />
            <TypingDots />
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-xl bg-blush px-3 py-2.5 text-center">
            <p className="text-sm text-danger">{error.message}</p>
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

      {/* Composer — an ordinary flex child at the bottom of the bounded column, not
          position:fixed/sticky. See the file header for why. */}
      <form
        onSubmit={submit}
        className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {/* NOT disabled while busy — disabling an input on Android dismisses the keyboard
            mid-conversation (see SupportChat.tsx for the same rule). Only send locks. */}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="اكتب سؤالك للولو…"
          aria-label="سؤالك للولو"
          maxLength={600}
          enterKeyHint="send"
          // ⚠️ `text-base` (16px) IS THE iOS ZOOM FIX — see the identical note in
          // SupportChat.tsx. Under 16px, Safari zooms the page on focus and stays zoomed.
          className="h-11 min-w-0 flex-1 rounded-full border border-line bg-cream px-4 text-base text-ink outline-none transition placeholder:text-muted focus:border-orange"
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

  // Before mount there is no document.body to portal into, so the same tree renders in place
  // for that one pass — it is `fixed` either way, and <main>'s transform only misplaces it
  // for the frame before hydration.
  return mounted ? createPortal(screen, document.body) : screen;
}
