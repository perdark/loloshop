"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AUTH_CHANGED_EVENT, getToken } from "@/lib/auth";
import { PUSH_PERMISSION_CHANGED_EVENT } from "@/lib/push";
import { nativeAppVersion, nativeShellPlatform } from "@/lib/native-shell";

/**
 * Registers the device for push and routes a tapped notification. Renders nothing and is
 * completely inert in a browser.
 *
 * ⚠️ IT NO LONGER ASKS FOR PERMISSION — `NotificationPermissionPrompt` does, and it is now the
 * ONLY caller of `requestPermissions()` in the app. iOS shows its permission sheet exactly
 * once per install, so two independent callers is how that one sheet gets spent on a student
 * who was not looking at a reason. This component checks the permission and registers when it
 * is already granted; when the prompt wins a grant it fires
 * `PUSH_PERMISSION_CHANGED_EVENT` and the registration below runs immediately rather than
 * waiting for the next launch.
 *
 * ⚠️ IT REGISTERS SIGNED OUT TOO, SINCE MIGRATION 095. A token used to be discarded until
 * someone logged in, on the reasoning that the backend binds it to `req.user` — which meant a
 * phone that had already granted permission, the one thing an iOS install can only be granted
 * once, bought nothing at all. `device_tokens.user_id` is nullable now: the row is stored with
 * no owner and the upsert on `token` promotes it to a personal device the moment that handset
 * signs in. Nothing about a signed-in registration changed.
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
     * ⚠️ ONE SET OF LISTENERS PER MOUNT, AND THIS FLAG IS THE ONLY THING ENFORCING IT. `run`
     * fires again on every AUTH_CHANGED_EVENT and on every permission grant; without this a
     * logout/login cycle would attach a second full set, so one tapped notification would
     * navigate twice and one foreground message would raise two toasts.
     *
     * ⚠️ IT GUARDS THE LISTENERS ONLY — NOT THE WHOLE SETUP — and that separation is load-
     * bearing. Listeners are attached BEFORE the permission is read (a cold start can deliver
     * the token, and the tap that launched the app, before the next await resolves), so a pass
     * that finds permission not yet granted still leaves them attached. If this flag also
     * gated the register step, the grant that arrives a second later could never register the
     * device, and re-opening the flag to allow it would attach the listeners twice. It is one
     * or the other; it is this.
     */
    let listenersReady = false;
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
      const platform = nativeShellPlatform();
      if (!platform) return;

      // Both dynamic: lib/push pulls in axios, and this component sits in the ROOT layout.
      // A static import would put the whole API client in the first chunk of every page,
      // including the SSR storefront that deliberately does not need it.
      const [{ PushNotifications }, { registerPushToken, hasMarketingConsent }] = await Promise.all([
        import("@capacitor/push-notifications"),
        import("@/lib/push"),
      ]);
      if (cancelled) return;

      // Listeners BEFORE register(): on a cold start the OS can deliver the token, and the
      // tap that launched the app, before the next await resolves. Attached once — see
      // `listenersReady` above.
      if (!listenersReady) {
        listenersReady = true;
        const registration = await PushNotifications.addListener("registration", (token) => {
          // The consent flag rides along on every registration, not only the first: it is OR'd
          // server-side and can only ever RAISE the flag, so re-asserting it is safe, and it is
          // what carries an anonymous handset's «العروض» consent onto the account it later signs
          // into. Withdrawing consent clears the flag (lib/push.ts), so an opt-out is not undone
          // by the next launch.
          void registerPushToken(token.value, platform, {
            marketingOptIn: hasMarketingConsent(),
          }).catch((error) => {
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
      }

      // ⚠️ NO `requestPermissions()` HERE — NotificationPermissionPrompt owns the ask (see the
      // header). This only reads the answer.
      //
      // ⚠️ AND THE OS PERMISSION IS NOT CONSENT TO MARKETING. Apple's guideline 4.5.4 wants
      // promotional push opted into through consent language in the app's own UI; the OS sheet
      // carries no such language and never will. The consent is the tap on the card in
      // NotificationPermissionPrompt, recorded separately and withdrawable from
      // NotificationPrefs / DeviceNotificationPrefs (defaults OFF — migrations 089 and 095).
      // Do not treat a granted permission as an opted-in recipient anywhere.
      const current = await PushNotifications.checkPermissions();
      if (cancelled) return;
      const granted = current.receive === "granted";
      const outcome = current.receive;
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
        // change, rather than staying dead until the app is restarted. Anything attached
        // before the throw is dropped first, so the retry cannot end up with two of them.
        removers.splice(0).forEach((remove) => remove());
        listenersReady = false;
        console.warn("الإشعارات غير متاحة على هذا الجهاز:", error);
      });
    };

    run();
    // A student signs in AFTER the layout mounts, which is precisely when the anonymous device
    // row should gain its owner.
    window.addEventListener(AUTH_CHANGED_EVENT, run);
    // The grant NotificationPermissionPrompt just won. Re-running `setup` is all this needs:
    // the listeners are already attached and stay attached, and the second pass simply gets a
    // 'granted' out of checkPermissions() and calls register(). Without it the device would not
    // register until the app was next launched — the exact delay the prompt exists to remove.
    window.addEventListener(PUSH_PERMISSION_CHANGED_EVENT, run);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGED_EVENT, run);
      window.removeEventListener(PUSH_PERMISSION_CHANGED_EVENT, run);
      removers.forEach((remove) => remove());
    };
  }, [router]);

  return null;
}
