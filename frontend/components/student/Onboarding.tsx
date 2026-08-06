"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getToken } from "@/lib/auth";
import { getProfile, saveProfile, type Gender } from "@/lib/profile";
import { GraduateFemaleIcon, GraduateMaleIcon } from "./GraduateIcons";
import { OnboardingBackdrop } from "./OnboardingBackdrop";
import { OnboardingCrest } from "./OnboardingCrest";

/**
 * First-run welcome — two questions, then out of the way forever.
 *
 * ⚠️ THE OPENING PHOTO SCREEN WAS REMOVED (owner, 2026-08-05): «remove the first
 * look of onboarding because photo is bad and i didn't find a good photo for it».
 * It was a full-bleed hero (`/lookbook/onboarding-hero-v2.jpg`) carrying «يوم
 * واحد. وصورة تبقى العمر كله.» and a «يلا نبدأ» button, and everything it did was
 * decorative — it collected nothing. Deleting it removes a whole tap between a
 * first-time visitor and the shop, which is the right trade even before the photo
 * quality argument. The asset is left on disk, unreferenced, so restoring the
 * screen later is a revert rather than a re-shoot.
 *
 * With one screen there is no step machine any more: no `step`/`back` state, no
 * enter animation keyed on the step, no «رجوع», and no progress dots (two dots
 * for a single screen would be a lie about how much is left).
 *
 * WHAT WAS WRONG WITH THE MOCKUP'S VERSION, and what is different here:
 *
 *  1. IT WAS A WALL. The mockup's continue button stayed disabled until both
 *     fields were filled and offered no way past — a stranger on a slow phone
 *     had to hand over a name and a gender before seeing a single product.
 *     That is a bounce, not an onboarding. «تخطّي» is always available and
 *     skipping is remembered, so the shop is never more than one tap away.
 *  2. IT ASKED SIGNED-IN STUDENTS WHAT THE DB ALREADY KNOWS. A student with an
 *     account has a name and gender on `users`/`students`; asking again invites
 *     two different answers for one person. This renders nothing when a token
 *     is present.
 *  3. THE ASK NOW BUYS SOMETHING. Gender is not a demographic here — products
 *     carry `genderRestriction` and the storefront hides the ones that do not
 *     apply, so answering visibly changes the catalog. The copy says so.
 *
 * The gender control is radio CARDS, never a <select>: a guessable required
 * field in a bare select is exactly what Chrome autofilled to «ذكر» in the
 * 2026-07-26 session, silently pricing the wrong order.
 */

/* Safe-area padding. The portal is `fixed inset-0`, so inside the Capacitor
   webview it runs under the notch and the home bar — without these the top row
   is clipped and «يلا نشوف القطع» sits under the gesture bar. env() is inline
   rather than the `.safe-top` utility because the value has to be ADDED to the
   design padding here, not replace it. (It only reports a real value at all
   because of `viewportFit: "cover"` — see app/layout.tsx.) */
const inset = (side: "top" | "bottom" | "left" | "right", base: string) =>
  `calc(env(safe-area-inset-${side}, 0px) + ${base})`;

const sideInsets = (base: string) => ({
  paddingLeft: inset("left", base),
  paddingRight: inset("right", base),
});

/* Must match `--ob-leave` in globals.css. The screen animates out for this long
   before the portal unmounts; if the two ever disagree the visitor sees either a
   half-faded screen cut off mid-exit (too short) or a blank hold (too long). */
const LEAVE_MS = 200;

export function Onboarding() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);

  // Decide AFTER mount: both localStorage and the token are client-only, and
  // reading them during render would hydration-mismatch.
  useEffect(() => {
    setMounted(true);
    if (getToken()) return; // signed in → the DB owns these fields
    if (getProfile().seen) return; // already answered or already skipped
    setOpen(true);
  }, []);

  // The storefront behind must not scroll while the welcome owns the screen.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function finish(save: boolean) {
    if (closing) return; // a second tap during the exit must not re-save or re-arm
    if (save) {
      saveProfile({ name: name.trim() || null, gender, seen: true });
    } else {
      // Skipping still counts as seen — never ask twice.
      saveProfile({ seen: true });
    }
    /* The answer is written to storage IMMEDIATELY and the screen leaves after.
       Order matters: if the visitor kills the app during the 200ms exit, the
       profile is already saved and they are not asked again. The animation is
       never allowed to own data. */
    setClosing(true);
    window.setTimeout(() => setOpen(false), LEAVE_MS);
  }

  if (!mounted || !open) return null;

  const canContinue = gender != null || name.trim().length >= 2;

  return createPortal(
    <>
      {/* TWO layers on purpose. The panel is capped at max-w-lg so it keeps its
          phone proportions — which means the cap ALONE leaves the live
          storefront painted on both sides of it on any screen wider than that,
          and the page read as sliced in half at 1366px (top bar cut in two, the
          tab bar showing حسابي on one edge and الرئيسية on the other). This
          backdrop is the layer that owns the viewport; the panel owns only the
          column. Not clickable on purpose: an accidental click out here would
          record «seen» and the welcome would never come back. */}
      <div
        aria-hidden
        className={`fixed inset-0 z-[69] bg-ink/80 backdrop-blur-md ${
          closing ? "ob-fade-out" : "ob-fade-in"
        }`}
      />
      {/* The decorated stage sits in its OWN fixed layer at the panel's exact
          geometry, rather than inside the panel. The panel is `overflow-y-auto`,
          and an absolutely-positioned child of a scroll container scrolls with the
          content — so the stitches would have slid up and out on a short phone
          where the form scrolls. Fixed here, they stay put and the content moves
          over them, which is the intent. The panel below is transparent so this
          shows through. */}
      <div
        aria-hidden
        className={`fixed inset-0 z-[69] mx-auto max-w-lg overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.45)] ${
          closing ? "ob-fade-out" : "ob-fade-in"
        }`}
      >
        <OnboardingBackdrop />
      </div>
      {/* The exit lives on the PANEL, not on the rows inside it. Each row already
          owns an `ob-rise` in the `animation` shorthand; a second animation class
          on the same element would fight it in the cascade, and which one won
          would depend on rule order in globals.css rather than on intent. */}
      <div
        className={`fixed inset-0 z-[70] mx-auto flex max-w-lg flex-col overflow-y-auto ${
          closing ? "ob-leave" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="أهلاً بك في لولو شوب"
        dir="rtl"
      >
          <div
            className="flex flex-1 flex-col"
            style={{ ...sideInsets("1.5rem"), paddingTop: inset("top", "0.75rem") }}
          >
            {/* The reference has no skip control. It gets one anyway: hiding skip
                does not create commitment, it creates uninstalls — so it stays,
                just quiet enough not to compete with the lockup. */}
            {/* Wrapped, not classed — see the cascade warning above `.ob-d5`. */}
            <div className="ob-rise ob-d5 flex items-center justify-start">
              <SkipButton onClick={() => finish(false)} />
            </div>

            <div className="mt-1">
              <OnboardingCrest />
            </div>

            {/* ⚠️ THE ARABIC HERE IS NOT COPIED VERBATIM FROM THE REFERENCE, AND
                THAT IS DELIBERATE. The reference says «اكتب اسمك» and «اختر جنسك»
                — both MASCULINE imperatives (the feminine forms are «اكتبي» and
                «اختاري»). Most of this shop's students are women, and this is the
                one screen whose entire job is to stop addressing them wrongly; it
                would be asking «which are you?» in a sentence that already assumed
                the answer. «مرحبًا بك» and «رحلتك» are kept as-is because unvocalised
                they read as either gender. So the layout is the reference's, and
                the wording stays neutral where the reference's would not have. */}
            <h1 className="ob-rise ob-d2 mt-7 text-center font-display-ar text-[1.65rem] font-bold leading-[1.4] text-ink">
              مرحبًا بك في لولو شوب
            </h1>
            <p className="ob-rise ob-d2 mt-1.5 flex items-center justify-center gap-1.5 text-center text-[13.5px] text-[var(--shop-muted)]">
              لنبدأ رحلتك معنا
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="#F26B1D">
                <path d="M12 21s-7.5-4.7-9.6-9A5.4 5.4 0 0 1 12 6.3 5.4 5.4 0 0 1 21.6 12c-2.1 4.3-9.6 9-9.6 9Z" />
              </svg>
            </p>

            <div className="ob-rise ob-d3 mt-9">
              <label className="mb-2.5 block text-[14px] font-extrabold text-ink" htmlFor="ob-name">
                اسمك
              </label>
              {/* Icon INSIDE the field at the start edge, as in the reference. The
                  input carries matching padding so the caret never sits under it. */}
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 end-4 flex items-center text-[#E8A268]"
                >
                  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="3.6" />
                    <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
                  </svg>
                </span>
                <input
                  id="ob-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: سارة أحمد"
                  autoComplete="off"
                  spellCheck={false}
                  /* 16px minimum — anything smaller makes iOS Safari zoom the whole
                     page on focus and the visitor lands mid-layout. */
                  /* `transition-colors` so the focus border grows into orange
                     instead of snapping — the field is the first thing tapped. */
                  className="min-h-[58px] w-full rounded-[16px] border-[1.5px] border-[#F3D3B8] bg-[#FFFCF9] pe-[52px] ps-4 text-base font-semibold text-ink transition-colors placeholder:font-medium placeholder:text-[#C3B2A4] focus-visible:border-[#F26B1D] focus-visible:outline-none"
                />
              </div>
            </div>

            <div className="ob-rise ob-d4 mt-6">
              <span className="mb-2.5 block text-[14px] font-extrabold text-ink" id="ob-sex-lb">
                طالب لو طالبة؟
              </span>
              {/* Side by side, radio + label + figure, as in the reference —
                  replacing the stacked full-width rows. */}
              <div className="flex gap-3" role="group" aria-labelledby="ob-sex-lb">
                <GenderCard
                  label="طالبة"
                  active={gender === "female"}
                  onClick={() => setGender("female")}
                  icon={<GraduateFemaleIcon size={44} />}
                />
                <GenderCard
                  label="طالب"
                  active={gender === "male"}
                  onClick={() => setGender("male")}
                  icon={<GraduateMaleIcon size={44} />}
                />
              </div>
            </div>

            <div
              className="ob-rise ob-d5 mt-auto"
              style={{ paddingBottom: inset("bottom", "1.5rem"), paddingTop: "2.25rem" }}
            >
              <button
                type="button"
                onClick={() => finish(true)}
                disabled={!canContinue}
                className="btn-press min-h-[58px] w-full rounded-[16px] bg-[#F26B1D] text-[16px] font-extrabold text-white shadow-[0_10px_24px_-12px_rgba(242,107,29,0.75)] disabled:opacity-40 disabled:shadow-none"
              >
                التالي
              </button>
            </div>
          </div>
      </div>
    </>,
    document.body
  );
}

/**
 * One gender choice, laid out as in the reference: radio · label · figure, two
 * side by side.
 *
 * Separate from the exported `GenderRow` on purpose — that one is a full-width
 * stacked row and «تفضيلاتي» on the account screen still uses it, where a
 * two-across grid would be wrong next to the other settings. Same answer, two
 * presentations, each suited to its screen.
 */
function GenderCard({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      /* `btn-press` REPLACES `transition-colors`, it isn't added to it — it already
         transitions background-color and border-color, and adds the one thing a
         phone can actually feel: the card gives way under the thumb. This is the
         only control on the screen the visitor taps to answer, so it was also the
         only one that answered with nothing but a colour swap. */
      className={`btn-press flex min-h-[76px] flex-1 items-center gap-2 rounded-[16px] border-[1.5px] px-3 ${
        active
          ? "border-[#F26B1D] bg-[rgba(242,107,29,0.08)]"
          : "border-[#F3D3B8] bg-[#FFFCF9]"
      }`}
    >
      {/* The radio sits on the start edge, mirroring the reference. Presentational
          only — the button itself carries aria-pressed. */}
      <span
        aria-hidden
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
          active ? "border-[#F26B1D]" : "border-[#E8C6A8]"
        }`}
      >
        {active && (
          <span className="ob-dot-in h-[11px] w-[11px] rounded-full bg-[#F26B1D]" />
        )}
      </span>
      <span className="flex-1 text-[15px] font-extrabold text-ink">{label}</span>
      <span className="shrink-0 leading-none">{icon}</span>
    </button>
  );
}

/* The `tone` prop went with the photo screen. It existed so «تخطّي» could sit as a
   dark pill on the photograph and as plain text on cream; with only the cream
   screen left, the light variant was dead code carrying a comment about an image
   that is no longer rendered. */
function SkipButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center rounded-pill px-3 text-[13px] font-bold text-[var(--shop-muted)] transition-colors hover:text-orange-ink"
    >
      تخطّي
    </button>
  );
}

/**
 * One طالب/طالبة option — a full-width row, not half of a two-up grid.
 *
 * Exported because «تفضيلاتي» edits the SAME answer: two controls that look
 * different for one field is how a visitor ends up unsure whether they already
 * answered.
 *
 * THE TICK IS NOT DECORATION. Selection used to be carried by an orange border
 * and an orange icon — colour alone, in a shop whose buyers are outdoors on a
 * phone in Iraqi sun, and which a colour-blind visitor cannot read at all. The
 * filled circle with a white check is a second, shape-based channel, so the
 * answer is legible with the colour thrown away.
 *
 * The row is 72px because the icons are drawn for 58px (see GraduateIcons) and
 * shrinking them merges the cap, hair and sash into one dark blob — the exact
 * failure three earlier icon versions were rejected for.
 */
export function GenderRow({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      /* Same `btn-press` swap as GenderCard, for the same reason — and so that
         answering in «تفضيلاتي» feels identical to answering in onboarding. Two
         presentations of one question may look different; they must not respond
         differently to the same thumb. */
      className={`btn-press flex min-h-[72px] w-full items-center gap-3 rounded-[16px] py-2 pe-3 ps-3.5 text-start ${
        active
          ? "border-2 border-[#F47B42] bg-[rgba(244,123,66,0.14)]"
          : /* Was `bg-white` — a hard white slab on a warm stage, which is what
               «do not keep just a white fields» was pointing at. A translucent warm
               surface lets the amber behind it come through, so the card belongs to
               the screen instead of being punched out of it. The border picks up
               the same hue rather than staying neutral grey. */
            "border-[1.5px] border-[rgba(244,123,66,0.28)] bg-[rgba(255,251,245,0.72)]"
      }`}
    >
      <span className="shrink-0 leading-none">{icon}</span>
      <span className="flex-1 text-base font-extrabold text-ink">{label}</span>
      <Tick active={active} />
    </button>
  );
}

function Tick({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-pill transition-colors ${
        active ? "bg-[#F47B42]" : "border-[1.5px] border-neutral-dark"
      }`}
    >
      {active ? (
        <svg
          viewBox="0 0 24 24"
          className="ob-dot-in h-3.5 w-3.5"
          fill="none"
          stroke="#fff"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : null}
    </span>
  );
}
