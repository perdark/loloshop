"use client";

import { useEffect } from "react";

export function PwaRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!window.isSecureContext && window.location.hostname !== "localhost") return;

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("تعذر تسجيل عامل الخدمة للتطبيق:", error);
    });
  }, []);

  return null;
}
