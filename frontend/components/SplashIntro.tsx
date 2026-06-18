"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { GradCapLoader } from "@/components/ui/GradCapLoader";

const SPLASH_KEY = "loloshop_splash_seen";
const DISPLAY_MS = 2200;
const FADE_MS = 500;

export function SplashIntro() {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("gone");

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

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="تخطّي المقدّمة"
      onClick={() => setPhase("gone")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Escape") setPhase("gone");
      }}
      className={`bg-warm-veil fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden ${
        phase === "out" ? "animate-splash-out" : ""
      }`}
    >
      {/* Ambient brand glows */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-24 end-0 h-72 w-72 rounded-full bg-orange-light/30 blur-3xl"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-28 start-0 h-72 w-72 rounded-full bg-blush/40 blur-3xl"
      />

      {/* Animated graduation cap crowning the logo */}
      <GradCapLoader size={72} className="animate-splash-logo mb-1 drop-shadow-lg" />

      {/* Logo with halo + pulsing brand ring */}
      <div className="relative grid place-items-center">
        <span
          aria-hidden
          className="animate-splash-ring absolute h-60 w-60 rounded-full bg-brand-gradient opacity-[0.16] blur-2xl"
        />
        <span
          aria-hidden
          className="animate-splash-ring absolute h-52 w-52 rounded-full ring-2 ring-orange/20"
          style={{ animationDelay: "0.2s" }}
        />
        <Image
          src="/logo.png"
          alt="لولو شوب"
          width={208}
          height={208}
          priority
          className="animate-splash-logo relative h-44 w-44 object-contain drop-shadow-2xl"
        />
      </div>

      {/* Requested tagline */}
      <h1 className="animate-splash-text mt-9 max-w-[18ch] px-6 text-center font-display text-2xl font-bold leading-[1.5] text-ink">
        أوّل متجر إلكتروني لتصميم روبات التخرّج
      </h1>

      {/* Brand accent rule */}
      <span
        aria-hidden
        className="animate-splash-sub mt-6 h-1 w-16 rounded-pill bg-brand-gradient"
      />

      <span className="animate-splash-sub absolute bottom-8 text-xs font-medium text-[var(--shop-muted)]">
        اضغط للتخطّي
      </span>
    </div>
  );
}
