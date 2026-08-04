"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getToken } from "@/lib/auth";
import { getProfile, saveProfile, type Gender } from "@/lib/profile";
import { GraduateFemaleIcon, GraduateMaleIcon } from "./GraduateIcons";

/**
 * First-run welcome — one emotional beat, then two questions, then out of the
 * way forever.
 *
 * WHAT WAS WRONG WITH THE MOCKUP'S VERSION, and what is different here:
 *
 *  1. IT WAS A WALL. The mockup's continue button stayed disabled until both
 *     fields were filled and offered no way past — a stranger on a slow phone
 *     had to hand over a name and a gender before seeing a single product.
 *     That is a bounce, not an onboarding. Here BOTH steps carry «تخطّي», and
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

/* Its own asset, not one of the `look-*` shots: those are shared with
   SpotlightReel, and this frame crops far taller than they do. Deliberately
   carries NO lettering on the sash: the overlay copy is the message here, and
   an invented university name on the opening screen is a claim the shop never
   made.

   `-v2` is the SAME photograph re-cropped, not a new one — `onboarding-hero.jpg`
   stays on disk. The original is a full-length subject in a 1080×1920 plate, so
   the graduate read as a distant figure and the gold embroidery ran through the
   entire lower third, which is exactly where the headline sits. v2 is a
   cap-and-shoulders crop (800×1430 taken from the top of the frame, JPEG q85
   through the same sharp policy backend/lib/upload.js uses) — it keeps the two
   things that say "graduation", the mortarboard and the tassel, at a size a
   thumb-height phone can actually read, and it drops the sash tips and hands.
   The crop keeps the original 0.56 aspect on purpose: object-cover in a
   ~0.46 phone frame then shows the full height and trims only the sides. */
const HERO_SRC = "/lookbook/onboarding-hero-v2.jpg";

/* Safe-area padding. The portal is `fixed inset-0`, so inside the Capacitor
   webview it runs under the notch and the home bar — without these the logo row
   is clipped at the top and «يلا نبدأ» sits under the gesture bar. env() is
   inline rather than a Tailwind class because the value has to be added to the
   design padding, not replace it. */
const inset = (side: "top" | "bottom" | "left" | "right", base: string) =>
  `calc(env(safe-area-inset-${side}, 0px) + ${base})`;

const sideInsets = (base: string) => ({
  paddingLeft: inset("left", base),
  paddingRight: inset("right", base),
});

/* Step transitions animate ONLY transform and opacity — both composited, neither
   triggers layout. The previous screen unmounts, so this is an enter animation
   on the incoming step (keyed by `step`, which remounts it) rather than a
   two-panel slide: a horizontal track would need its own scroll container and
   would fight the dialog's own overflow on a short phone.
   RTL: forward comes in from the left, «رجوع» from the right. */
const STEP_ANIMATION_CSS = `
.ob-step { will-change: transform; }
.ob-step-fwd { animation: ob-in-fwd 260ms cubic-bezier(0.22, 0.61, 0.36, 1) both; }
.ob-step-back { animation: ob-in-back 260ms cubic-bezier(0.22, 0.61, 0.36, 1) both; }
@keyframes ob-in-fwd {
  from { opacity: 0; transform: translate3d(-22px, 0, 0); }
  to { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes ob-in-back {
  from { opacity: 0; transform: translate3d(22px, 0, 0); }
  to { opacity: 1; transform: translate3d(0, 0, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .ob-step-fwd, .ob-step-back { animation: none; }
  .ob-step { will-change: auto; }
}
`;

export function Onboarding() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  // Which way the incoming step should slide. State, not a ref: it is read
  // during render, and a ref read at render time can hold the previous value.
  // Both setters are batched into one render, so the class and the step always
  // change together.
  const [back, setBack] = useState(false);

  function go(next: 1 | 2) {
    setBack(next < step);
    setStep(next);
  }

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
        <style>{STEP_ANIMATION_CSS}</style>
        <div
          key={step}
          className={`ob-step flex flex-1 flex-col ${
            back ? "ob-step-back" : "ob-step-fwd"
          }`}
        >
        {step === 1 ? (
        /* One full-bleed screen, not a photo panel stacked on a cream bar.
           The first cut faded the photo into a cream footer, which drew a hard
           seam across the screen and squeezed the headline against it. Everything
           now sits ON the photo, so it reads as a single opening frame. */
        <div className="relative isolate flex min-h-[100dvh] flex-1 flex-col overflow-hidden bg-ink">
          <Image
            src={HERO_SRC}
            alt="خرّيجة بروب تخرّج وقبعة بشرّابة ذهبية ووشاح مخملي أحمر مطرّز بخيط ذهبي"
            fill
            sizes="(min-width: 512px) 512px, 100vw"
            loading="eager"
            fetchPriority="high"
            className="-z-20 object-cover object-[50%_8%]"
          />
          {/* TWO scrims, and the bottom one is cream on purpose. The headline
              block sits over the sash, which is dense gold embroidery no crop of
              this photograph can avoid — so contrast has to come from the scrim,
              not from luck. Cream (the panel's own --color-cream) instead of the
              old ink wash: it carries the brand palette into a crimson-and-brown
              frame and lets the copy be ink, which is what the rest of the app
              reads like. It never reaches full opacity, so the gown still shows
              through and the screen stays ONE frame with no seam.
              The top scrim stays dark — the logo and «تخطّي» are cream, and the
              curtain behind them is light. */}
          <span
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background: [
                "linear-gradient(to top, rgba(250,244,234,0.96) 0%, rgba(250,244,234,0.95) 30%, rgba(250,244,234,0.86) 42%, rgba(250,244,234,0.55) 54%, rgba(250,244,234,0.18) 66%, rgba(250,244,234,0) 78%)",
                "linear-gradient(to bottom, rgba(18,15,13,0.62) 0%, rgba(18,15,13,0.5) 6%, rgba(18,15,13,0.26) 13%, rgba(18,15,13,0.08) 19%, rgba(18,15,13,0) 25%)",
              ].join(","),
            }}
          />

          <div
            className="flex items-center justify-between gap-3"
            style={{ ...sideInsets("1rem"), paddingTop: inset("top", "1.5rem") }}
          >
            <span className="flex items-center gap-2">
              <Image
                src="/icons/icon-192.png"
                alt=""
                width={40}
                height={40}
                className="rounded-pill"
              />
              <span className="font-display text-[15px] font-bold text-cream">
                لولو شوب
              </span>
            </span>
            <SkipButton onClick={() => finish(false)} tone="light" />
          </div>

          {/* mt-auto: the copy hangs off the bottom of the frame no matter how
              tall the phone is, instead of being pinned to a fixed offset. */}
          <div
            className="mt-auto"
            style={{
              ...sideInsets("1rem"),
              paddingBottom: inset("bottom", "1.75rem"),
            }}
          >
            <p className="font-display text-[11px] font-bold tracking-[0.2em] text-orange-ink">
              CLASS OF 2026
            </p>
            <h1 className="mt-2.5 text-balance font-display-ar text-[2.4rem] font-bold leading-[1.28] text-ink">
              يوم واحد. وصورة تبقى العمر كله.
            </h1>
            <p className="mt-3.5 max-w-[32ch] text-[15px] leading-relaxed text-ink-soft">
              أوشحة وروبات وقبعات تخرّج — مخيوطة ومطرّزة بورشتنا، وتوصلك قبل
              موعد الحفل.
            </p>

            <div className="mt-7">
              <PrimaryButton onClick={() => go(2)}>يلا نبدأ</PrimaryButton>
              {/* Says what the next screen costs, so «يلا نبدأ» is not a leap
                  into an unknown form. */}
              <p className="mt-3 text-center text-xs font-semibold text-[var(--shop-muted)]">
                سؤالين بس · أقل من دقيقة
              </p>
            </div>
            <div className="mt-5">
              <Dots step={1} />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            className="flex-1 pb-6"
            style={{ ...sideInsets("1rem"), paddingTop: inset("top", "2rem") }}
          >
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => go(1)}
                className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-bold text-[var(--shop-muted)]"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
                رجوع
              </button>
              <SkipButton onClick={() => finish(false)} tone="dark" />
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
            <div className="mb-4">
              <Dots step={2} />
            </div>
            <PrimaryButton onClick={() => finish(true)} disabled={!canContinue}>
              يلا نشوف القطع
            </PrimaryButton>
          </div>
        </>
      )}
        </div>
      </div>
    </>,
    document.body
  );
}

function SkipButton({
  onClick,
  tone,
}: {
  onClick: () => void;
  tone: "light" | "dark";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 items-center rounded-pill px-3 text-[13px] font-bold transition-colors ${
        tone === "light"
          ? /* ink, not white/12: the re-cropped photo puts pale curtain behind
               this corner, and a light pill made cream text vanish into it. */
            "bg-ink/40 text-cream backdrop-blur-sm hover:bg-ink/60"
          : "text-[var(--shop-muted)] hover:text-orange-ink"
      }`}
    >
      تخطّي
    </button>
  );
}

/* The active dot used to animate its `width`, which is a layout property — on a
   low-end Android that reflows the whole step on every change. Same look, done
   with scaleX on a fixed-width track: transform and colour only. */
function Dots({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex justify-center gap-1.5" aria-hidden>
      {[1, 2].map((n) => (
        <i key={n} className="block h-1.5 w-[22px] overflow-hidden">
          <i
            className={`block h-full w-full origin-center rounded-pill transition-[transform,background-color] duration-200 ${
              n === step ? "scale-x-100 bg-orange-ink" : "scale-x-[0.27] bg-line"
            }`}
          />
        </i>
      ))}
    </div>
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
