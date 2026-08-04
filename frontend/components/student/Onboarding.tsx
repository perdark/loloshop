"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getToken } from "@/lib/auth";
import { getProfile, saveProfile, type Gender } from "@/lib/profile";

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
   SpotlightReel, and this frame crops far taller than they do — it needs a
   full-length subject centred in a 9:16 plate, with the lower third dark
   enough to carry the headline. Deliberately carries NO lettering on the
   sash: the overlay copy is the message here, and an invented university
   name on the opening screen is a claim the shop never made. */
const HERO_SRC = "/lookbook/onboarding-hero.jpg";

export function Onboarding() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
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
        {step === 1 ? (
        /* One full-bleed screen, not a photo panel stacked on a cream bar.
           The first cut faded the photo into a cream footer, which drew a hard
           seam across the screen and squeezed the headline against it. Everything
           now sits ON the photo, so it reads as a single opening frame. */
        <div className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden bg-ink">
          <Image
            src={HERO_SRC}
            alt="خرّيجة بروب تخرّج وقبعة بشرّابة ذهبية ووشاح مخملي أحمر مطرّز بخيط ذهبي"
            fill
            sizes="(min-width: 512px) 512px, 100vw"
            loading="eager"
            fetchPriority="high"
            className="-z-20 object-cover object-[50%_12%]"
          />
          <span
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background:
                "linear-gradient(to top, rgba(18,15,13,0.97) 0%, rgba(18,15,13,0.92) 22%, rgba(18,15,13,0.62) 42%, rgba(18,15,13,0.12) 64%, rgba(18,15,13,0.42) 100%)",
            }}
          />

          <div className="flex items-center justify-between gap-3 px-4 pt-6">
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
          <div className="mt-auto px-4 pb-7">
            <p className="font-display text-[11px] font-bold tracking-[0.2em] text-peach">
              CLASS OF 2026
            </p>
            <h1 className="mt-2.5 text-balance font-display-ar text-[2.4rem] font-bold leading-[1.28] text-cream">
              يوم واحد. وصورة تبقى العمر كله.
            </h1>
            <p className="mt-3.5 max-w-[32ch] text-[15px] leading-relaxed text-cream/85">
              أوشحة وروبات وقبعات تخرّج — مخيوطة ومطرّزة بورشتنا، وتوصلك قبل
              موعد الحفل.
            </p>

            <div className="mt-7">
              <PrimaryButton onClick={() => setStep(2)}>يلا نبدأ</PrimaryButton>
              {/* Says what the next screen costs, so «يلا نبدأ» is not a leap
                  into an unknown form. */}
              <p className="mt-3 text-center text-xs font-semibold text-cream/60">
                سؤالين بس · أقل من دقيقة
              </p>
            </div>
            <div className="mt-5">
              <Dots step={1} onDark />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 px-4 pb-6 pt-8">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
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
              <div className="grid grid-cols-2 gap-3" role="group" aria-labelledby="ob-sex-lb">
                <GenderCard
                  label="طالبة"
                  active={gender === "female"}
                  onClick={() => setGender("female")}
                  path={
                    <>
                      <circle cx="12" cy="8" r="5" />
                      <path d="M12 13v8" />
                      <path d="M9 18h6" />
                    </>
                  }
                />
                <GenderCard
                  label="طالب"
                  active={gender === "male"}
                  onClick={() => setGender("male")}
                  path={
                    <>
                      <circle cx="10" cy="14" r="5" />
                      <path d="M14.5 9.5 20 4" />
                      <path d="M15 4h5v5" />
                    </>
                  }
                />
              </div>
            </div>
          </div>

          <div className="bg-cream px-4 pb-8 pt-6">
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
          ? "bg-white/12 text-cream backdrop-blur-sm hover:bg-white/20"
          : "text-[var(--shop-muted)] hover:text-orange-ink"
      }`}
    >
      تخطّي
    </button>
  );
}

function Dots({ step, onDark = false }: { step: 1 | 2; onDark?: boolean }) {
  return (
    <div className="flex justify-center gap-1.5" aria-hidden>
      {[1, 2].map((n) => (
        <i
          key={n}
          className={`h-1.5 rounded-pill transition-all ${
            n === step
              ? onDark
                ? "bg-cream"
                : "bg-orange-ink"
              : onDark
                ? "bg-cream/35"
                : "bg-line"
          }`}
          style={{ width: n === step ? 22 : 6 }}
        />
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

function GenderCard({
  label,
  active,
  onClick,
  path,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  path: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-[118px] flex-col items-center justify-center gap-2 rounded-card border-[1.5px] p-4 text-[15px] font-extrabold transition-colors ${
        active
          ? "border-orange-ink bg-orange/10 text-orange-ink"
          : "border-line bg-beige text-ink-soft"
      }`}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className={`h-[30px] w-[30px] transition-colors ${
          active ? "text-orange-ink" : "text-[var(--shop-muted)]"
        }`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {path}
      </svg>
      {label}
    </button>
  );
}
