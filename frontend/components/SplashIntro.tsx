"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { GradCapLoader } from "@/components/ui/GradCapLoader";

const SPLASH_KEY = "loloshop_splash_seen";
const DISPLAY_MS = 2200;
const FADE_MS = 500;

export function SplashIntro() {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("gone");

  function skip() {
    setPhase("out");
    setTimeout(() => setPhase("gone"), FADE_MS);
  }

  useEffect(() => {
    if (sessionStorage.getItem(SPLASH_KEY)) return;
    // Respect reduced motion — skip the splash entirely (no forced wait).
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      sessionStorage.setItem(SPLASH_KEY, "1");
      return;
    }
    sessionStorage.setItem(SPLASH_KEY, "1");

    setPhase("in");

    const fadeTimer = setTimeout(() => setPhase("out"), DISPLAY_MS);
    const hideTimer = setTimeout(() => setPhase("gone"), DISPLAY_MS + FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (phase === "gone") return null;

  const exiting = phase === "out";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="تخطّي المقدّمة"
      onClick={skip}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Escape") skip();
      }}
      className="fixed inset-0 z-[60] overflow-hidden"
      style={{ cursor: "default" }}
    >
      {/* ── Cinematic WARM CREAM stage (brand-light, never dark) ── */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 72% 0%,   rgba(255,177,0,0.16)  0%, transparent 55%)," +
            "radial-gradient(110% 80% at 12% 100%,  rgba(255,218,185,0.45) 0%, transparent 55%)," +
            "linear-gradient(160deg, #FFF8F0 0%, #FAEBD7 60%, #FAF4EA 100%)",
        }}
      />

      {/* Slow ambient glow — top-right amber */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-20 end-0 h-96 w-96 rounded-full blur-[80px] animate-splash2-glow-pulse"
        style={{ background: "rgba(255,177,0,0.28)" }}
      />
      {/* Slow ambient glow — bottom-left peach */}
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-20 start-0 h-80 w-80 rounded-full blur-[70px] animate-splash2-glow-pulse"
        style={{ background: "rgba(255,218,185,0.55)", animationDelay: "1.1s" }}
      />

      {/* ── Central composition ── */}
      <div className="relative flex h-full flex-col items-center justify-center gap-0 px-6">

        {/* GradCap — drops in from above */}
        <GradCapLoader
          size={52}
          className="animate-splash2-cap-drop mb-3 drop-shadow-lg"
        />

        {/* Logo + concentric bloom rings */}
        <div className="relative grid place-items-center">
          {/* Bloom halo — largest, slowest */}
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-full animate-splash2-halo-bloom"
            style={{
              width: "220px",
              height: "220px",
              background:
                "radial-gradient(circle, rgba(255,177,0,0.40) 0%, rgba(244,123,66,0.15) 55%, transparent 75%)",
            }}
          />
          {/* Crisp accent ring — expands + vanishes */}
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-full border border-[rgba(255,177,0,0.55)] animate-splash2-ring-expand"
            style={{ width: "178px", height: "178px" }}
          />
          {/* Second ring, delayed */}
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-full border border-[rgba(244,123,66,0.35)] animate-splash2-ring-expand"
            style={{ width: "145px", height: "145px", animationDelay: "0.18s" }}
          />

          {/* Logo image. Was `priority`, which is deprecated and inert in Next 16 —
              so the splash screen's own logo was lazy-loading. */}
          <Image
            src="/logo.png"
            alt="لولو شوب"
            width={168}
            height={168}
            loading="eager"
            fetchPriority="high"
            className="relative h-36 w-36 object-contain drop-shadow-2xl animate-splash2-logo-rise"
            style={{ filter: "drop-shadow(0 0 18px rgba(255,177,0,0.35))" }}
          />
        </div>

        {/* ── Script wordmark: "lolo shop  96" ── */}
        {/* The clip-path reveal sweeps from left→right (RTL page, so end→start visually) */}
        <div
          className="mt-5 flex items-baseline gap-3 overflow-hidden"
          aria-hidden
        >
          <span
            className="font-script text-4xl leading-none animate-splash2-word-draw"
            style={{
              color: "#F47B42",
              textShadow: "0 1px 2px rgba(244,123,66,0.28)",
              display: "inline-block",
            }}
          >
            lolo shop
          </span>
          <span
            className="font-display text-xl font-semibold animate-splash2-tag-rise-1"
            style={{
              color: "rgba(244,123,66,0.85)",
              letterSpacing: "0.04em",
            }}
          >
            96
          </span>
        </div>

        {/* ── Arabic tagline — two words stagger in ── */}
        <div className="mt-8 flex flex-col items-center gap-1 text-center" dir="rtl">
          {/* Line 1 */}
          <p
            className="font-display-ar text-lg font-semibold leading-snug animate-splash2-tag-rise-1"
            style={{ color: "#1A1A1A" }}
          >
            أوّل متجر إلكتروني
          </p>
          {/* Line 2 — slightly delayed */}
          <p
            className="font-display-ar text-lg font-semibold leading-snug animate-splash2-tag-rise-2"
            style={{ color: "rgba(26,26,26,0.66)" }}
          >
            لتصميم روبات التخرّج
          </p>
        </div>

        {/* Accent rule — grows from centre outward */}
        <span
          aria-hidden
          className="mt-6 block h-px w-20 animate-splash2-rule-grow"
          style={{
            background: "linear-gradient(90deg, rgba(244,123,66,0.15), rgba(255,177,0,0.8), rgba(244,123,66,0.15))",
          }}
        />

        {/* Skip hint */}
        <span
          className="absolute bottom-8 text-xs font-medium animate-splash2-tag-rise-2"
          style={{ color: "rgba(26,26,26,0.4)", animationDelay: "1.6s" }}
        >
          اضغط للتخطّي
        </span>
      </div>

      {/* ── Curtain exit: two cream panels split apart, revealing the home ──
           Rendered only during the exit phase so they never block content.
           Same warm-cream tone as the stage bg → seamless then slide away. */}
      {exiting && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1/2 animate-splash2-curtain-top-out"
            style={{
              background: "linear-gradient(160deg, #FFF8F0 0%, #FAEBD7 60%, #FAF4EA 100%)",
              willChange: "transform",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 animate-splash2-curtain-bot-out"
            style={{
              background: "linear-gradient(340deg, #FFF8F0 0%, #FAEBD7 60%, #FAF4EA 100%)",
              willChange: "transform",
            }}
          />
        </>
      )}
    </div>
  );
}
