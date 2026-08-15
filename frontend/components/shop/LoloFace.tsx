"use client";

/**
 * «لولو» — the mascot's face, and the only thing in the UI that says how the assistant feels.
 *
 * The seven expressions are cut from the official brand sheet (Happy · Excited · Thinking ·
 * Love · Wink · Typing · Sleeping) — the owner's own artwork, not invented here. Head only,
 * because the sheet paints full bodies whose legs run behind its label pills, so any crop that
 * kept the body ended in an amputation; the head reads as an avatar down to 32px.
 *
 * WHY THE SERVER PICKS THE FACE. The client knows when it is waiting, but only the server knows
 * whether the answer it just wrote was a price list or a shrug. So `emotion` arrives with the
 * answer (backend/lib/supportActions.js → pickEmotion) and the client only fills in the states
 * it genuinely owns: thinking while a request is in flight, sleeping when the assistant is off.
 *
 * PLAIN <img>, NOT next/image. These swap on almost every message, and next/image's optimizer
 * round-trip on first show would put a blank frame exactly where the expression change is the
 * whole point. They are already sized and compressed for their display size (~18KB each).
 */

import { useEffect, useRef, useState } from "react";

/**
 * What لولو DOES the moment she reads the student's message — a one-off beat, not a face she
 * settles into. The judgement is the server's (backend/lib/reaction.js → pickReaction, which
 * also explains why this is a third field and not a widening of `emotion`/`mood`); the
 * PRESENTATION — which of the seven faces, which motion, which spark — is decided here, the
 * same split `mood` already uses.
 *
 * `none` is the common case on purpose: an ordinary «شكد سعر الروب؟» earns no beat, because a
 * face that jumps on every reply is noise rather than a reaction.
 */
export type Reaction = "love" | "care" | "laugh" | "cheer" | "none";

export type LoloEmotion =
  | "happy"
  | "excited"
  | "thinking"
  | "love"
  | "wink"
  | "typing"
  | "sleeping";

const ALL: LoloEmotion[] = ["happy", "excited", "thinking", "love", "wink", "typing", "sleeping"];

const src = (e: LoloEmotion) => `/lolo/${`lolo-${e}`}.webp`;

/** Arabic labels so a screen-reader user gets the expression too, not just sighted users. */
const ALT: Record<LoloEmotion, string> = {
  happy: "لولو مبتسم",
  excited: "لولو متحمّس",
  thinking: "لولو يفكّر",
  love: "لولو مبسوط بيك",
  wink: "لولو يغمز",
  typing: "لولو يكتب",
  sleeping: "لولو نايم",
};

/**
 * Warm the other faces once, after the page has settled.
 *
 * Without this the first expression change on a slow Iraqi connection is a gap where the face
 * should be. `requestIdleCallback` keeps it off the critical path — the first paint only ever
 * needs the one face being shown.
 */
let warmed = false;
function warmFaces() {
  if (warmed || typeof window === "undefined") return;
  warmed = true;
  const run = () => ALL.forEach((e) => { new Image().src = src(e); });
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
    .requestIdleCallback;
  if (idle) idle(run);
  else window.setTimeout(run, 1500);
}

export function LoloFace({
  emotion = "happy",
  size = 56,
  /** Idle float. Off for the small in-thread avatars, where a row of bobbing heads is noise. */
  float = false,
  /** Tailwind width/height classes for a face that must change size across breakpoints.
   *  When set, the inline size is dropped so the classes actually win — `size` then only
   *  feeds the width/height ATTRIBUTES, which is what reserves the box and avoids layout
   *  shift before the image decodes. */
  sizeClassName,
  className = "",
  alt,
}: {
  emotion?: LoloEmotion;
  size?: number;
  float?: boolean;
  sizeClassName?: string;
  className?: string;
  /** Overrides the expression-derived alt. Set it when one slot changes expression on its own
   *  — the reaction beat below — so the accessible name stays STABLE while the picture moves.
   *  Both chat surfaces render the thread inside `aria-live="polite"`, and a face that swaps
   *  twice per reply would otherwise announce itself twice on top of the answer being read. */
  alt?: string;
}) {
  const [bump, setBump] = useState(0);
  const first = useRef(true);

  useEffect(() => { warmFaces(); }, []);

  // A little pop whenever the expression actually changes — the reaction the owner asked for.
  // Skipped on mount so the page does not start with everything jumping.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setBump((n) => n + 1);
  }, [emotion]);

  return (
    // Deliberate, see the file header: next/image would route each face through the optimizer,
    // and its first-show fetch would land a blank frame exactly where the expression change is
    // the entire point. These are already sized and compressed for their display size (~18KB
    // each) and warmed at idle.
    // eslint-disable-next-line @next/next/no-img-element -- see the four lines above
    <img
      key={emotion}
      src={src(emotion)}
      alt={alt ?? ALT[emotion]}
      width={size}
      height={size}
      draggable={false}
      // `key` remounts on change, which restarts the pop animation; `bump` keeps the class
      // stable for React while still varying per change.
      data-bump={bump}
      className={`select-none object-contain ${float ? "lolo-float" : ""} lolo-pop ${sizeClassName ?? ""} ${className}`}
      style={sizeClassName ? undefined : { width: size, height: size }}
    />
  );
}

/**
 * ⚠️ PLACEHOLDER — the caring sticker is the one piece of art that does not exist yet.
 *
 * Owner decision 2026-08-15: every other reaction reuses the brand sheet, but `care` gets a
 * PURPOSE-DRAWN sticker, because the sheet has nothing right for it. The nearest candidates are
 * both wrong in a way that matters on the one message where tone is everything: `love` is
 * heart-eyes, which reads as being smitten AT someone having a bad day, and `thinking` reads as
 * «همم», not «آني وياك». `thinking` is the less wrong of the two, so it holds the slot.
 *
 * TO SWAP IT IN: drop the drawn file at `frontend/public/lolo/lolo-care.webp` (256×256, alpha,
 * same scale and lighting as its siblings) and change this one line to `/lolo/lolo-care.webp`.
 * Nothing else in the app needs to change.
 */
const CARE_STICKER = "/lolo/lolo-thinking.webp";

/**
 * The sticker لولو sends — which picture, the emoji that floats off it, and what a screen reader
 * is told she just sent.
 *
 * This is a MESSAGE, not an ornament on one: it is its own turn in the thread and it stays there,
 * exactly like a person sending a sticker before they start typing. That is the whole reason this
 * treatment was chosen over the two quieter ones — at 104px it cannot be missed on a phone, which
 * is the only device the students who use this actually have.
 */
const STICKER: Record<Exclude<Reaction, "none">, { src: string; spark: string; alt: string }> = {
  love: { src: "/lolo/lolo-love.webp", spark: "🧡", alt: "لولو دزّت ستيكر — مبسوطة بكلامك" },
  care: { src: CARE_STICKER, spark: "🤍", alt: "لولو دزّت ستيكر — وياك" },
  laugh: { src: "/lolo/lolo-wink.webp", spark: "😄", alt: "لولو دزّت ستيكر — تضحك" },
  cheer: { src: "/lolo/lolo-excited.webp", spark: "✨", alt: "لولو دزّت ستيكر — تفرحلك" },
};

/**
 * One sticker message from «لولو», reacting to what the student just wrote.
 *
 * ── WHY IT PERSISTS ──────────────────────────────────────────────────────────────────────
 * `animate` gates the ENTRANCE, never whether the sticker exists. A real message does not
 * evaporate a second after it lands, so a thread restored from storage still shows every sticker
 * it received — it just does not replay all of them at once on page load. This is the difference
 * between a message and an animation, and it is the reason the sticker is a sibling of the
 * bubble in ChatBubble rather than something drawn on top of it.
 *
 * The floating emoji is entrance-only: it is a flourish on arrival, and a restored thread showing
 * a dozen frozen emoji would be litter.
 *
 * PLAIN <img>, NOT next/image — same reasoning as LoloFace above, and these are the same
 * already-compressed 256×256 assets.
 */
export function LoloSticker({ reaction, animate = false }: { reaction: Reaction; animate?: boolean }) {
  if (reaction === "none") return null;
  const s = STICKER[reaction];

  return (
    <div className="flex items-end gap-2">
      <span className={`relative block shrink-0 ${animate ? "lolo-sticker-in" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- see the file header */}
        <img
          src={s.src}
          alt={s.alt}
          width={104}
          height={104}
          draggable={false}
          className="block h-[104px] w-[104px] select-none object-contain"
        />
        {animate && (
          <span
            aria-hidden="true"
            className="lolo-sticker-spark pointer-events-none absolute -top-1 start-2 select-none text-2xl leading-none"
          >
            {s.spark}
          </span>
        )}
      </span>
    </div>
  );
}

/** The "…" while the model answers. Deliberately not a spinner: on a slow Iraqi connection a
 *  spinner reads as "stuck", three bouncing dots read as "someone is replying". */
export function TypingDots() {
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-surface-sink px-4 py-3">
      {[0, 150, 300].map((d) => (
        <span
          key={d}
          className="h-2 w-2 animate-bounce rounded-full bg-muted"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </div>
  );
}
