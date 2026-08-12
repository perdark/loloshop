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
}: {
  emotion?: LoloEmotion;
  size?: number;
  float?: boolean;
  sizeClassName?: string;
  className?: string;
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
    // eslint-disable-next-line @next/next/no-img-element -- deliberate, see the file header:
    // next/image would route each face through the optimizer, and its first-show fetch would
    // land a blank frame exactly where the expression change is the entire point. These are
    // already sized and compressed for their display size (~18KB each) and warmed at idle.
    <img
      key={emotion}
      src={src(emotion)}
      alt={ALT[emotion]}
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
