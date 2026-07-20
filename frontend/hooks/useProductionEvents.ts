"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";

const baseURL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:4000";

/** Shape of a server-pushed production event (see backend lib/eventBus.js). */
export interface ProductionEvent {
  type: "presence" | "order" | "order_new";
  orderId?: string;
  status?: string;
  working_staff_id?: string | null;
  working_staff_name?: string | null;
}

/**
 * Subscribe to the live production event stream (SSE). The callback fires for
 * every server push — presence changes, order status moves, new orders — so any
 * page (staff queue, manager monitor, admin dashboard) can react in real time.
 *
 * The callback is held in a ref, so passing a fresh closure each render does NOT
 * re-open the stream. Reconnects obtain a fresh short-lived stream ticket; the
 * long-lived account JWT never appears in the URL or proxy access logs.
 */
export function useProductionEvents(
  onEvent: (event: ProductionEvent) => void,
  enabled = true
) {
  const cbRef = useRef(onEvent);
  useEffect(() => {
    cbRef.current = onEvent;
  });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let stopped = false;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      try {
        const { data } = await api.post<{ ticket: string }>("/production/events-ticket");
        if (stopped) return;
        es = new EventSource(
          `${baseURL}/api/production/events?ticket=${encodeURIComponent(data.ticket)}`
        );
        es.onmessage = (ev) => {
          try {
            cbRef.current(JSON.parse(ev.data) as ProductionEvent);
          } catch {
            // keep-alive comments / malformed frames — ignore
          }
        };
        es.onerror = () => {
          es?.close();
          es = null;
          if (!stopped) retry = setTimeout(connect, 3000);
        };
      } catch {
        if (!stopped) retry = setTimeout(connect, 3000);
      }
    };
    void connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [enabled]);
}
