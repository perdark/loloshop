/**
 * The two graduate figures used wherever a student picks طالب / طالبة.
 *
 * WHY THESE ARE COLOURED AND NOT FLAT PICTOGRAMS — this is the whole point of the
 * component, so do not "simplify" them back to a single fill.
 *
 * Three earlier versions of this pair were monochrome silhouettes and the owner
 * rejected all of them with the same complaint: «beauty but not understandable».
 * A one-colour shape carries meaning in exactly one channel — its outline — and
 * "graduate wearing a mortarboard" has the SAME outline for everyone. The cap
 * dominates the top of both figures and the only difference left lives in thin
 * hair strands, which disappear the instant you stop staring at them.
 *
 * These use four channels instead: skin, hair, gown and the orange tassel/sash.
 * The differentiator is a large dark mass — her hair is drawn WIDER THAN HER
 * SHOULDERS and falls past the jaw; his is a small crop on top only. A mass
 * survives blur; a contour does not. The test the owner set is "understandable
 * from far at first look", so the working check is: shrink to 50% and blur 2px —
 * the two must still be tellable apart.
 *
 * NO BEARD. An earlier cut gave the male figure a beard (the strongest locally
 * true male cue) and the owner removed it explicitly. Do not reintroduce it.
 *
 * NO HIJAB. Deliberate: public/lookbook/grad-moments-1.jpg shows rows of
 * hijab-wearing graduates AND frames of students with their hair out, so
 * committing to either excludes real buyers. The hair mass reads as female
 * without claiming which.
 *
 * Rendered at 58px in the onboarding rows. Below ~46px the cap, hair and sash
 * merge into one dark blob — if you need smaller, redraw rather than scale.
 */

const SKIN = "#E3AC85";
const HAIR = "#2B211C";
const GOWN = "#23252B";
const CAP = "#17181C";
const SASH = "#F47B42";
const TASSEL = "#F9A03F";

interface GraduateIconProps {
  /** Rendered px. The drawing is tuned for 58; see the note above about small sizes. */
  size?: number;
  className?: string;
}

/** Mortarboard + tassel. Identical on both figures — it is the brand cue, not the differentiator. */
function Cap() {
  return (
    <>
      <path d="M32 3 60.5 14.5 32 26 3.5 14.5Z" fill={CAP} />
      <path
        d="M56.5 17v9"
        stroke={TASSEL}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="56.5" cy="28.4" r="2.7" fill={TASSEL} />
    </>
  );
}

export function GraduateFemaleIcon({ size = 58, className }: GraduateIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 64c1.5-9 9-14.5 26-14.5S56.5 55 58 64z" fill={GOWN} />
      <path d="M28 50h8l-1.5 14h-5z" fill={SASH} />
      <rect x="28" y="38" width="8" height="13" fill={SKIN} />
      {/* Hair: wider than the shoulders and past the jaw. This mass IS the differentiator. */}
      <path
        d="M14.5 35.5c0-11.6 7.5-19.5 17.5-19.5s17.5 7.9 17.5 19.5c0 9.6-1.1 17-3.1 23h-7V33H24.6v25h-7c-2-6-3.1-13.4-3.1-23z"
        fill={HAIR}
      />
      <ellipse cx="32" cy="33.5" rx="10" ry="11.5" fill={SKIN} />
      {/* Fringe over the brow — stops the face reading as a bare oval pasted on hair. */}
      <path d="M22 29.5c1-7 5-11 10-11s9 4 10 11c-3-4.2-6-6.2-10-6.2s-7 2-10 6.2z" fill={HAIR} />
      <Cap />
    </svg>
  );
}

export function GraduateMaleIcon({ size = 58, className }: GraduateIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 64c1.5-9.5 9-15 26-15s24.5 5.5 26 15z" fill={GOWN} />
      <path d="M28 50h8l-1.5 14h-5z" fill={SASH} />
      <rect x="28" y="38" width="8" height="13" fill={SKIN} />
      <ellipse cx="32" cy="33" rx="10" ry="11.5" fill={SKIN} />
      {/* Short crop only — clean-shaven. The beard was removed by the owner; do not restore it. */}
      <path
        d="M21.6 27.5c1.3-7.6 5.3-11.1 10.4-11.1s9.1 3.5 10.4 11.1c-2.6-4.3-5.8-6-10.4-6s-7.8 1.7-10.4 6z"
        fill={HAIR}
      />
      <Cap />
    </svg>
  );
}
