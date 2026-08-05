// The onboarding stage — the SplashIntro's warm-cream set, reused deliberately.
//
// ⚠️ WHY IT IS A COPY OF THE SPLASH STAGE AND NOT A NEW DESIGN (owner pick,
// 2026-08-05): the splash exits by splitting a cream curtain. If onboarding then
// appeared on a different surface, the seam would be visible and the two screens
// would read as two designs that happen to follow each other. Same gradient, same
// two glow positions, same pulse — so the curtain opens onto the set it just left
// and the whole first run reads as one continuous moment.
//
// An earlier cut put an embroidery-stitch motif over this. It was dropped when the
// splash language was chosen: a stitch motif AND a logo crest are two motifs
// competing for the same screen, which is worse than either alone. The stage's job
// now is to be a quiet set for the crest and the two questions — nothing more.
// (`L-04`: exactly one thing may dominate, and it is the question.)
//
// Costs nothing: no image, no request. Two blurred glows are the only expensive
// layers and neither sits over content.

export function OnboardingBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Warm paper, matched to SplashIntro's stage so the curtain exit is seamless
          — but pushed considerably warmer than the splash (owner: «do not keep just
          a white fields, can u add more orange»). The top third now carries a real
          amber wash instead of a hint of one, and the paper underneath is peach
          rather than off-white, so no part of the screen reads as plain white.
          Still ONE hue (`VP-03`): every stop below is the brand amber/coral at a
          different alpha. Adding a second colour to "warm it up" is exactly how a
          screen ends up in mid-chroma soup (`AP-05`). */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(125% 62% at 50% -6%, rgba(255,160,60,0.50) 0%, rgba(255,177,0,0.22) 42%, transparent 72%)," +
            "radial-gradient(110% 80% at 12% 100%, rgba(255,196,150,0.55) 0%, transparent 58%)," +
            "linear-gradient(165deg, #FFEBD6 0%, #FFE3CC 30%, #FDF0E2 62%, #FAF4EA 100%)",
        }}
      />

      {/* The same two ambient glows the splash uses, on the same slow pulse and the
          same 1.1s offset — top-end amber, bottom-start peach, both strengthened. */}
      <span
        className="animate-splash2-glow-pulse absolute -top-24 end-[-2rem] h-96 w-96 rounded-full blur-[80px]"
        style={{ background: "rgba(255,150,40,0.40)" }}
      />
      <span
        className="animate-splash2-glow-pulse absolute -bottom-20 start-[-2rem] h-80 w-80 rounded-full blur-[70px]"
        style={{ background: "rgba(255,190,140,0.62)", animationDelay: "1.1s" }}
      />
    </div>
  );
}
