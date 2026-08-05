"use client";

import Image from "next/image";

// The brand crest at the top of onboarding: logo in a breathing halo, script
// wordmark, accent rule — the SplashIntro's composition, sized as a header.
//
// ⚠️ THE SIZES ARE NOT THE SPLASH'S, AND THAT IS THE WHOLE CARE HERE.
// The splash logo is 144px on an otherwise empty screen, where it is correctly the
// only thing. Dropped at that size onto onboarding it would beat «قبل ما نبدأ» in a
// 5px-blur test, and the screen would then have two bosses — which by `L-04` means
// neither wins and the user's eye has nowhere to land. So the logo comes down to
// 76px, the wordmark to text-2xl, and the tagline is dropped entirely (the splash
// already said it seconds ago; repeating it is words the reader has to re-skip).
// The heading stays the largest TYPE on the screen and keeps the crown; the crest
// is a mark, not a headline.
//
// ── Motion ──────────────────────────────────────────────────────────────────
// Entrance is quick — everything is done inside ~700ms — because onboarding is a
// screen people want to get PAST (`PT-onboarding-01`), and motion that delays the
// first tap is a cost, not polish. What continues after that is ambient only: the
// halo breathes on a 4.5s cycle, slow enough that the eye stops tracking it.
// The two expanding rings fire ONCE on entry as an accent and then are gone.
//
// All `transform`/`opacity`/`clip-path` — no layout, no repaint of content
// (`VP-18`) — and every animation here collapses under prefers-reduced-motion via
// the rules in globals.css.

export function OnboardingCrest() {
  return (
    <div className="flex flex-col items-center pb-1 pt-2">
      <div className="relative grid place-items-center">
        {/* Breathing halo — stays for as long as the screen does, unlike the
            splash's one-shot bloom. Scaled with the logo so the glow still reads as
            light coming OFF the mark rather than a disc sitting behind it. */}
        <span
          aria-hidden
          className="ob-halo-breathe pointer-events-none absolute rounded-full"
          style={{
            width: "230px",
            height: "230px",
            background:
              "radial-gradient(circle, rgba(255,177,0,0.55) 0%, rgba(244,123,66,0.22) 52%, transparent 74%)",
          }}
        />
        {/* Two accent rings that expand once on entry, then vanish — the splash's
            exact gesture, at header scale. */}
        <span
          aria-hidden
          className="animate-splash2-ring-expand pointer-events-none absolute rounded-full border border-[rgba(255,177,0,0.55)]"
          style={{ width: "168px", height: "168px" }}
        />
        <span
          aria-hidden
          className="animate-splash2-ring-expand pointer-events-none absolute rounded-full border border-[rgba(244,123,66,0.35)]"
          style={{ width: "138px", height: "138px", animationDelay: "0.18s" }}
        />

        <Image
          src="/logo.png"
          alt="لولو شوب"
          width={240}
          height={240}
          loading="eager"
          fetchPriority="high"
          className="animate-splash2-logo-rise relative h-[120px] w-[120px] object-contain"
          style={{ filter: "drop-shadow(0 0 18px rgba(255,177,0,0.38))" }}
        />
      </div>

      {/* ⚠️ THE SCRIPT WORDMARK WAS REMOVED (owner: «text under logo less»).
          It rendered «lolo shop 96» directly beneath a logo that ALREADY has
          "lolo shop" drawn inside it — the brand name twice, six inches apart. The
          splash can afford the pairing because the mark is alone on the screen with
          nothing under it; here it was just a second label competing with the
          heading for the space under the crest.
          (It also had a bidi bug — the RTL flex row reversed it to «96 lolo shop» —
          which is fixed in SplashIntro, the one place it still renders.)
          The accent rule stays: it does real work as the divider between the brand
          block and the questions, and it carries no words. */}
      <span
        aria-hidden
        className="animate-splash2-rule-grow mt-4 block h-px w-16"
        style={{
          background:
            "linear-gradient(90deg, rgba(244,123,66,0.15), rgba(255,177,0,0.8), rgba(244,123,66,0.15))",
        }}
      />
    </div>
  );
}
