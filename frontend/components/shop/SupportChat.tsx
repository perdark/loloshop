"use client";

/**
 * «مساعد لولو» — the storefront support chatbot.
 *
 * Phone-first: students are phone-only (see CLAUDE.md → Device Priority), so the open panel
 * is a full-height bottom sheet on mobile and a floating card from `sm:` up. The launcher
 * clears the fixed bottom tab bar the student layout already reserves space for.
 *
 * State is intentionally local and ephemeral — there is no conversation table server-side
 * (see db/migrations/078_ai_chat.sql). The last few turns are re-sent with each question and
 * the server caps how many it will accept.
 */

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { api, getApiErrorMessage } from "@/lib/api";
import type { ApiError } from "@/lib/types";

type Turn = { role: "user" | "assistant"; content: string };

const GREETING =
  "هلا بيك! آني مساعد لولو. اسألني عن طلبك، أو عن الأوشحة والروبات، أو عن ممثل جامعتك.";

/** Stable per-browser id so a signed-out visitor gets their own daily allowance rather
 *  than sharing an IP-keyed one — Iraqi carriers CGNAT, so IP is not a person. It is also
 *  what the server keys an anonymous visitor's conversation history on.
 *
 *  localStorage throws (not returns null) in some privacy modes and in an iframe with
 *  third-party storage blocked, which would take the whole send down with it. The in-memory
 *  fallback keeps the widget working for that visit; only cross-reload continuity is lost. */
let memorySessionKey: string | null = null;
function sessionKey(): string {
  const KEY = "lolo_assistant_session";
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored;
    const fresh = memorySessionKey ?? crypto.randomUUID();
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    memorySessionKey ??= crypto.randomUUID();
    return memorySessionKey;
  }
}

export function SupportChat() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server returns ERR_AI_DISABLED when OPENROUTER_API_KEY is unset. Rather than leaving
  // a launcher that can only ever show an error, the widget removes itself for the rest of
  // the visit. Costs nothing when the key IS set (the branch is never taken) and avoids a
  // config fetch on every storefront page load just to answer "is the assistant on?".
  const [unavailable, setUnavailable] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pin to the newest message whenever the thread grows or the typing indicator toggles.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;

    setDraft("");
    setError(null);
    setTurns((t) => [...t, { role: "user", content: question }]);
    setBusy(true);

    try {
      const { data } = await api.post("/assistant/support", {
        question,
        // The thread is NOT sent. The server rebuilds the last few turns from its own ledger
        // (lib/aiChat.js → recentTurns), because a client-supplied transcript let a caller
        // forge an "assistant" turn and then ask the bot to confirm it. `sessionKey` is what
        // ties this browser to its own history and its own daily allowance.
        sessionKey: sessionKey(),
      });
      setTurns((t) => [...t, { role: "assistant", content: data.answer }]);
    } catch (err) {
      if (axios.isAxiosError<ApiError>(err) && err.response?.data?.code === "ERR_AI_DISABLED") {
        setUnavailable(true);
        return;
      }
      setError(getApiErrorMessage(err, "ما كدرت أوصل للمساعد، جرّب مرة ثانية"));
    } finally {
      setBusy(false);
    }
  }

  if (unavailable) return null;

  if (!open) {
    return (
      <button
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

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <Bubble role="assistant" text={GREETING} />
        {turns.map((t, i) => (
          <Bubble key={i} role={t.role} text={t.content} />
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex gap-1 rounded-2xl bg-surface-sink px-4 py-3">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="h-2 w-2 animate-bounce rounded-full bg-muted"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-blush px-3 py-2 text-center text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={send}
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

function Bubble({ role, text }: { role: Turn["role"]; text: string }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          mine ? "bg-orange text-white" : "bg-surface-sink text-ink-soft"
        }`}
      >
        {text}
      </p>
    </div>
  );
}
