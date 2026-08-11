"use client";

/** One message. Shared by the floating panel and the home-page section so the assistant
 *  reads identically in both — same radius, same colours, same wrapping. */

import type { Turn } from "./SupportChatProvider";

export function ChatBubble({ role, text }: { role: Turn["role"]; text: string }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          mine ? "bg-orange text-white" : "bg-surface-sink text-ink-soft"
        }`}
      >
        {text}
      </p>
    </div>
  );
}

/** The "…" while the model answers. Deliberately not a spinner: on a slow Iraqi connection a
 *  spinner reads as "stuck", three bouncing dots read as "someone is replying". */
export function TypingDots() {
  return (
    <div className="flex justify-start">
      <div className="flex gap-1 rounded-2xl bg-surface-sink px-4 py-3">
        {[0, 150, 300].map((d) => (
          <span
            key={d}
            className="h-2 w-2 animate-bounce rounded-full bg-muted"
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
