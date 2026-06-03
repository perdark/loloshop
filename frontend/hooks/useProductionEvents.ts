"use client";

import { useEffect, useRef } from "react";
import { getToken } from "@/lib/auth";

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
 * EventSource reconnects automatically if the connection drops, so there's no
 * manual retry logic. The callback is held in a ref, so passing a fresh closure
 * each render does NOT re-open the stream.
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
    const token = getToken();
    if (!token) return;

    const es = new EventSource(
      `${baseURL}/api/production/events?token=${encodeURIComponent(token)}`
    );
    es.onmessage = (ev) => {
      try {
        cbRef.current(JSON.parse(ev.data) as ProductionEvent);
      } catch {
        // keep-alive comments / malformed frames — ignore
      }
    };
    // EventSource auto-reconnects on error; nothing to do here.
    return () => es.close();
  }, [enabled]);
}
