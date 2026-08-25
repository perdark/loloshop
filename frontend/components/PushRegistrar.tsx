"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AUTH_CHANGED_EVENT, getToken } from "@/lib/auth";
import { nativeAppVersion, nativeShellPlatform } from "@/lib/native-shell";

/**
 * Asks for notification permission, registers the device, and routes a tapped notification.
 * Renders nothing and is completely inert in a browser.
 *
 * ⚠️ IT ONLY RUNS WHILE SIGNED IN, AND THAT IS DELIBERATE. A device token is worthless before
 * we know whose it is — the backend binds it to `req.user` — and iOS shows the permission
 * sheet exactly once per install. Spending that one prompt on a student who is still browsing
 * the shop, with nothing to notify them about, burns it: a «رفض» can only be undone in the
 * system Settings, which nobody does. So the ask happens after login, when the app has
 * something real to say (طلبك، الموافقة، الموعد النهائي).
 *
 * ⚠️ ANDROID 13+ NEEDS `POST_NOTIFICATIONS` IN THE MANIFEST. It is not in the plugin's own
 * manifest — the plugin only declares it as a Capacitor `@Permission` alias, which is a
 * runtime concept — so android/app/src/main/AndroidManifest.xml declares it. Android denies a
 * runtime request for an undeclared permission WITHOUT showing a dialog, exactly the silent
 * failure that hid the GPS bug: requestPermissions() would resolve 'denied' instantly and
 * nothing would ever say why.
 */
export function PushRegistrar() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    /**
     * One successful setup per mount. `run` fires again on every AUTH_CHANGED_EVENT — which is
     * what makes a sign-in trigger the permission ask — and without this a logout/login cycle
     * would attach a second full set of listeners, so one tapped notification would navigate
     * twice and one foreground message would raise two toasts.
     */
    let started = false;
    const removers: Array<() => void> = [];

    /** Attach a listener, or drop it immediately if the component unmounted mid-await. */
    const track = (handle: { remove: () => Promise<void> }) => {
      if (cancelled) void handle.remove();
      else removers.push(() => void handle.remove());
    };

    /** Tell the backend why this device refused to register. Never throws. */
    const reportRegistrationFailure = async (message: string) => {
      try {
        const token = getToken();
        if (!token) return;
        const base =
          process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000";
        await fetch(`${base}/api/app/push-error`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            platform: nativeShellPlatform(),
            app_version: await nativeAppVersion(),
            message,
          }),
          keepalive: true,
          cache: "no-store",
        });
      } catch {
        /* a diagnostic that breaks the app is worse than no diagnostic */
      }
    };

    const setup = async () => {
      if (started) return;
      const platform = nativeShellPlatform();
      if (!platform) return;
      if (!getToken()) return; // signed out — see the header
      started = true;

      // Both dynamic: lib/push pulls in axios, and this component sits in the ROOT layout.
      // A static import would put the whole API client in the first chunk of every page,
      // including the SSR storefront that deliberately does not need it.
      const [{ PushNotifications }, { registerPushToken }] = await Promise.all([
        import("@capacitor/push-notifications"),
        import("@/lib/push"),
      ]);
      if (cancelled) return;

      // Listeners BEFORE register(): on a cold start the OS can deliver the token, and the
      // tap that launched the app, before the next await resolves.
      const registration = await PushNotifications.addListener("registration", (token) => {
        void registerPushToken(token.value, platform).catch((error) => {
          // A failed hand-off just means no push until the next launch, which retries.
          console.warn("تعذر تسجيل جهاز الإشعارات:", error);
        });
      });
      track(registration);

      const registrationError = await PushNotifications.addListener(
        "registrationError",
        (error) => {
          // The usual cause on Android is a missing google-services.json in the installed
          // binary; on iOS, a build whose profile lacks the aps-environment entitlement.
          console.warn("فشل تسجيل الإشعارات:", error);
          // ⚠️ AND REPORT IT, because the line above is invisible. On 2026-08-26 prod had 145
          // Android device tokens and ZERO iOS while signed-in iPhone users opened the app
          // daily, and the one piece of evidence nobody could reach was this error — sitting in
          // a console on someone else's phone. Best-effort: a diagnostic must never be the
          // reason the app misbehaves, so every failure here is swallowed.
          void reportRegistrationFailure(String(error?.error ?? error ?? "unknown"));
        }
      );
      track(registrationError);

      // Foreground arrival. Android does NOT draw a system notification while the app is in
      // the foreground, so without this the message would simply vanish.
      const received = await PushNotifications.addListener(
        "pushNotificationReceived",
        (notification) => {
          const title = notification.title || "إشعار جديد";
          const link = typeof notification.data?.link === "string" ? notification.data.link : "";
          toast(title, {
            description: notification.body || undefined,
            action: link.startsWith("/")
              ? { label: "عرض", onClick: () => router.push(link) }
              : undefined,
          });
        }
      );
      track(received);

      // The tap. `link` is whatever the notification row carried ('/wholesaler', '/staff', …).
      const action = await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (event) => {
          const link = event.notification?.data?.link;
          // Same-origin path only. The value round-trips through FCM/APNs, so treat it as
          // untrusted input rather than something we wrote — "//evil.com" is a valid URL.
          if (typeof link === "string" && link.startsWith("/") && !link.startsWith("//")) {
            router.push(link);
          }
        }
      );
      track(action);

      // ⚠️ THIS PROMPT BUYS TRANSACTIONAL NOTIFICATIONS ONLY — order status, rep approval,
      // deadlines. It is NOT consent to marketing: Apple's guideline 4.5.4 wants promotional
      // push opted into through consent language in the app's own UI, which is the «العروض
      // والأخبار» switch in components/NotificationPrefs.tsx (default OFF, migration 089).
      // Do not widen what this ask means without moving that consent somewhere a user reads.
      const current = await PushNotifications.checkPermissions();
      if (cancelled) return;
      let granted = current.receive === "granted";
      let outcome = current.receive;
      if (!granted && current.receive !== "denied") {
        // 'prompt' / 'prompt-with-rationale' — never re-ask after a 'denied', the OS would
        // not show the sheet anyway.
        const asked = await PushNotifications.requestPermissions();
        granted = asked.receive === "granted";
        outcome = asked.receive;
      }
      if (cancelled) return;
      if (!granted) {
        // ⚠️ THIS RETURN USED TO BE COMPLETELY SILENT, and that silence cost a day. On
        // 2026-08-26 iOS had 0 device tokens, 0 registration errors and confirmed 1.0.4
        // users — a combination that is only possible if registration is never ATTEMPTED.
        // A refused (or never-answered) permission is the ordinary reason for that, and it
        // left no trace anywhere. Now it does.
        void reportRegistrationFailure(`permission=${outcome}`);
        return;
      }

      // Fires the 'registration' listener above with the FCM/APNs token.
      await PushNotifications.register();
    };

    const run = () => {
      void setup().catch((error) => {
        // Same blind spot as the permission return above: this path only ever warned into a
        // console on someone else's phone. A missing native plugin lands HERE, not in
        // registrationError, so without this the two failures are indistinguishable.
        void reportRegistrationFailure(`setup-failed: ${String(error?.message ?? error)}`);
        // Reached when the plugin is missing from the installed binary (a shell built before
        // `npx cap sync android` picked it up). Notifications simply stay in-app.
        // Re-open the gate so a transient failure gets another attempt on the next auth
        // change, rather than staying dead until the app is restarted.
        started = false;
        console.warn("الإشعارات غير متاحة على هذا الجهاز:", error);
      });
    };

    run();
    // A student signs in AFTER the layout mounts, which is precisely when we want to ask.
    window.addEventListener(AUTH_CHANGED_EVENT, run);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGED_EVENT, run);
      removers.forEach((remove) => remove());
    };
  }, [router]);

  return null;
}
