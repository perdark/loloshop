"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";

const baseURL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:4000";

/** Shape of a server-pushed production event (see backend lib/eventBus.js). */
export interface ProductionEvent {
  type: "presence" | "order" | "order_new" | "order_deleted" | "order_approved" | "order_rejected";
  orderId?: string;
  status?: string;
  working_staff_id?: string | null;
  working_staff_name?: string | null;
}

/** The server pings every 25 s; three missed pings means the stream is dead, not quiet. */
const STALE_AFTER_MS = 70_000;
/** A tab hidden at least this long may have slept through events (iOS suspends it). */
const RESYNC_AFTER_HIDDEN_MS = 20_000;

/**
 * Subscribe to the live production event stream (SSE). The callback fires for
 * every server push — presence changes, order status moves, new orders — so any
 * page (staff queue, manager monitor, admin dashboard) can react in real time.
 *
 * The callback is held in a ref, so passing a fresh closure each render does NOT
 * re-open the stream. Reconnects obtain a fresh short-lived stream ticket; the
 * long-lived account JWT never appears in the URL or proxy access logs.
 *
 * `onResync` — called whenever events may have been MISSED: the stream came back after a
 * drop (a deploy restarts the API and cuts every stream), the stream went silent past
 * STALE_AFTER_MS and was replaced, or the tab returns after being hidden. A screen that
 * relies on events alone (no timer — /staff/queue since 2026-10-16) reloads once here;
 * without it, a move that happened during the gap would simply never show.
 *
 * ⚠️ The watchdog reads the server's NAMED `ping` event (lib/eventBus.js). EventSource never
 * exposes SSE comments to JS, so a comment ping would make a live stream look dead.
 */
export function useProductionEvents(
  onEvent: (event: ProductionEvent) => void,
  enabled = true,
  onResync?: () => void
) {
  const cbRef = useRef(onEvent);
  const resyncRef = useRef(onResync);
  useEffect(() => {
    cbRef.current = onEvent;
    resyncRef.current = onResync;
  });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let stopped = false;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let lastBeat = Date.now();
    let connectedOnce = false;
    let missed = false; // events may have been lost since the last resync
    let hiddenAt: number | null = null;

    const drop = () => {
      es?.close();
      es = null;
      missed = true;
      if (!stopped && !retry) retry = setTimeout(connect, 3000);
    };

    const connect = async () => {
      retry = null;
      try {
        const { data } = await api.post<{ ticket: string }>("/production/events-ticket");
        if (stopped) return;
        lastBeat = Date.now(); // a stream still connecting is not a dead one
        es = new EventSource(
          `${baseURL}/api/production/events?ticket=${encodeURIComponent(data.ticket)}`
        );
        es.onopen = () => {
          lastBeat = Date.now();
          if (connectedOnce && missed) resyncRef.current?.();
          connectedOnce = true;
          missed = false;
        };
        es.addEventListener("ping", () => {
          lastBeat = Date.now();
        });
        es.onmessage = (ev) => {
          lastBeat = Date.now();
          try {
            cbRef.current(JSON.parse(ev.data) as ProductionEvent);
          } catch {
            // malformed frame — ignore
          }
        };
        es.onerror = drop;
      } catch {
        missed = true;
        if (!stopped && !retry) retry = setTimeout(connect, 3000);
      }
    };

    // Not a poll: nothing is fetched here. It only notices a stream that stopped talking.
    const watchdog = setInterval(() => {
      if (es && Date.now() - lastBeat > STALE_AFTER_MS) drop();
    }, 15_000);

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      if (away < RESYNC_AFTER_HIDDEN_MS) return;
      // The stream may have died while the tab slept; reopen it and resync on open.
      if (es && Date.now() - lastBeat > STALE_AFTER_MS) drop();
      else resyncRef.current?.();
    };
    document.addEventListener("visibilitychange", onVisibility);

    void connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisibility);
      es?.close();
    };
  }, [enabled]);
}
