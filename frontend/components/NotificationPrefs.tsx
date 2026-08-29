"use client";

/**
 * «الإشعارات» — the student's own control over what reaches their phone.
 *
 * ⚠️ THIS IS A STORE REQUIREMENT, NOT A SETTINGS-SCREEN NICETY. Apple's review guideline 4.5.4
 * allows promotional push only when the user opted in through consent language in the app AND
 * can opt out from inside the app; Play takes the same line on unsolicited notifications. The
 * admin composer (lib/pushBroadcast.js) is the first thing in this system that can send an
 * offer, and this component is the other half of what makes that legal.
 *
 * ⚠️ THE TWO TOGGLES ARE NOT THE SAME KIND OF THING and are deliberately worded differently.
 * «تحديثات الطلب» is why a student installed the app — it defaults ON, and turning it off is
 * their explicit act. «العروض» defaults OFF for everyone, including all 1,100+ accounts that
 * existed before it: consent cannot be inherited from a database default.
 *
 * Turning a switch off does NOT unregister the device. The other category must keep working,
 * and the in-app bell keeps everything either way — so nothing is ever lost, it just stops
 * buzzing.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { setMarketingConsent } from "@/lib/push";
import {
  getNotificationPrefs,
  updateNotificationPrefs,
  type NotificationPrefs as Prefs,
} from "@/lib/notifications";

function Toggle({
  on,
  busy,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex min-h-[56px] cursor-pointer items-start gap-3 rounded-2xl border border-ink/10 bg-white/60 px-4 py-3">
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-orange-ink)]"
        checked={on}
        disabled={busy}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink/50">{hint}</span>
      </span>
    </label>
  );
}

export function NotificationPrefs() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPrefs(await getNotificationPrefs());
    } catch {
      /* a failed read must not break the account page — the section just stays hidden */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function set(key: keyof Prefs, next: boolean) {
    if (!prefs) return;
    const previous = prefs;
    // Optimistic: a toggle that waits for a slow Iraqi connection before moving feels broken.
    setPrefs({ ...prefs, [key]: next });
    setBusy(true);
    try {
      setPrefs(await updateNotificationPrefs({ [key]: next }));
      // ⚠️ THE LOCAL CONSENT CACHE HAS TO MOVE WITH THIS SWITCH, or turning «العروض» off here
      // is undone on the next app launch: `registerPushToken` re-asserts the cached consent on
      // every registration, and the server raises `notification_prefs.marketing` back to true
      // when it sees it. An opt-out that silently expires is worse than no opt-out at all —
      // it is the exact thing Apple 4.5.4 checks for.
      if (key === "marketing") setMarketingConsent(next);
    } catch (err) {
      setPrefs(previous);
      toast.error(getApiErrorMessage(err, "تعذر حفظ الإعداد"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="skeleton h-40 w-full rounded-2xl" />;
  if (!prefs) return null;

  return (
    <section dir="rtl" lang="ar" className="mt-8">
      <h2 className="mb-1 font-display text-lg font-bold text-ink">الإشعارات</h2>
      <p className="mb-3 text-xs leading-relaxed text-ink/50">
        اختر شنو يوصلك على التلفون. كل الرسائل تنحفظ بجرس الإشعارات داخل التطبيق حتى لو طفّيت
        الاثنين.
      </p>

      <div className="space-y-2">
        <Toggle
          on={prefs.orders}
          busy={busy}
          onChange={(v) => set("orders", v)}
          label="تحديثات طلبي"
          hint="وقت يتغيّر وضع طلبك، أو توافق ممثلتك، أو يقرب الموعد النهائي."
        />
        <Toggle
          on={prefs.marketing}
          busy={busy}
          onChange={(v) => set("marketing", v)}
          label="العروض والأخبار"
          hint="خصومات ومنتجات جديدة من لولو شوب. مطفي إلا إذا شغّلته بنفسك، وتقدر تطفّيه بأي وقت."
        />
      </div>
    </section>
  );
}
