"use client";

/**
 * «خلي الإشعارات مفتوحة» — the in-app ask for notification permission, on BOTH platforms.
 *
 * Renders nothing in a browser. Inside the Android or iOS shell it shows a card — the same
 * shape as the «الخصومات» popup — the first time the app is opened, and again on every
 * subsequent open until permission is actually granted. Once granted it never appears again.
 *
 * ── WHY A PRE-PROMPT AND NOT THE OS SHEET DIRECTLY ────────────────────────────────────────
 * ⚠️ iOS SHOWS ITS PERMISSION SHEET EXACTLY ONCE PER INSTALL. A «رفض» there is permanent from
 * the app's side — `requestPermissions()` resolves 'denied' instantly ever after, with no
 * dialog — and the only cure is a trip through the system Settings that nobody makes. Android
 * 13+ behaves the same way after two refusals. So the OS sheet is a single, unrepeatable
 * request and it must never be spent on a student who is not looking at a reason. This card is
 * the reason: it explains what the notifications are for in Arabic, and the OS sheet only
 * opens after the student taps «فعّل الإشعارات». A tap on «مو هسه» costs nothing — the OS was
 * never asked, so the ask survives to the next open.
 *
 * ⚠️ WHICH IS ALSO WHY THIS COMPONENT OWNS THE ASK AND `PushRegistrar` NO LONGER DOES.
 * PushRegistrar used to call `requestPermissions()` itself right after login. Two independent
 * callers of a one-shot sheet is exactly how it gets burned silently; PushRegistrar now only
 * registers a device when permission is ALREADY granted, and listens for
 * `PUSH_PERMISSION_CHANGED_EVENT` from here.
 *
 * ── WHAT "EVERY TIME THE APP OPENS" MEANS, AND WHY IT IS NOT NAGGING ──────────────────────
 * Owner instruction (2026-08-29): ask on first open, and keep asking on every open until the
 * student accepts — but never more than that. So the card is shown at most once per app open,
 * and an "open" is:
 *   · a cold launch — `sessionStorage` dies with the app, so the flag is gone, and
 *   · a return to the foreground after `OPEN_GAP_MS`, which is the same 30-minute session
 *     window `AppBeacon`/`lib/appPresence.js` already use to decide what counts as an open.
 * Alt-tabbing to WhatsApp and back does NOT re-ask. Nothing re-opens the card while the app
 * stays in use.
 *
 * ⚠️ IT NEVER STACKS ON ANOTHER DIALOG. It waits for the splash, then for any open
 * `[role="dialog"]` (the discount popup, a checkout sheet) to close, and it refuses to appear
 * at all while the blocking update gate is up — being asked about notifications by an app that
 * has just told you it is unusable is noise.
 *
 * ── THE CARD IS ALSO THE MARKETING CONSENT, AND THAT IS WHY ITS WORDING IS NOT DECORATION ──
 * ⚠️ Apple's guideline 4.5.4 permits promotional push only when the user opted in through
 * CONSENT LANGUAGE DISPLAYED IN THE APP'S UI, and can opt out from inside the app. The OS sheet
 * carries no such language, so it can never be that opt-in. This card is: it names offers and
 * discounts explicitly beside the order updates, and «فعّل الإشعارات» is the tap that consents
 * to both. Changing that copy to stop mentioning العروض silently invalidates every consent
 * collected afterwards — the wording IS the legal artefact.
 * The opt-out is «العروض والأخبار» in NotificationPrefs.tsx for an account (089) and
 * DeviceNotificationPrefs.tsx for a handset with none (095); both default OFF, and consent is
 * only ever recorded from a tap here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { AUTH_CHANGED_EVENT } from "@/lib/auth";
import { PUSH_PERMISSION_CHANGED_EVENT, setMarketingConsent } from "@/lib/push";
import { nativeShellPlatform, type NativePlatform } from "@/lib/native-shell";

/** Set for as long as the card has already been shown/answered in this app open. */
const SHOWN_KEY = "loloshop_push_prompt_shown";
/** When it was last shown, so a long absence counts as a new open. */
const SHOWN_AT_KEY = "loloshop_push_prompt_at";
/** Written by SplashIntro. Same key, deliberately — see DiscountPopup, which reads it too. */
const SPLASH_KEY = "loloshop_splash_seen";

/** Matches AppBeacon's session window: a return after this long is a new open, not a tab switch. */
const OPEN_GAP_MS = 30 * 60 * 1000;

/** Let the splash finish, and let a first paint settle, before anything is asked. */
const DELAY_AFTER_SPLASH_MS = 900;
const DELAY_WITH_SPLASH_MS = 3200;

/** How long to keep waiting for another dialog to close before giving up until the next open. */
const DIALOG_WAIT_STEP_MS = 1500;
const DIALOG_WAIT_TRIES = 12;

type Stage =
  /** The OS can still be asked — the button opens the real sheet. */
  | "ask"
  /** The OS will not ask again. Only the system Settings can fix it, so we say how. */
  | "settings";

function readFlag(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    // Private mode: no memory of having asked, so the card simply shows once per mount.
    return null;
  }
}

function writeFlag(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* nothing to remember it with — it will ask again, which is acceptable */
  }
}

function clearFlag(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** True while the blocking update gate — or any other dialog — owns the screen. */
function screenIsBusy(): boolean {
  if (document.querySelector("[data-lolo-blocking-gate]")) return true;
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
}

/** Settings directions differ per platform, and a wrong path is worse than none. */
function settingsHint(platform: NativePlatform): string {
  return platform === "ios"
    ? "افتح: الإعدادات ← الإشعارات ← lolo shop ← فعّل «السماح بالإشعارات»."
    : "افتح: الإعدادات ← التطبيقات ← lolo shop ← الإشعارات ← فعّلها.";
}

export function NotificationPermissionPrompt() {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("ask");
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState<NativePlatform | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Guards a second evaluation from racing the first (auth change + visibility change can
  // arrive together on a cold sign-in).
  const evaluating = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    setBusy(false);
  }, []);

  useEffect(() => {
    const shell = nativeShellPlatform();
    if (!shell) return; // browser — the web has its own bell, and no OS permission to ask for
    setPlatform(shell);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    /** Resolve once nothing else is on screen, or give up for this open. */
    const whenScreenIsFree = (run: () => void, triesLeft = DIALOG_WAIT_TRIES) => {
      if (cancelled) return;
      if (!screenIsBusy()) {
        run();
        return;
      }
      if (triesLeft <= 0) return; // a long-lived dialog: ask on the next open instead
      timer = setTimeout(() => whenScreenIsFree(run, triesLeft - 1), DIALOG_WAIT_STEP_MS);
    };

    /**
     * @param force ignore the "already asked this open" flag — used when the student has just
     * signed in, which is the strongest moment there is, but ONLY while the OS can still be
     * asked. A refused permission is never re-surfaced mid-session.
     */
    const evaluate = async (force = false) => {
      if (cancelled || evaluating.current) return;
      evaluating.current = true;
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const current = await PushNotifications.checkPermissions();
        if (cancelled) return;

        if (current.receive === "granted") {
          // Nothing to ask, and nothing to ask again later either.
          setOpen(false);
          writeFlag(SHOWN_KEY, "1");
          return;
        }

        const alreadyAsked = Boolean(readFlag(SHOWN_KEY));
        const canStillAskOs = current.receive !== "denied";
        if (alreadyAsked && !(force && canStillAskOs)) return;

        setStage(canStillAskOs ? "ask" : "settings");

        const splashDone = Boolean(readFlag(SPLASH_KEY));
        const delay = splashDone ? DELAY_AFTER_SPLASH_MS : DELAY_WITH_SPLASH_MS;
        timer = setTimeout(() => {
          whenScreenIsFree(() => {
            writeFlag(SHOWN_KEY, "1");
            writeFlag(SHOWN_AT_KEY, String(Date.now()));
            setOpen(true);
          });
        }, delay);
      } catch {
        // The plugin is missing from this binary (a shell built before `npx cap sync`), or the
        // bridge cannot answer. Notifications simply stay in-app; never show a card we cannot
        // act on.
      } finally {
        evaluating.current = false;
      }
    };

    void evaluate();

    /** A foreground return after the session gap is a new app open — ask again. */
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const at = Number(readFlag(SHOWN_AT_KEY) ?? 0);
      if (at && Date.now() - at < OPEN_GAP_MS) return;
      clearFlag(SHOWN_KEY);
      void evaluate();
    };

    const onAuthChanged = () => void evaluate(true);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    };
  }, []);

  /** The one place in the app that opens the OS permission sheet. */
  const enable = async () => {
    setBusy(true);
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const asked = await PushNotifications.requestPermissions();
      if (asked.receive === "granted") {
        // ⚠️ RECORDED BEFORE THE EVENT, NOT AFTER. PushRegistrar reads this flag inside the
        // 'registration' listener the event is about to trigger; setting it afterwards is a
        // race that loses the consent on the first registration and quietly waits for the next
        // app launch to send it.
        setMarketingConsent(true);
        // PushRegistrar is listening: it calls register(), which is what turns a granted
        // permission into a row in `device_tokens` — with or without an account behind it.
        window.dispatchEvent(new Event(PUSH_PERMISSION_CHANGED_EVENT));
        close();
        return;
      }
      // 'denied' — the sheet is spent. Say what actually fixes it instead of leaving a button
      // that can never work again.
      setStage("settings");
      setBusy(false);
    } catch {
      setStage("settings");
      setBusy(false);
    }
  };

  if (!open || !mounted || !platform) return null;

  return createPortal(
    <div
      dir="rtl"
      lang="ar"
      // Bottom sheet on phones (the whole audience), centred from `sm:` up — matching ui/Modal
      // so the two never look like different apps. z-50 is BELOW the update gate's z-[100].
      className="animate-fade-page-in fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm sm:items-center"
      role="presentation"
      // Tapping the dim area is a «مو هسه»: it dismisses for this open and never touches the
      // OS, so the ask survives.
      onClick={close}
    >
      <div
        className="animate-auth-card-in flex w-full max-w-md flex-col gap-4 overflow-hidden rounded-3xl bg-cream p-6 text-center shadow-[var(--shadow-pop)] ring-1 ring-line"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lolo-push-prompt-title"
      >
        <span
          aria-hidden
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-orange/15 text-orange-ink"
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
        </span>

        <h2
          id="lolo-push-prompt-title"
          className="font-display-ar text-2xl font-bold leading-tight text-ink"
        >
          خلي الإشعارات مفتوحة
        </h2>

        <div className="rounded-2xl bg-gradient-to-l from-orange/20 to-blush/30 px-4 py-3">
          {/* ⚠️ THIS IS THE 4.5.4 CONSENT LANGUAGE — see the header. It has to name the
              promotional half out loud, in Arabic, next to the transactional half, because
              «فعّل الإشعارات» below is the opt-in to BOTH. Do not trim it to just the order
              updates. */}
          <p className="text-sm font-semibold leading-relaxed text-ink">
            يوصلك خبر طلبك — وقت يتوافق عليه ممثلك، ووقت يصير جاهز، وقبل ما يخلص الموعد
            النهائي — وتوصلك عروض وخصومات لولو شوب أول ما تنزل.
          </p>
        </div>

        {stage === "settings" ? (
          <>
            <p className="text-sm leading-relaxed text-ink/70">
              الإشعارات مقفولة من إعدادات الجهاز. {settingsHint(platform)}
            </p>
            <Button variant="primary" fullWidth onClick={close}>
              تمام
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" fullWidth loading={busy} onClick={() => void enable()}>
              فعّل الإشعارات
            </Button>
            <Button variant="ghost" fullWidth onClick={close}>
              مو هسه
            </Button>
            {/* The opt-out has to be findable from the moment consent is given, not only
                afterwards — 4.5.4 asks for a way out from inside the app, and «حسابي» is where
                it lives for both an account and a handset without one. */}
            <p className="text-xs leading-relaxed text-ink/55">
              تكدر توقف العروض بأي وقت من «حسابي ← الإشعارات».
            </p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
