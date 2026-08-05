"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getToken } from "@/lib/auth";
import { getProfile, saveProfile, type Gender } from "@/lib/profile";
import { GraduateFemaleIcon, GraduateMaleIcon } from "./GraduateIcons";

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

export function Onboarding() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
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
    if (save) {
      saveProfile({ name: name.trim() || null, gender, seen: true });
    } else {
      // Skipping still counts as seen — never ask twice.
      saveProfile({ seen: true });
    }
    setOpen(false);
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
        className="fixed inset-0 z-[69] bg-ink/80 backdrop-blur-md"
      />
      <div
        className="fixed inset-0 z-[70] mx-auto flex max-w-lg flex-col overflow-y-auto bg-cream shadow-[0_0_60px_rgba(0,0,0,0.45)]"
        role="dialog"
        aria-modal="true"
        aria-label="أهلاً بك في لولو شوب"
        dir="rtl"
      >
          <div
            className="flex-1 pb-6"
            style={{ ...sideInsets("1rem"), paddingTop: inset("top", "2rem") }}
          >
            {/* «رجوع» went with the photo screen — there is nothing behind this
                one to go back to. «تخطّي» stays, and it is now the only way past,
                which is the point: the shop is one tap away at all times. */}
            <div className="flex items-center justify-end">
              <SkipButton onClick={() => finish(false)} />
            </div>

            {/* Every string on THIS screen is gender-neutral on purpose: it is
                asked before the answer is known, so «خلّينا نتعرّف عليك» would
                address a woman in the masculine on the one screen whose whole
                job is to stop getting that wrong. */}
            <h1 className="mt-3 font-display-ar text-[2rem] font-bold leading-[1.35] text-ink">
              قبل ما نبدأ
            </h1>
            <p className="mt-2 max-w-[34ch] text-[13.5px] leading-relaxed text-[var(--shop-muted)]">
              هالمعلومتين تخلّي التطبيق يعرض المقاسات والخيارات الصحيحة — ويحچي
              بالشكل الصحيح. تنعدّل بأي وقت من «حسابي».
            </p>

            <div className="mt-8">
              <label
                className="mb-3 block text-[13.5px] font-extrabold text-ink"
                htmlFor="ob-name"
              >
                شنو الاسم؟
              </label>
              <input
                id="ob-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: سارة أحمد"
                autoComplete="off"
                spellCheck={false}
                /* 16px minimum — anything smaller makes iOS Safari zoom the
                   whole page on focus and the visitor lands mid-layout. */
                className="min-h-[52px] w-full rounded-[12px] border border-line bg-beige px-4 text-base font-semibold text-ink placeholder:font-medium placeholder:text-[var(--shop-muted)] focus-visible:border-orange-ink focus-visible:outline-none"
              />
            </div>

            <div className="mt-8">
              <span
                className="mb-3 block text-[13.5px] font-extrabold text-ink"
                id="ob-sex-lb"
              >
                طالب لو طالبة؟
              </span>
              <div className="flex flex-col gap-2.5" role="group" aria-labelledby="ob-sex-lb">
                <GenderRow
                  label="طالبة"
                  active={gender === "female"}
                  onClick={() => setGender("female")}
                  icon={<GraduateFemaleIcon size={58} />}
                />
                <GenderRow
                  label="طالب"
                  active={gender === "male"}
                  onClick={() => setGender("male")}
                  icon={<GraduateMaleIcon size={58} />}
                />
              </div>
            </div>
          </div>

          <div
            className="bg-cream pt-6"
            style={{
              ...sideInsets("1rem"),
              paddingBottom: inset("bottom", "2rem"),
            }}
          >
            <PrimaryButton onClick={() => finish(true)} disabled={!canContinue}>
              يلا نشوف القطع
            </PrimaryButton>
          </div>
      </div>
    </>,
    document.body
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

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-pill bg-orange-ink px-6 text-sm font-extrabold text-white shadow-[var(--shadow-float)] transition-[background-color,transform,opacity] duration-200 hover:-translate-y-0.5 hover:bg-ink disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none"
    >
      {children}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
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
      className={`flex min-h-[72px] w-full items-center gap-3 rounded-[16px] py-2 pe-3 ps-3.5 text-start transition-colors ${
        active
          ? "border-2 border-[#F47B42] bg-[rgba(244,123,66,0.09)]"
          : "border-[1.5px] border-line bg-white"
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
          className="h-3.5 w-3.5"
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
