"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { getPromo, type PromoConfig } from "@/lib/catalog";

const SEEN_KEY = "loloshop_discount_popup_seen";
const SPLASH_KEY = "loloshop_splash_seen";

interface TimeLeft {
  days: number;
  hours: number;
  mins: number;
  secs: number;
}

function calcTimeLeft(deadline: Date): TimeLeft | null {
  const diff = deadline.getTime() - Date.now();
  if (diff <= 0) return null;
  return {
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
    mins: Math.floor((diff % 3_600_000) / 60_000),
    secs: Math.floor((diff % 60_000) / 1_000),
  };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="min-w-[2.75rem] rounded-xl bg-orange/15 px-2.5 py-1.5 text-center font-display text-2xl font-bold tabular-nums text-orange-ink">
        {pad(value)}
      </span>
      <span className="text-[10px] font-medium text-ink/60">{label}</span>
    </div>
  );
}

export function DiscountPopup() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<PromoConfig | null>(null);
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // SSR guard
    if (typeof window === "undefined") return;
    // Already seen this session — bail before fetching
    if (sessionStorage.getItem(SEEN_KEY)) return;

    getPromo()
      .then((config) => {
        // Must be active
        if (!config.active) return;
        // Deadline must not have passed (if set)
        if (config.deadline && Date.now() >= new Date(config.deadline).getTime()) return;

        setCfg(config);

        // Decide delay: wait for splash if it hasn't fired yet
        const splashDone = Boolean(sessionStorage.getItem(SPLASH_KEY));
        const delay = splashDone ? 600 : 2800;

        timerRef.current = setTimeout(() => {
          // Double-check the session flag (in case another tab set it)
          if (sessionStorage.getItem(SEEN_KEY)) return;
          sessionStorage.setItem(SEEN_KEY, "1");

          if (config.deadline) {
            setTimeLeft(calcTimeLeft(new Date(config.deadline)));
          }
          setOpen(true);
        }, delay);
      })
      .catch(() => {
        /* network error — render nothing */
      });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Live countdown while open (only when a deadline is set)
  useEffect(() => {
    if (!open || !cfg?.deadline) return;
    const deadline = new Date(cfg.deadline);

    intervalRef.current = setInterval(() => {
      const next = calcTimeLeft(deadline);
      setTimeLeft(next);
      if (!next) setOpen(false);
    }, 1_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [open, cfg]);

  function handleClose() {
    setOpen(false);
  }

  function handleShop() {
    setOpen(false);
    setTimeout(() => {
      document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" });
    }, 150);
  }

  if (!open || !cfg) return null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={cfg.title_ar}
      footer={
        <>
          <Button variant="primary" fullWidth onClick={handleShop}>
            تسوّق الآن
          </Button>
          <Button variant="ghost" fullWidth onClick={handleClose}>
            لاحقاً
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-5 py-1 text-center">
        {/* Warm decorative band */}
        <div className="w-full rounded-2xl bg-gradient-to-l from-orange/20 to-blush/30 px-4 py-3">
          <p className="font-display text-base font-semibold leading-snug text-ink">
            {cfg.message_ar}
          </p>
        </div>

        {/* Live countdown — only when deadline is set */}
        {cfg.deadline && (
          timeLeft ? (
            <div className="flex items-end gap-3" dir="rtl" aria-live="polite" aria-atomic="true">
              <CountdownUnit value={timeLeft.days} label="يوم" />
              <span className="mb-3 text-xl font-bold text-orange-ink/50">:</span>
              <CountdownUnit value={timeLeft.hours} label="ساعة" />
              <span className="mb-3 text-xl font-bold text-orange-ink/50">:</span>
              <CountdownUnit value={timeLeft.mins} label="دقيقة" />
              <span className="mb-3 text-xl font-bold text-orange-ink/50">:</span>
              <CountdownUnit value={timeLeft.secs} label="ثانية" />
            </div>
          ) : (
            <p className="text-sm font-semibold text-danger">انتهت العروض</p>
          )
        )}
      </div>
    </Modal>
  );
}
