"use client";

/**
 * One conversation, two surfaces.
 *
 * «لولو» — the assistant — is reachable from the floating launcher on every storefront page AND
 * from the stage on the home page. They must not be two separate chats: a student who asks in
 * the home section and then taps the bubble would otherwise face an empty thread while the
 * server — which rebuilds history from its own ledger (backend/lib/aiChat.js → recentTurns) —
 * is still answering with the earlier context. The UI would be lying about what the bot knows.
 *
 * So the thread lives here, above both, and each surface is only a view of it.
 *
 * The thread is also persisted for two hours, matching the server's own memory window exactly.
 * Before that, a refresh emptied the panel while the server kept answering with context the
 * student could no longer see — the same lie in a different direction.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { api, getApiErrorMessage } from "@/lib/api";
import type { ApiError } from "@/lib/types";
import type { LoloEmotion, Reaction } from "./LoloFace";

/** A tappable next step under an answer. The server picks these from a closed list of the
 *  shop's own destinations — the model never emits a URL. See backend/lib/supportActions.js. */
export type ChatAction = {
  id: string;
  label: string;
  kind: "internal" | "external";
  href: string;
};

/** The lighter, four-value mood the server attaches to a reply for BUBBLE-level styling —
 *  the wink flourish, the softer "caring" tone. Distinct from `emotion` above, which drives
 *  the big mascot face and has its own seven-value vocabulary (pickEmotion in
 *  backend/lib/supportActions.js). Both arrive on the same answer; they answer different
 *  questions ("how does the whole widget feel" vs "how does THIS reply read"). */
export type Mood = "happy" | "caring" | "wink" | "neutral";

/**
 * The third and last of the three feelings fields the server attaches to a reply, and the only
 * one about the STUDENT's message rather than about the answer: `emotion` is what the reply is
 * ABOUT, `mood` is the register it is written IN, and `reaction` is what لولو DOES the moment
 * she reads you — the face beside the reply plays it once, big, then settles back.
 *
 * Defined with the mascot (LoloFace.tsx) because that is what plays it, and re-exported here so
 * a consumer reading `Turn` does not have to go looking. The judgement itself is the server's:
 * backend/lib/reaction.js → pickReaction.
 */
export type { Reaction };

export type Turn = {
  role: "user" | "assistant";
  content: string;
  actions?: ChatAction[];
  emotion?: LoloEmotion;
  mood?: Mood;
  /** لولو's own reaction to the message this reply answers. Only assistant turns carry one. */
  reaction?: Reaction;
  /** Set on the newest answer only, so exactly one bubble runs the reveal animation. */
  fresh?: boolean;
};

/**
 * Errors are typed because they are not interchangeable, and treating them as one string was a
 * real bug: every failure rendered «أعد المحاولة», so hitting a rate limit offered a retry
 * button whose only possible outcome was the same error again.
 *
 *   wait      — a short throttle. Say how long; do NOT offer a retry that cannot work yet.
 *   retryable — a network or upstream blip. Retrying is exactly right.
 *   off       — the assistant is switched off entirely; both surfaces remove themselves.
 */
export type ChatError = {
  message: string;
  kind: "wait" | "retryable";
  retryAfterSec?: number;
  actions?: ChatAction[];
};

export const GREETING =
  "هلا بيك! آني لولو 🧡 اسألني عن الأسعار، أو وين وصل طلبك، أو منو ممثل جامعتك.";

/**
 * The chips a visitor sees before they have typed anything.
 *
 * These lead with what SELLS, not only what supports — the assistant is the shop's main
 * marketing surface now, so the first thing offered is the catalogue and the price list rather
 * than a support desk. They double as the response cache's warmest keys: every anonymous
 * visitor tapping one sends a byte-identical question, so those answers come back instantly and
 * for free (backend/controllers/supportChatController.js → the CACHE block).
 */
export const SUGGESTIONS = [
  "شنو أكثر شي ينباع عندكم؟",
  "شكد سعر الروب؟",
  "شلون أطلب وشاح تخرج؟",
  "وين وصل طلبي؟",
];

/** The empty-state chips on the dedicated /lolo page — a distinct set from SUGGESTIONS
 *  above (which lead with what sells, tuned for the homepage banner and its cache-warming
 *  role). A visitor who already tapped through to a full chat screen has passed the "what do
 *  you sell" moment; these lead with the practical questions that screen exists to answer. */
export const LOLO_PAGE_SUGGESTIONS = [
  "شكد سعر الروب؟",
  "وين مكانكم؟",
  "تسوون لجامعتي؟",
  "منو ممثل جامعتي؟",
];

// ── Session identity ────────────────────────────────────────────────────────────────────────
// The id itself is minted and SIGNED by the server (backend/lib/anonSession.js). This browser
// only stores the token it was handed and presents it again; it cannot make one up. That is
// what stopped the old client-generated key from being both a free way past the rate limit and
// a way to load somebody else's conversation by guessing their id.
//
// localStorage throws (not returns null) in some privacy modes and in an iframe with
// third-party storage blocked, which would take the whole send down with it — so every access
// is guarded and falls back to memory for the visit.
const TOKEN_KEY = "lolo_assistant_token";
const THREAD_KEY = "lolo_assistant_thread";
/** Matches the server's own 2-hour conversation window (aiChat.js → recentTurns). */
const THREAD_TTL_MS = 2 * 60 * 60 * 1000;

let memoryToken: string | null = null;

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

function writeToken(token: string) {
  memoryToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode — the in-memory copy carries this visit */
  }
}

function readThread(): Turn[] {
  try {
    const raw = localStorage.getItem(THREAD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { at: number; turns: Turn[] };
    if (!parsed?.at || Date.now() - parsed.at > THREAD_TTL_MS) return [];
    // `fresh` must never survive a reload, or every restored answer would re-run its reveal.
    return Array.isArray(parsed.turns) ? parsed.turns.map((t) => ({ ...t, fresh: false })) : [];
  } catch {
    return [];
  }
}

function writeThread(turns: Turn[]) {
  try {
    if (!turns.length) localStorage.removeItem(THREAD_KEY);
    else localStorage.setItem(THREAD_KEY, JSON.stringify({ at: Date.now(), turns }));
  } catch {
    /* private mode — the thread simply does not survive a reload */
  }
}

type SupportChatValue = {
  turns: Turn[];
  busy: boolean;
  error: ChatError | null;
  /** True once the API has said the assistant is switched off. Both surfaces then remove
   *  themselves rather than offering a control that can only ever fail. */
  unavailable: boolean;
  /** The face to show right now, resolved from request state and the server's own hint. */
  emotion: LoloEmotion;
  send: (question: string) => Promise<void>;
  /** Re-sends the last question after a failure, so an error is not a retype. */
  retry: () => Promise<void>;
  /** Start over. Only clears what this browser shows — the server's 2-hour window is its own. */
  reset: () => void;
};

const SupportChatContext = createContext<SupportChatValue | null>(null);

export function SupportChatProvider({ children }: { children: React.ReactNode }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

  // Restored after mount, never during render: reading localStorage while rendering would make
  // the server and client markup disagree and cost a hydration mismatch.
  useEffect(() => { setTurns(readThread()); }, []);
  useEffect(() => { writeThread(turns); }, [turns]);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || busy) return;

      setError(null);
      setLastQuestion(question);
      setTurns((t) => [...t.map((x) => ({ ...x, fresh: false })), { role: "user", content: question }]);
      setBusy(true);

      try {
        const { data } = await api.post("/assistant/support", {
          question,
          // The thread is NOT sent. The server rebuilds the last few turns from its own ledger,
          // because a client-supplied transcript let a caller forge an "assistant" turn and then
          // ask the bot to confirm it. The token is what ties this browser to its own history.
          sessionToken: readToken(),
        });
        // The server hands back a fresh token when the one we presented was missing or expired,
        // so a visitor who cleared storage self-heals without ever seeing an error.
        if (data.sessionToken) writeToken(data.sessionToken);
        setTurns((t) => [
          ...t,
          {
            role: "assistant",
            content: data.answer,
            actions: data.actions,
            emotion: data.emotion,
            mood: data.mood,
            reaction: data.reaction,
            fresh: true,
          },
        ]);
      } catch (err) {
        if (!axios.isAxiosError<ApiError & { retryAfterSec?: number; actions?: ChatAction[] }>(err)) {
          setError({ message: "صار خطأ غير متوقع، جرّب مرة ثانية", kind: "retryable" });
          return;
        }
        const body = err.response?.data;
        if (body?.code === "ERR_AI_DISABLED") {
          setUnavailable(true);
          return;
        }
        // A throttle is a short wait, not a failure — the server says how long, and offering a
        // retry button before then would be a button that cannot work.
        const retryAfterSec = body?.retryAfterSec;
        setError({
          message: getApiErrorMessage(err, "ما كدرت أوصل للمساعد، جرّب مرة ثانية"),
          kind: retryAfterSec ? "wait" : "retryable",
          retryAfterSec,
          actions: body?.actions,
        });
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

  const reset = useCallback(() => {
    setTurns([]);
    setError(null);
    setLastQuestion(null);
  }, []);

  // The face. Request state wins because it is happening now; otherwise the server's hint for
  // the newest answer stands, and a fresh visitor gets the default smile.
  const emotion: LoloEmotion = useMemo(() => {
    if (unavailable) return "sleeping";
    if (busy) return "thinking";
    if (error) return "thinking";
    const lastAnswer = [...turns].reverse().find((t) => t.role === "assistant");
    return lastAnswer?.emotion ?? "happy";
  }, [unavailable, busy, error, turns]);

  const value = useMemo<SupportChatValue>(
    () => ({ turns, busy, error, unavailable, emotion, send, retry, reset }),
    [turns, busy, error, unavailable, emotion, send, retry, reset]
  );

  return <SupportChatContext.Provider value={value}>{children}</SupportChatContext.Provider>;
}

export function useSupportChat(): SupportChatValue {
  const ctx = useContext(SupportChatContext);
  if (!ctx) throw new Error("useSupportChat must be used inside <SupportChatProvider>");
  return ctx;
}

/**
 * Counts a throttle down so «استريح خمس دقائق» becomes a number that visibly moves.
 * A static "try later" leaves the visitor guessing whether the assistant is broken.
 */
export function useCountdown(seconds: number | undefined) {
  const [left, setLeft] = useState(seconds ?? 0);
  // Stamped in the effect, never during render: calling Date.now() while rendering makes the
  // component impure and its result unstable across re-renders.
  const startedAt = useRef(0);

  useEffect(() => {
    if (!seconds) return;
    startedAt.current = Date.now();
    setLeft(seconds);
    const id = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      setLeft(Math.max(0, seconds - elapsed));
    }, 1000);
    return () => window.clearInterval(id);
  }, [seconds]);

  return left;
}
