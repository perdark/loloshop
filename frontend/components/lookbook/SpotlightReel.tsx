"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getHeroSlides } from "@/lib/catalog";
import type { HeroSlide } from "@/lib/types";

interface Slide {
  src: string;
  kicker: string;
  title: string;
  caption: string;
  accent: string;
  cta?: { label: string; href: string };
}

// Curated fallback shown until the admin adds slides (or if the fetch fails).
const DEFAULT_SLIDES: Slide[] = [
  {
    src: "/lookbook/look-english-red.jpg",
    kicker: "لولو شوب · دفعة ٢٠٢٦",
    title: "وشاحك… باسمك إنت",
    caption: "كل وشاح نخيّطه لطالب واحد — اسمه، كلّيته، ولونه.",
    accent: "#e2b04a",
    cta: { label: "تصفّح المتجر", href: "#shop" },
  },
  {
    src: "/lookbook/look-pharmacy-blue.jpg",
    kicker: "كلية الصيدلة · دفعة ٢٠٢٦",
    title: "أزرق الصيدلة",
    caption: "خيط فضّي وشعار الكلية — اخترناه ويا طلاب الدفعة.",
    accent: "#7fb4cc",
  },
  {
    src: "/lookbook/look-boutique.jpg",
    kicker: "من داخل محل لولو",
    title: "الإطلالة الكاملة",
    caption: "روب وكاب ووشاح، جاهزين لِلَيلة تخرّجك.",
    accent: "#f4a45f",
  },
  {
    src: "/lookbook/detail-flatlay.jpg",
    kicker: "شغل يد",
    title: "كل غرزة بإيد",
    caption: "تطريز فضّي على مخمل — مو طبع، خياطة.",
    accent: "#7fb4cc",
  },
  {
    src: "/lookbook/detail-pedestal.jpg",
    kicker: "يبقى ذكرى",
    title: "وشاح تعلّقه بعد التخرّج",
    caption: "صمّمه بنفسك خطوة خطوة، ويوصلك جاهز.",
    accent: "#7fb4cc",
    cta: { label: "صمّم وشاحك", href: "/design" },
  },
];

const INTERVAL = 4800;

function heroToSlide(h: HeroSlide): Slide {
  return {
    src: h.imageUrl,
    kicker: h.kicker ?? "",
    title: h.title,
    caption: h.caption ?? "",
    accent: h.accent || "#f4a45f",
    cta: h.ctaLabel && h.ctaHref ? { label: h.ctaLabel, href: h.ctaHref } : undefined,
  };
}

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduce;
}

export function SpotlightReel() {
  const [slides, setSlides] = useState<Slide[]>(DEFAULT_SLIDES);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false); // transient (hover / touch)
  const [userPaused, setUserPaused] = useState(false); // explicit play/pause
  const reduce = usePrefersReducedMotion();
  const touchX = useRef<number | null>(null);
  const n = slides.length;
  const stopped = paused || userPaused || reduce;

  // Admin-managed slides (fall back to the curated defaults on empty/error).
  useEffect(() => {
    let alive = true;
    getHeroSlides()
      .then((rows) => {
        if (alive && rows.length) {
          setSlides(rows.map(heroToSlide));
          setActive(0);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const go = useCallback((i: number) => setActive(((i % n) + n) % n), [n]);
  const next = useCallback(() => setActive((a) => (a + 1) % n), [n]);
  const prev = useCallback(() => setActive((a) => (a - 1 + n) % n), [n]);

  // Autoplay — halts on hover/touch, explicit pause, and reduced motion.
  useEffect(() => {
    if (stopped || n <= 1) return;
    const t = setTimeout(next, INTERVAL);
    return () => clearTimeout(t);
  }, [active, stopped, next, n]);

  function onTouchStart(e: React.TouchEvent) {
    touchX.current = e.touches[0].clientX;
    setPaused(true);
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchX.current;
    touchX.current = null;
    setPaused(false);
    if (start == null) return;
    const dx = e.changedTouches[0].clientX - start;
    if (Math.abs(dx) > 44) (dx < 0 ? next : prev)();
  }

  return (
    <section
      className="reel full-bleed -mt-6 py-4"
      aria-roledescription="carousel"
      aria-label="إطلالات التخرّج"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="relative mx-auto h-[72svh] max-w-lg overflow-hidden rounded-2xl shadow-[var(--shadow-float)] ring-1 ring-white/10">
        {slides.map((s, i) => {
          const on = i === active;
          return (
            <div
              key={s.src}
              aria-hidden={!on}
              className={`absolute inset-0 transition-opacity duration-[900ms] ease-out ${
                on ? "z-10 opacity-100" : "z-0 opacity-0"
              }`}
            >
              <Image
                src={s.src}
                alt={s.title}
                fill
                priority={i === 0}
                sizes="(max-width: 512px) 100vw, 512px"
                className={`object-cover ${on ? "animate-kenburns" : ""}`}
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-black/30"
              />
            </div>
          );
        })}

        {/* Autoplay progress */}
        <div aria-hidden className="absolute inset-x-0 top-0 z-20 h-[3px] bg-white/10">
          <div
            key={`${active}-${stopped}`}
            className="bg-brand-gradient h-full origin-right"
            style={{
              animation: stopped ? "none" : `slide-progress ${INTERVAL}ms linear forwards`,
              transform: stopped ? "scaleX(1)" : undefined,
            }}
          />
        </div>

        {/* Play / pause — explicit control for autoplay (WCAG 2.2.2) */}
        <button
          type="button"
          onClick={() => setUserPaused((v) => !v)}
          aria-label={userPaused ? "تشغيل العرض التلقائي" : "إيقاف العرض التلقائي"}
          className="absolute start-3 top-3 z-30 grid h-9 w-9 place-items-center rounded-full bg-black/35 text-white ring-1 ring-white/25 backdrop-blur-sm transition-colors hover:bg-black/55"
        >
          {userPaused ? (
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : (
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
            </svg>
          )}
        </button>

        <span className="absolute end-4 top-4 z-20 font-display text-xs font-bold tracking-widest text-white/70 tabular-nums">
          {String(active + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
        </span>

        {/* Caption — re-mounts per slide to replay its entrance */}
        <div
          key={active}
          aria-live="polite"
          className="animate-step-in absolute inset-x-0 bottom-0 z-20 p-6 sm:p-8"
        >
          <p
            className="text-xs font-bold tracking-wide"
            style={{ color: slides[active].accent }}
          >
            {slides[active].kicker}
          </p>
          <h2 className="mt-2 max-w-[15ch] font-display text-[clamp(1.7rem,7vw,2.4rem)] font-bold leading-[1.12] text-white">
            {slides[active].title}
          </h2>
          <p className="mt-2.5 max-w-[34ch] text-sm leading-relaxed text-white/80">
            {slides[active].caption}
          </p>
          {slides[active].cta && (
            <Link
              href={slides[active].cta!.href}
              className="btn-shine mt-5 inline-flex min-h-12 items-center gap-2 rounded-pill bg-white px-6 font-display text-sm font-bold text-ink shadow-[var(--shadow-pop)] transition-transform active:scale-95"
            >
              {slides[active].cta!.label}
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 6l-6 6 6 6" />
              </svg>
            </Link>
          )}
        </div>

        {/* Prev / next */}
        <button
          type="button"
          onClick={prev}
          aria-label="السابق"
          className="absolute end-3 top-1/2 z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/30 text-white ring-1 ring-white/25 backdrop-blur-sm transition-colors hover:bg-black/50"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 6l-6 6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={next}
          aria-label="التالي"
          className="absolute start-3 top-1/2 z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/30 text-white ring-1 ring-white/25 backdrop-blur-sm transition-colors hover:bg-black/50"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 6l6 6-6 6" />
          </svg>
        </button>

        {/* Dots — 44px hit area, small visual bar */}
        <div className="absolute inset-x-0 bottom-1 z-20 flex items-center justify-center">
          {slides.map((s, i) => (
            <button
              key={s.src}
              type="button"
              onClick={() => go(i)}
              aria-label={`الشريحة ${i + 1}`}
              aria-current={i === active}
              className="grid h-11 w-7 place-items-center"
            >
              <span
                className={`h-1.5 rounded-pill transition-all duration-300 ${
                  i === active ? "w-6 bg-white" : "w-1.5 bg-white/45"
                }`}
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
