"use client";

/** One message, plus the chips and reactions under it. Shared by the floating panel and the
 *  dedicated /lolo page so the assistant reads identically in both — same radius, same
 *  colours, same wrapping, same reaction strip. A component used in only one place would let
 *  the two surfaces quietly drift apart; this is the one thing keeping them in sync. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { type ChatAction, type Mood, type Reaction, type Turn, useSupportChat } from "./SupportChatProvider";
import { LoloFace, type LoloEmotion } from "./LoloFace";

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

/** The mascot face beside a reply reflects its `mood`, reusing the existing seven-expression
 *  art rather than adding new assets: a witty/playful reply gets the wink, a warm one gets
 *  the same face used for the "someone said something sweet" case elsewhere in the app.
 *  happy/neutral — the common case — keep the default smile. */
function faceForMood(mood?: Mood): LoloEmotion {
  if (mood === "wink") return "wink";
  if (mood === "caring") return "love";
  return "happy";
}

const REACTIONS: { key: Reaction; emoji: string; label: string }[] = [
  { key: "like", emoji: "👍", label: "إعجاب" },
  { key: "love", emoji: "❤️", label: "حب" },
  { key: "happy", emoji: "😄", label: "سعيد" },
  { key: "sad", emoji: "😢", label: "حزين" },
  { key: "good", emoji: "👌", label: "جيد" },
  { key: "excellent", emoji: "🌟", label: "ممتاز" },
];

/**
 * The reaction strip under a لولو reply. One tap selects (optimistic highlight, POST
 * /assistant/react); tapping the same emoji again clears it; tapping a different one
 * overwrites — never more than one selected reaction per message, matching the backend's
 * own "null clears, a new value overwrites" contract.
 *
 * Labels are aria-label + title, not visible text on every chip — six spelled-out Arabic
 * words under every single reply would be louder than the reply itself. min-h/min-w-11 keeps
 * each tap target at the project's 44px floor even though the row reads as compact.
 */
function ReactionRow({
  messageId,
  selected,
  onReact,
}: {
  messageId: string;
  selected: Reaction | null | undefined;
  onReact: (messageId: string, reaction: Reaction | null) => void;
}) {
  return (
    <div role="group" aria-label="تفاعل مع رد لولو" className="mt-1.5 flex flex-wrap gap-1">
      {REACTIONS.map((r) => {
        const active = selected === r.key;
        return (
          <button
            key={r.key}
            type="button"
            title={r.label}
            aria-label={r.label}
            aria-pressed={active}
            onClick={() => onReact(messageId, active ? null : r.key)}
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-full text-base transition active:scale-90 ${
              active ? "bg-orange/15 ring-1 ring-orange" : "hover:bg-surface-sink"
            }`}
          >
            <span aria-hidden="true">{r.emoji}</span>
          </button>
        );
      })}
    </div>
  );
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
  mood,
  messageId,
  reaction,
}: {
  role: Turn["role"];
  text: string;
  actions?: ChatAction[];
  animate?: boolean;
  showFace?: boolean;
  /** Only ever set on assistant turns — reflected in the face beside the bubble and, for
   *  "caring", in the bubble's own tone. */
  mood?: Mood;
  /** Present only on turns the server actually logged. Its presence, not `role`, is what
   *  gates the reaction row — a turn without one (the static GREETING, anything from before
   *  this shipped) has nothing to attach a reaction to. */
  messageId?: string;
  reaction?: Reaction | null;
}) {
  const { react } = useSupportChat();
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

  const caring = mood === "caring";

  return (
    <div className="flex items-end gap-2">
      {showFace && <LoloFace emotion={faceForMood(mood)} size={30} className="mb-0.5 shrink-0" />}
      <div className="min-w-0 max-w-[85%]">
        {/* "caring" mood: a softer bubble tone + a gentle line above it, not a new bubble
            shape — the reveal animation and action chips below still work unchanged. */}
        {caring && <p className="mb-1 text-[11px] font-semibold text-orange-ink">🧡 بكل محبة</p>}
        <p
          className={`whitespace-pre-wrap rounded-2xl rounded-es-md px-4 py-2.5 text-sm leading-relaxed text-ink-soft ${
            caring ? "bg-blush" : "bg-surface-sink"
          }`}
        >
          {revealed}
        </p>
        {done && actions && actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {actions.map((a) => (
              <ActionChip key={a.id} action={a} />
            ))}
          </div>
        )}
        {done && messageId && <ReactionRow messageId={messageId} selected={reaction} onReact={react} />}
      </div>
    </div>
  );
}

export { TypingDots } from "./LoloFace";
