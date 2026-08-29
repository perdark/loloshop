"use client";

/**
 * «الإشعارات» for a phone with NO ACCOUNT (migration 095).
 *
 * ⚠️ THIS IS A STORE REQUIREMENT, NOT A CONVENIENCE — the same one NotificationPrefs.tsx
 * satisfies for signed-in students. Apple's guideline 4.5.4 allows promotional push only when
 * the user opted in through consent language in the app AND can opt out from inside the app.
 * Since migration 095 a handset can be a push recipient with no account behind it, so the
 * opt-out has to exist for someone who cannot reach the account screen because they have none.
 * Delete this and every anonymous promotional send loses its legal footing.
 *
 * ⚠️ IT IS NOT A SECOND COPY OF NotificationPrefs AND MUST NOT BE MERGED WITH IT. That one
 * belongs to a PERSON — stored on `users.notification_prefs` (089), so it follows them onto
 * their next phone. This belongs to a HANDSET — stored on `device_tokens.marketing_opt_in`
 * (095), because there is no person to hang it on. The server applies exactly one of the two
 * per recipient, decided by whether the device row has an owner.
 *
 * It renders NOTHING when there is no device row to talk about: a browser, a shell that never
 * granted permission, or a phone whose token we have not seen. A switch that saves nowhere is
 * worse than no switch.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { getDeviceMarketing, setDeviceMarketing } from "@/lib/notifications";
import { getStoredPushToken, setMarketingConsent } from "@/lib/push";
import { nativeShellPlatform } from "@/lib/native-shell";

export function DeviceNotificationPrefs() {
  const [token, setToken] = useState<string | null>(null);
  const [marketing, setMarketing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // Only inside a shell: a browser tab has no device token and never will.
    if (!nativeShellPlatform()) {
      setLoading(false);
      return;
    }
    const stored = getStoredPushToken();
    if (!stored) {
      setLoading(false);
      return;
    }
    setToken(stored);
    setMarketing(await getDeviceMarketing(stored));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(next: boolean) {
    if (!token) return;
    const previous = marketing;
    // Optimistic: a switch that waits for a slow Iraqi connection before moving feels broken.
    setMarketing(next);
    setBusy(true);
    try {
      setMarketing(await setDeviceMarketing(token, next));
      // ⚠️ THE LOCAL CONSENT CACHE HAS TO MOVE WITH THE SWITCH. `registerPushToken` re-asserts
      // the cached consent on every launch and the server can only ever RAISE the flag from a
      // registration, so leaving a stale `true` here would quietly undo this opt-out the next
      // time the app opened.
      setMarketingConsent(next);
    } catch (err) {
      setMarketing(previous);
      toast.error(getApiErrorMessage(err, "تعذر حفظ الإعداد"));
    } finally {
      setBusy(false);
    }
  }

  if (loading || marketing === null) return null;

  return (
    <section dir="rtl" lang="ar" className="mt-8">
      <h2 className="mb-1 font-display text-lg font-bold text-ink">الإشعارات</h2>
      <p className="mb-3 text-xs leading-relaxed text-ink/50">
        هذا الإعداد يخص هذا التلفون. إذا سجّلت دخولك، تنتقل إعداداتك لحسابك.
      </p>

      <label className="flex min-h-[56px] cursor-pointer items-start gap-3 rounded-2xl border border-ink/10 bg-white/60 px-4 py-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-orange-ink)]"
          checked={marketing}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">العروض والأخبار</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-ink/50">
            خصومات ومنتجات جديدة من لولو شوب. تكدر تطفّيه بأي وقت.
          </span>
        </span>
      </label>
    </section>
  );
}
