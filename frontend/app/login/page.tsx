"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { OtpVerifyForm } from "@/components/auth/OtpVerifyForm";
import { login, loginVerifyOtp, resendLoginOtp, getApiErrorMessage } from "@/lib/auth-api";
import { setToken, setUser, safeRedirectTarget, repStudentLandingPath } from "@/lib/auth";
import type { User, UserRole } from "@/lib/types";

const ROLE_REDIRECT: Record<UserRole, string> = {
  admin: "/admin",
  staff: "/staff",
  wholesaler: "/wholesaler",
  retail: "/",
  worker: "/workshop",
  design_helper: "/design-support",
};

export default function LoginPage() {
  const router = useRouter();

  // step: "credentials" | "otp"
  // MUST start on "credentials". A verification pass on 2026-08-04 temporarily seeded
  // this as "otp" to screenshot that step and the change was left in — which makes the
  // phone/password form unreachable and locks every user out. Every gate (tsc, eslint,
  // next build) passed with it in place, because it is valid code. Only a browser walk
  // caught it.
  const [step, setStep] = useState<"credentials" | "otp">("credentials");

  // credentials step
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Submit failure for the credentials step. The backend answers a bad login with a message
  // but NO `field` (see auth-api.login — it throws a plain Error), so guessing which input to
  // pin it under would be a lie; it renders as one inline alert directly beneath the pair it
  // belongs to. A floating toast for the most common failure on the screen was the problem —
  // it appears away from the fields, and it is gone before a slow reader reaches it.
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  // Server-issued OTP challenge — handed back only once the password checked out, and the
  // only thing /auth/login-verify accepts. Resending rotates it, so keep it in state.
  const [challengeId, setChallengeId] = useState("");

  function finishLogin(token: string, user: User) {
    setToken(token);
    setUser(user);
    toast.success(`مرحباً ${user.name} 🎉`);
    const redirect =
      typeof window !== "undefined"
        ? safeRedirectTarget(new URLSearchParams(window.location.search).get("redirect"))
        : null;
    // An explicit ?redirect= still wins — the student asked for a specific page and
    // honouring that is unchanged behaviour. Only the DEFAULT landing changes, and only
    // for a rep-linked student who is still waiting on (or was rejected by) their rep;
    // see repStudentLandingPath for why the storefront is the wrong home for them.
    const repPath = repStudentLandingPath(user);
    router.replace(
      redirect && user.role === "retail"
        ? redirect
        : repPath ?? ROLE_REDIRECT[user.role]
    );
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    const eMap: Record<string, string> = {};
    if (!phone.trim()) eMap.phone = "رقم الهاتف مطلوب";
    if (!password) eMap.password = "كلمة المرور مطلوبة";
    setErrors(eMap);
    setFormError("");
    if (Object.keys(eMap).length > 0) return;

    setLoading(true);
    try {
      const res = await login(phone.trim(), password);
      // Trusted device → backend skipped the OTP and logged us straight in.
      if ("token" in res) {
        finishLogin(res.token, res.user);
        return;
      }
      setChallengeId(res.challengeId);
      setStep("otp");
    } catch (err) {
      setFormError(getApiErrorMessage(err, "بيانات الدخول غير صحيحة"));
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(code: string) {
    // loginVerifyOtp already throws Error with Arabic message on failure;
    // OtpVerifyForm catches it, shows it, clears digits, refocuses. It also stores the
    // returned device_token so this device skips the OTP next time.
    const { token, user } = await loginVerifyOtp(challengeId, code);
    finishLogin(token, user);
  }

  // The backend refreshes the code in place and hands back the same id; adopting it keeps
  // this correct regardless.
  async function resendOtp() {
    setChallengeId(await resendLoginOtp(challengeId));
  }

  const onOtp = step === "otp";

  // The way out of this screen. On the OTP step "back" means the previous STEP, which is what
  // the pane's own «تغيير الرقم» does — the header must agree with it, not fight it.
  //
  // On the credentials step it means the previous PAGE — and picking that destination is the
  // whole difficulty, because `router.back()` is wrong in BOTH directions here:
  //
  //   · Capacitor webview, opened by a deep link → the history is EMPTY and back() is a
  //     silent no-op. A back button that visibly does nothing is worse than none.
  //   · Browser tab opened straight onto /login → a WhatsApp link on Android opens a NEW
  //     TAB, whose first history entry is the new-tab page, so `history.length > 1` is true
  //     and back() walks the student OUT of the site. Measured on prod 2026-08-14 with
  //     exactly that guard in place; the tab landed on chrome://newtab.
  //
  // A same-origin referrer is the honest signal that there is a page of OURS to return to.
  // Everything else — external referrer, or none at all (webview, deep link, typed URL) —
  // goes to the storefront, which is where a student who reached /login this way came from
  // anyway. `replace`, not `push`, so the button can never build a loop back into itself.
  function goBack() {
    if (onOtp) {
      setStep("credentials");
      return;
    }
    const cameFromUs =
      typeof window !== "undefined" &&
      document.referrer.startsWith(`${window.location.origin}/`);
    if (cameFromUs && window.history.length > 1) router.back();
    else router.replace("/");
  }

  return (
    <AuthCard appChrome
      title={onOtp ? "رمز التحقق" : "تسجيل الدخول"}
      subtitle={onOtp ? undefined : "أدخل رقمك وكلمة المرور للمتابعة"}
      onBack={goBack}
      /*
        ⚠️ NO «فريق العمل؟» ENTRY HERE (owner, 2026-08-06). `TeamKeyEntry` used to sit in
        AuthCard's footer slot on this screen, which meant every STUDENT arriving at /login
        was shown a door to the staff / workshop / design-team key portals. Students are the
        overwhelming majority of who reaches this page, and none of them belong to any of
        those three groups — a login screen should not advertise a staff entrance to
        customers.

        ⚠️ CONSEQUENCE, DO NOT REDISCOVER IT THE HARD WAY: the native shells are Capacitor
        webviews with NO ADDRESS BAR, and that box was the ONLY way those three groups could
        reach /s/<key>, /w/<key> and /d/<key> from inside the installed app. They must now
        open the secret link in a phone BROWSER instead. The portals themselves are
        untouched and still work; only this entrance is gone. If staff-in-app login is ever
        needed again, put the entry somewhere students never land — not on /login.
      */
    >
      {/*
        Step transition. Both panes sit in the SAME grid cell for the whole life of the
        screen — `position` is never touched and only `transform`/`opacity` ever change, so
        no frame of the animation reflows. The old version toggled `position` between
        absolute and relative mid-transition and animated a 120% slide, which reflows the
        document on every frame and stutters on low-end Android.

        Grid stacking (rather than absolute panes) is what keeps the height honest: the cell
        is as tall as the taller pane, which is the credentials one on both steps, so the
        container height does NOT move when the OTP form mounts — and on a short screen the
        PAGE scrolls instead of the pane becoming its own little scroll box with the submit
        button clipped inside it.
      */}
      <div className="grid flex-1 overflow-hidden">
        {/* Step 1 — credentials. Exits toward the right, which is "backwards" in RTL. */}
        <div
          className="col-start-1 row-start-1 flex flex-col transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none"
          style={{
            transform: onOtp ? "translateX(24%)" : "translateX(0)",
            opacity: onOtp ? 0 : 1,
            willChange: "transform, opacity",
            pointerEvents: onOtp ? "none" : undefined,
          }}
          inert={onOtp}
        >
          <form onSubmit={handleCredentials} className="flex flex-1 flex-col">
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="phone-v2" className="text-sm font-medium text-ink">رقم الهاتف</label>
                <div className="flex items-stretch gap-2" dir="ltr">
                  <span
                    id="phone-country"
                    aria-label="رمز الدولة العراق"
                    className="inline-flex select-none items-center rounded-xl border border-line bg-beige px-3 text-sm font-semibold text-ink"
                  >+964</span>
                  {/* text-base — under 16px iOS Safari zooms the page on focus. */}
                  <input
                    id="phone-v2"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value.replace(/\D/g, ""));
                      if (formError) setFormError("");
                    }}
                    placeholder="7XX XXX XXXX"
                    aria-invalid={!!errors.phone}
                    aria-describedby={`phone-country${errors.phone ? " phone-error" : ""}`}
                    className={[
                      "min-h-12 min-w-0 flex-1 rounded-xl border bg-beige px-3.5 py-2.5 text-base text-ink shadow-[var(--shadow-soft)] outline-none transition-colors placeholder:text-ink/55",
                      "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                      errors.phone ? "border-danger" : "border-line",
                    ].join(" ")}
                  />
                </div>
                {errors.phone && <p id="phone-error" className="text-sm font-medium text-danger" role="alert">{errors.phone}</p>}
              </div>
              <Input
                label="كلمة المرور"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (formError) setFormError("");
                }}
                error={errors.password}
                autoComplete="current-password"
              />

              {/* Inline, under the pair it refers to — not a toast that floats away. */}
              {formError && (
                <p
                  role="alert"
                  className="rounded-xl border border-danger/25 bg-danger/5 px-3.5 py-2.5 text-sm font-medium text-danger"
                >
                  {formError}
                </p>
              )}

              <p className="text-sm">
                <Link href="/forgot-password" className="inline-flex min-h-11 items-center font-medium text-orange-ink underline-offset-4 hover:underline">
                  نسيت كلمة المرور؟
                </Link>
              </p>
            </div>

            {/* Primary action anchored at the bottom of the screen — `mt-auto` against the
                full-height column, so the thumb finds it in the same place every time. */}
            <div className="mt-auto space-y-4 pt-8">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-pill bg-orange-ink px-4 text-base font-semibold text-white shadow-[var(--shadow-soft)] transition-[background-color,transform] duration-200 ease-out hover:bg-ink active:translate-y-px disabled:opacity-50 disabled:hover:bg-orange-ink"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>جارٍ التحقق…</span>
                  </>
                ) : (
                  "دخول"
                )}
              </button>
              <p className="text-center text-sm text-ink-soft">
                ليس لديك حساب؟{" "}
                <Link href="/register" className="inline-flex min-h-11 items-center px-1 font-medium text-orange-ink underline-offset-4 hover:underline">
                  أنشئ حساباً
                </Link>
              </p>
              {/*
                Recovery path for a student whose rep link is buried in WhatsApp. This one DOES
                belong on /login — unlike the deleted «فريق العمل؟» box above, its audience is
                students, who are the overwhelming majority of who reaches this screen.
                /join (no code) only maps جامعة+قسم → referral code; approval is unchanged.
              */}
              <p className="text-center text-sm text-ink-soft">
                طالب مع ممثل جامعتك؟{" "}
                <Link href="/join" className="inline-flex min-h-11 items-center px-1 font-medium text-orange-ink underline-offset-4 hover:underline">
                  ادخل مع ممثلك
                </Link>
              </p>
            </div>
          </form>
        </div>

        {/* Step 2 — OTP. Waits on the left and comes forward, the RTL push direction.
            Mounted only on entry so its countdown and autofocus don't fire on step 1. */}
        <div
          className="col-start-1 row-start-1 flex flex-col transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none"
          style={{
            transform: onOtp ? "translateX(0)" : "translateX(-24%)",
            opacity: onOtp ? 1 : 0,
            willChange: "transform, opacity",
            pointerEvents: onOtp ? undefined : "none",
          }}
          inert={!onOtp}
        >
          {onOtp && (
            <OtpVerifyForm
              phone={phone}
              onVerify={verifyOtp}
              onResend={resendOtp}
              onBack={() => setStep("credentials")}
              submitLabel="تحقق ودخول"
              backLabel="← تغيير الرقم"
            />
          )}
        </div>
      </div>
    </AuthCard>
  );
}
