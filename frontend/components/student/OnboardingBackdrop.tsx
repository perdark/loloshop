// The onboarding stage — built to the reference design the owner supplied
// (2026-08-05): a warm near-white screen with soft geometric ornament in peach.
//
// ⚠️ WHY THE ORNAMENT IS THE POINT. Four earlier attempts were rejected, the last
// on all four axes at once (colour, layout, logo, «doesn't feel like a real app»).
// What the reference has that none of them did is *ornament with structure* — a
// big quarter-circle bleeding off one corner, a huge faint arc on the other side,
// two small dot grids and a sparkle. None of it is a gradient wash, which is what
// kept reading as unfinished. Shapes have edges; a fade does not.
//
// Everything here is CSS and inline SVG — no image request, and it scales to any
// phone. Positions are in percentages so the composition holds from a 320px phone
// to a 512px column instead of being tuned to one width.
//
// Kept deliberately pale (peach on near-white, nothing above ~0.5 alpha): this is
// the set, and the boss of the screen is the form on top of it (`L-04`).

/** One dot grid, like the two in the reference. */
function DotGrid({
  cols,
  rows,
  className,
}: {
  cols: number;
  rows: number;
  className: string;
}) {
  const gap = 11;
  const r = 2.4;
  return (
    <svg
      aria-hidden
      className={className}
      width={(cols - 1) * gap + r * 2}
      height={(rows - 1) * gap + r * 2}
      fill="none"
    >
      {Array.from({ length: rows }).map((_, y) =>
        Array.from({ length: cols }).map((_, x) => (
          <circle
            key={`${x}-${y}`}
            cx={x * gap + r}
            cy={y * gap + r}
            r={r}
            fill="#F6CFAF"
          />
        ))
      )}
    </svg>
  );
}

export function OnboardingBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Warm paper. Near-white at the top, settling into peach at the bottom —
          a long, almost-invisible shift, not a visible gradient. Nothing on this
          screen is pure #FFFFFF. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, #FFFCFA 0%, #FDF6EF 52%, #FAEDE2 100%)",
        }}
      />

      {/* Big filled quarter-circle, bleeding off the top-end corner. The single
          strongest shape on the screen and the thing that makes the composition
          read as designed rather than empty. */}
      <span
        className="absolute rounded-full"
        style={{
          width: "62%",
          aspectRatio: "1",
          top: "-14%",
          insetInlineEnd: "-16%",
          background: "#FBDCC4",
          opacity: 0.62,
        }}
      />

      {/* Huge, very faint outlined circle on the opposite side — the counterweight.
          Mostly off-screen, so only a long arc shows. */}
      <span
        className="absolute rounded-full"
        style={{
          width: "112%",
          aspectRatio: "1",
          top: "6%",
          insetInlineStart: "-72%",
          border: "1.5px solid #F3DECD",
        }}
      />

      {/* Two dot grids, diagonally opposed, exactly as in the reference. */}
      <span className="absolute" style={{ top: "22%", insetInlineEnd: "7%" }}>
        <DotGrid cols={4} rows={4} className="block" />
      </span>
      <span className="absolute" style={{ top: "47%", insetInlineStart: "6%" }}>
        <DotGrid cols={3} rows={4} className="block" />
      </span>

      {/* Four-pointed sparkle + a small ring — the two tiny accents that stop the
          ornament from reading as a template. */}
      <svg
        aria-hidden
        className="absolute"
        style={{ top: "21%", insetInlineStart: "17%" }}
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
      >
        <path
          d="M9 0 C9.6 5.4 12.6 8.4 18 9 C12.6 9.6 9.6 12.6 9 18 C8.4 12.6 5.4 9.6 0 9 C5.4 8.4 8.4 5.4 9 0 Z"
          fill="#F8D6B8"
        />
      </svg>
      <span
        className="absolute rounded-full"
        style={{
          top: "19.5%",
          insetInlineEnd: "26%",
          width: "9px",
          height: "9px",
          border: "1.5px solid #F6CFAF",
        }}
      />
    </div>
  );
}
