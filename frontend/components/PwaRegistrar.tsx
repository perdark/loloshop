"use client";

import { useEffect } from "react";

export function PwaRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!window.isSecureContext && window.location.hostname !== "localhost") return;

    if (process.env.NODE_ENV !== "production") {
      // A previously installed production worker can keep serving stale Next.js
      // chunks on localhost. Development must always use the live dev server.
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister()))
      );
      if ("caches" in window) {
        void caches.keys().then((keys) =>
          Promise.all(keys.filter((key) => key.startsWith("loloshop-")).map((key) => caches.delete(key)))
        );
      }
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch((error) => {
        console.warn("تعذر تسجيل عامل الخدمة للتطبيق:", error);
      });
  }, []);

  return null;
}
