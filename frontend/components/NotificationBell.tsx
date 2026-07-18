"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePolling } from "@/lib/hooks/usePolling";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "@/lib/notifications";

/** Arabic relative time — "الآن", "قبل ٥ د", "قبل ٣ س", "قبل ٢ يوم". */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "الآن";
  if (min < 60) return `قبل ${min} د`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `قبل ${hr} س`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `قبل ${day} يوم`;
  return new Date(iso).toLocaleDateString("ar-IQ", { day: "numeric", month: "short" });
}

/**
 * Notification bell + dropdown. Self-contained: polls the user's notifications
 * every 30 s (pauses when the tab is hidden), shows an unread count badge, and a
 * panel listing the latest items. Clicking an item marks it read and follows its
 * link. Designed to drop into any authenticated header (student / wholesaler).
 */
export function NotificationBell({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // The panel is positioned `fixed` and clamped to the viewport so it can never
  // run off-screen — on RTL phones the bell sits left-of-center, so a bell-
  // anchored panel (`end-0`) overflowed the right edge and got clipped. We
  // measure the bell each time it opens: drop just beneath it, align under it
  // on wide screens, but clamp into the viewport (with a 1rem margin) on phones.
  const [panelPos, setPanelPos] = useState<{ top: number; left: number }>({
    top: 64,
    left: 16,
  });
  const rootRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      if (next && rootRef.current) {
        const r = rootRef.current.getBoundingClientRect();
        const margin = 16;
        const width = Math.min(320, window.innerWidth - 2 * margin);
        const maxLeft = window.innerWidth - width - margin;
        // Align the panel's left edge under the bell, clamped on-screen.
        const left = Math.round(Math.min(Math.max(r.left, margin), Math.max(margin, maxLeft)));
        setPanelPos({ top: Math.round(r.bottom) + 8, left });
      }
      return next;
    });
  }, []);

  const load = useCallback(() => {
    getNotifications()
      .then((list) => {
        setItems(list);
        setLoaded(true);
      })
      .catch(() => {
        /* silent — never block the header on a notifications fetch */
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll every ~60 s (±15 s jitter) so new notifications surface without a refresh.
  // This runs for EVERY logged-in tab — during a referral wave it is the biggest
  // background load, hence the long jittered interval (hidden tabs already skip).
  usePolling(load, 60000, true, 15000);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = items.filter((n) => !n.read).length;

  function openItem(n: AppNotification) {
    if (!n.read) {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
      );
      markNotificationRead(n.id).catch(() => {});
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  function markAll() {
    if (unread === 0) return;
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    markAllNotificationsRead().catch(() => {});
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={toggle}
        aria-label={`الإشعارات${unread > 0 ? ` — ${unread} غير مقروء` : ""}`}
        aria-expanded={open}
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-beige hover:text-orange-ink active:scale-95"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-ink px-1 text-[10px] font-bold leading-none text-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="الإشعارات"
          style={{ top: panelPos.top, left: panelPos.left }}
          className="fixed z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-pop)]"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-bold text-ink">الإشعارات</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="text-xs font-semibold text-orange-ink hover:underline"
              >
                تعليم الكل كمقروء
              </button>
            )}
          </div>

          <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
            {!loaded ? (
              <p className="px-4 py-8 text-center text-sm text-ink-soft">
                جارٍ التحميل…
              </p>
            ) : items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-ink-soft">
                لا توجد إشعارات بعد
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-sink ${
                        n.read ? "" : "bg-orange/5"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          n.read ? "bg-transparent" : "bg-orange-ink"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink">
                          {n.titleAr}
                        </span>
                        {n.bodyAr && (
                          <span className="mt-0.5 block text-xs text-ink-soft">
                            {n.bodyAr}
                          </span>
                        )}
                        <span className="mt-1 block text-[11px] text-muted">
                          {relativeTime(n.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
