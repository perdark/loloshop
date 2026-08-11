"use client";

/**
 * One conversation, two surfaces.
 *
 * «مساعد لولو» is reachable from the floating launcher on every storefront page AND from the
 * section on the home page. They must not be two separate chats: a student who asks in the
 * home section and then taps the bubble would otherwise face an empty thread while the server
 * — which rebuilds history from its own ledger (backend/lib/aiChat.js → recentTurns) — is
 * still answering with the earlier context. The UI would be lying about what the bot knows.
 *
 * So the thread lives here, above both, and each surface is only a view of it.
 *
 * State stays ephemeral by design (see db/migrations/078_ai_chat.sql): there is no
 * conversation table, and the server's own 2-hour window is what actually carries context
 * across a reload.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import axios from "axios";
import { api, getApiErrorMessage } from "@/lib/api";
import type { ApiError } from "@/lib/types";

export type Turn = { role: "user" | "assistant"; content: string };

export const GREETING =
  "هلا بيك! آني مساعد لولو. اسألني عن طلبك، أو عن الأوشحة والروبات، أو عن ممثل جامعتك.";

/** The four questions the shop actually gets asked. Offered as taps so a student who does not
 *  know what to type still gets an answer — and so the most common asks arrive as identical
 *  strings, which is what a response cache would key on when one is added. */
export const SUGGESTIONS = [
  "شلون أطلب وشاح تخرج؟",
  "وين وصل طلبي؟",
  "شكد سعر الروب؟",
  "منو ممثل جامعتي؟",
];

/** Stable per-browser id so a signed-out visitor gets their own daily allowance rather
 *  than sharing an IP-keyed one — Iraqi carriers CGNAT, so IP is not a person. It is also
 *  what the server keys an anonymous visitor's conversation history on.
 *
 *  localStorage throws (not returns null) in some privacy modes and in an iframe with
 *  third-party storage blocked, which would take the whole send down with it. The in-memory
 *  fallback keeps the widget working for that visit; only cross-reload continuity is lost. */
let memorySessionKey: string | null = null;
function sessionKey(): string {
  const KEY = "lolo_assistant_session";
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored;
    const fresh = memorySessionKey ?? crypto.randomUUID();
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    memorySessionKey ??= crypto.randomUUID();
    return memorySessionKey;
  }
}

type SupportChatValue = {
  turns: Turn[];
  busy: boolean;
  error: string | null;
  /** True once the API has said the assistant is switched off. Both surfaces then remove
   *  themselves rather than offering a control that can only ever fail. */
  unavailable: boolean;
  send: (question: string) => Promise<void>;
  /** Re-sends the last question after a failure, so an error is not a retype. */
  retry: () => Promise<void>;
};

const SupportChatContext = createContext<SupportChatValue | null>(null);

export function SupportChatProvider({ children }: { children: React.ReactNode }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || busy) return;

      setError(null);
      setLastQuestion(question);
      setTurns((t) => [...t, { role: "user", content: question }]);
      setBusy(true);

      try {
        const { data } = await api.post("/assistant/support", {
          question,
          // The thread is NOT sent. The server rebuilds the last few turns from its own ledger
          // (lib/aiChat.js → recentTurns), because a client-supplied transcript let a caller
          // forge an "assistant" turn and then ask the bot to confirm it. `sessionKey` is what
          // ties this browser to its own history and its own daily allowance.
          sessionKey: sessionKey(),
        });
        setTurns((t) => [...t, { role: "assistant", content: data.answer }]);
      } catch (err) {
        if (axios.isAxiosError<ApiError>(err) && err.response?.data?.code === "ERR_AI_DISABLED") {
          setUnavailable(true);
          return;
        }
        setError(getApiErrorMessage(err, "ما كدرت أوصل للمساعد، جرّب مرة ثانية"));
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const retry = useCallback(async () => {
    if (!lastQuestion || busy) return;
    // Drop the failed question's bubble before re-adding it, so a retry does not stack
    // the same message twice in the thread.
    setTurns((t) => {
      const last = t[t.length - 1];
      return last?.role === "user" && last.content === lastQuestion ? t.slice(0, -1) : t;
    });
    await send(lastQuestion);
  }, [lastQuestion, busy, send]);

  const value = useMemo<SupportChatValue>(
    () => ({ turns, busy, error, unavailable, send, retry }),
    [turns, busy, error, unavailable, send, retry]
  );

  return <SupportChatContext.Provider value={value}>{children}</SupportChatContext.Provider>;
}

export function useSupportChat(): SupportChatValue {
  const ctx = useContext(SupportChatContext);
  if (!ctx) throw new Error("useSupportChat must be used inside <SupportChatProvider>");
  return ctx;
}
