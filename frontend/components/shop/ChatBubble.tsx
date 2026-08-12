"use client";

/** One message, plus the chips under it. Shared by the floating panel and the home-page stage
 *  so the assistant reads identically in both — same radius, same colours, same wrapping. */

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ChatAction, Turn } from "./SupportChatProvider";
import { LoloFace } from "./LoloFace";

/**
 * Reveal an answer word by word.
 *
 * ── WHY NOT REAL STREAMING ────────────────────────────────────────────────────────────────
 * Streaming tokens from the model would publish each sentence before backend/lib/answerGuard.js
 * has seen the whole thing, and retracting text a customer has already read is worse than
 * making them wait — a screenshot of the shop's own assistant inventing a price does not become
 * untrue because the words later disappeared. So the server holds the answer, checks it, and
 * only then does it exist; this reveals the checked text at reading speed.
 *
 * The effect a customer sees is the same "it is talking to me" feeling, the guard keeps its
 * veto, and it costs nothing on the wire.
 *
 * Respects prefers-reduced-motion, and only ever runs on the newest answer.
 */
function useRevealedWords(text: string, animate: boolean) {
  const [shown, setShown] = useState(() => (animate ? 0 : Infinity));

  useEffect(() => {
    if (!animate) { setShown(Infinity); return; }
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setShown(Infinity); return; }

    const total = text.split(/\s+/).length;
    setShown(0);
    // ~22ms/word reads as talking rather than typing; a 30-word answer lands in well under a
    // second, so nobody is ever waiting on the animation itself.
    const id = window.setInterval(() => {
      setShown((n) => {
        if (n >= total) { window.clearInterval(id); return Infinity; }
        return n + 1;
      });
    }, 22);
    return () => window.clearInterval(id);
  }, [text, animate]);

  if (shown === Infinity) return text;
  return text.split(/\s+/).slice(0, shown).join(" ");
}

function ActionChip({ action }: { action: ChatAction }) {
  const className =
    "inline-flex min-h-10 items-center gap-1.5 rounded-pill border border-orange/35 bg-surface px-3.5 py-2 " +
    "text-[13px] font-bold text-orange-ink transition hover:border-orange hover:bg-orange/5 active:scale-95";

  // External destinations (WhatsApp, Google Maps) leave the app, so they get a real anchor with
  // the safety rel; internal ones go through next/link and stay a client navigation.
  if (action.kind === "external") {
    return (
      <a href={action.href} target="_blank" rel="noopener noreferrer" className={className}>
        {action.label}
      </a>
    );
  }
  return (
    <Link href={action.href} className={className}>
      {action.label}
    </Link>
  );
}

export function ChatBubble({
  role,
  text,
  actions,
  animate = false,
  showFace = false,
}: {
  role: Turn["role"];
  text: string;
  actions?: ChatAction[];
  animate?: boolean;
  showFace?: boolean;
}) {
  const mine = role === "user";
  const revealed = useRevealedWords(text, !mine && animate);
  // Chips wait for the sentence to finish — arriving mid-reveal they read as the answer being
  // interrupted, and a customer taps them before they have read why.
  const done = revealed.length >= text.length;

  if (mine) {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-ee-md bg-orange px-4 py-2.5 text-sm leading-relaxed text-white">
          {text}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2">
      {showFace && <LoloFace emotion="happy" size={30} className="mb-0.5 shrink-0" />}
      <div className="min-w-0 max-w-[85%]">
        <p className="whitespace-pre-wrap rounded-2xl rounded-es-md bg-surface-sink px-4 py-2.5 text-sm leading-relaxed text-ink-soft">
          {revealed}
        </p>
        {done && actions && actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {actions.map((a) => (
              <ActionChip key={a.id} action={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { TypingDots } from "./LoloFace";
