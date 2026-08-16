"use client";

/** One message, plus the face beside it. Shared by the floating panel and the dedicated /lolo
 *  page so the assistant reads identically in both — same radius, same colours, same wrapping,
 *  same reaction. A component used in only one place would let the two surfaces quietly drift
 *  apart; this is the one thing keeping them in sync.
 *  (It used to render action chips under each answer too — removed 2026-08-16, see below.) */

import { useEffect, useState } from "react";
import type { ChatAction, Mood, Turn } from "./SupportChatProvider";
import { LoloFace, LoloSticker, type LoloEmotion, type Reaction } from "./LoloFace";

/**
 * How long لولو's sticker sits alone before her words arrive.
 *
 * A person sends the sticker first and *then* types — that gap is the entire reason the sticker
 * reads as a reaction rather than as decoration attached to the answer. The server sends both in
 * one response, so the gap is made here, and only on a fresh turn: a restored thread shows the
 * sticker and the reply together, because that conversation already happened.
 */
const STICKER_LEAD_MS = 700;

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

/* ⛔ `ActionChip` was deleted 2026-08-16 with the per-answer CTA row — see the comment where
   it used to render, below. Restoring the chips means restoring this component too; it was a
   plain <a>/<Link> pair switching on `action.kind`, and `git show` has it.

   ⚠️ This did NOT remove the ESCALATION actions. When لولو fails — throttled, over budget, or
   the guard blocked her answer — LoloChatPage and SupportChat render `error.actions`
   separately (the WhatsApp/Instagram escape hatch). Those are the opposite of a CTA: they are
   how a stuck customer reaches a human, and deleting them would strand people. Only the
   chips that hung under a SUCCESSFUL answer are gone. */

export function ChatBubble({
  role,
  text,
  animate = false,
  showFace = false,
  mood,
  reaction,
}: {
  role: Turn["role"];
  text: string;
  /** Still accepted and still sent by the server, deliberately UNREAD since 2026-08-16 —
   *  both call sites pass `t.actions` and the prop stays so they keep compiling and so the
   *  chips are one render away if the owner wants them back. See the note at the render
   *  site. Not destructured, because an unused binding is a lint warning. */
  actions?: ChatAction[];
  animate?: boolean;
  showFace?: boolean;
  /** Only ever set on assistant turns — reflected in the face beside the bubble and, for
   *  "caring", in the bubble's own tone. */
  mood?: Mood;
  /** لولو's reaction to the message this reply answers. It plays only while `animate` is on,
   *  i.e. on the newest answer — a thread restored from storage must not replay every
   *  reaction it ever had the moment the page loads. */
  reaction?: Reaction;
}) {
  const mine = role === "user";
  const hasSticker = !mine && Boolean(reaction) && reaction !== "none";

  // Hold the words back while the sticker stands alone. Gated on `animate`, so this only ever
  // delays a reply the student is watching arrive — never one being restored from storage.
  const [held, setHeld] = useState(hasSticker && animate);
  useEffect(() => {
    if (!(hasSticker && animate)) {
      setHeld(false);
      return;
    }
    setHeld(true);
    const id = window.setTimeout(() => setHeld(false), STICKER_LEAD_MS);
    return () => window.clearTimeout(id);
  }, [hasSticker, animate]);

  // `!held` is load-bearing, not tidiness: the reveal must START when the bubble appears. Left
  // running during the hold it would burn through its ~22ms-per-word budget behind a hidden
  // element, and the answer would pop out fully revealed instead of being spoken.
  const revealed = useRevealedWords(text, !mine && animate && !held);
  // (A `done` flag lived here to hold the action chips back until the sentence finished
  // revealing. The chips are gone — 2026-08-16 — and nothing else waited on it.)

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
    <>
      {/* Her sticker is a message of its own and sits ABOVE the words, the way a person sends
          one and then starts typing. It is a sibling of the bubble, not a decoration inside it,
          which is what lets it stay in the thread after the reply lands. */}
      {hasSticker && <LoloSticker reaction={reaction!} animate={animate} />}

      {!held && (
    <div className="flex items-end gap-2">
      {showFace && (
        <LoloFace emotion={faceForMood(mood)} size={30} className="mb-0.5 shrink-0" />
      )}
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
        {/* ⛔ ACTION CHIPS REMOVED — owner call 2026-08-16. The «شوف القطع» / «شوف الأسعار»
            buttons under every answer read as an advert bolted onto a conversation: لولو
            answers you and then sells at you. The server still CHOOSES actions (they are in
            the /support response and `lib/supportActions.js` still picks them from a closed
            list) — only the rendering is gone, so nothing about the answer guard, the tests
            or the API shape changed, and putting them back is deleting this comment.
            The `actions` prop is kept on purpose for the same reason. */}
      </div>
    </div>
      )}
    </>
  );
}

export { TypingDots } from "./LoloFace";
