"use client";

/**
 * «اسأل عن أرقامك» — natural-language questions over the admin's own numbers.
 *
 * The prose answer is written by a model, but every number in it was computed by our SQL
 * (backend/lib/adminMetrics.js). The raw figures are rendered underneath the sentence on
 * purpose: the owner can check the assistant's arithmetic at a glance, which is what makes
 * a model-written summary safe to trust on a money screen.
 */

import { useState } from "react";
import { api, getApiErrorMessage } from "@/lib/api";

type Answer = { answer: string; intent: string | null; label?: string; facts: string[] };

const EXAMPLES = [
  "شكد ربحنا هذا الشهر؟",
  "منو أفضل ممثل؟",
  "شنو أكثر منتج مبيعاً؟",
  "كم طلب ينتظر موافقة؟",
];

export function AnalyticsAsk() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await api.post<Answer>("/assistant/analytics", { question: text });
      setResult(data);
    } catch (err) {
      setError(getApiErrorMessage(err, "ما كدرت أجيب الجواب، جرّب مرة ثانية"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section dir="rtl" className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold text-ink">اسأل عن أرقامك</h2>
      <p className="mt-1 text-sm text-muted">
        اكتب سؤالك بالعربي. الأرقام تنحسب من قاعدة البيانات — المساعد يصيغها بس.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="مثلاً: شكد ربحنا هذا الشهر؟"
          maxLength={600}
          disabled={busy}
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-cream px-4 text-sm text-ink outline-none transition placeholder:text-muted focus:border-orange disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="h-11 shrink-0 rounded-xl bg-orange px-5 text-sm font-semibold text-white transition disabled:opacity-40"
        >
          {busy ? "…" : "اسأل"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={busy}
            onClick={() => {
              setQuestion(ex);
              ask(ex);
            }}
            className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft transition hover:border-orange hover:text-orange-ink disabled:opacity-40"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-blush px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 rounded-xl bg-surface-sink p-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{result.answer}</p>

          {result.facts.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">
                الأرقام كما هي{result.label ? ` — ${result.label}` : ""}
              </summary>
              <ul className="mt-2 space-y-1 border-t border-line pt-2">
                {result.facts.map((f, i) => (
                  <li key={i} className="text-xs leading-relaxed text-ink-soft">
                    {f}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
