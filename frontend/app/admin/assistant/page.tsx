"use client";

/**
 * «لولو الإدارة» — the owner's own console. Full page, admin only.
 *
 * ⚠️ THIS IS NOT THE STOREFRONT ASSISTANT. Nothing here imports anything the customer-facing
 * «لولو» uses, and that separation is deliberate on both sides of the wire — see the header of
 * backend/controllers/adminConsoleController.js for the four ways the two surfaces differ and
 * why sharing either the guard or the budget would be a defect rather than a saving.
 *
 * Three things live on this page, in the order the owner needs them:
 *
 *   1. TODAY'S STAFF STRIP + suggestions. Above the fold and needing no question, because
 *      «هل الموظفين يشتغلون» is a thing the owner wants to SEE, not a thing he wants to have
 *      to remember to ask. The suggestions come from SQL, never a model.
 *   2. THE CONVERSATION. Every answer ships the numbers we computed beside the prose, so the
 *      phrasing is auditable at a glance.
 *   3. THE DAILY REPORT TABLE, with a date picker for yesterday and before.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { toArabicDigits } from "@/lib/format";
import {
  askAdminConsole,
  getAdminChatHistory,
  getAdminSuggestions,
  getStaffDailyReport,
  runAdminAction,
  type AdminAskResult,
  type AdminProposal,
  type AdminSuggestion,
  type StaffDailyReport,
  type StaffDayRow,
} from "@/lib/admin-console";

/* ── One conversation turn as the page renders it ────────────────────────────────────────── */
type Turn = {
  id: string;
  question: string;
  answer: string;
  label?: string;
  facts: string[];
  proposal: AdminProposal | null;
  /** Set once the admin confirms or the proposal fails — a card must not offer تأكيد twice. */
  outcome?: { ok: boolean; message: string };
};

const EXAMPLES = [
  "شنو حالة الموظفين اليوم؟",
  "منو ما فتح التطبيق اليوم؟",
  "شكد دخل المحل هذا الشهر؟",
  "منو أفضل ممثل؟",
  "شنو القطع اللي واقفة من مدة؟",
  "شكد كلفة المساعد هذا الأسبوع؟",
];

/** «٧ ساعات و٣٠ دقيقة». Minutes alone are unreadable at shift scale. */
function fmtHours(mins: number | null): string {
  if (mins === null) return "—";
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${toArabicDigits(rest)} دقيقة`;
  return rest ? `${toArabicDigits(h)} س ${toArabicDigits(rest)} د` : `${toArabicDigits(h)} ساعة`;
}

function fmtClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ar-IQ", {
    timeZone: "Asia/Baghdad",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SEVERITY_STYLE: Record<AdminSuggestion["severity"], string> = {
  urgent: "border-danger/30 bg-blush",
  attention: "border-orange/30 bg-peach/40",
  info: "border-line bg-surface-sink",
};

/* ── Today's four numbers ────────────────────────────────────────────────────────────────── */
function StatTile({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "good" | "bad";
}) {
  const color =
    tone === "good" ? "text-green-600" : tone === "bad" ? "text-danger" : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

export default function AdminAssistantPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<AdminSuggestion[] | null>(null);
  const [report, setReport] = useState<StaffDailyReport | null>(null);
  const [reportDate, setReportDate] = useState<string>("");
  const [reportBusy, setReportBusy] = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);

  /* ── Today's report + suggestions. Both are cheap and neither costs a model call. ──────── */
  const loadReport = useCallback(async (date?: string) => {
    setReportBusy(true);
    try {
      const data = await getStaffDailyReport(date);
      setReport(data);
      setReportDate(data.date);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "ما كدرت أجيب تقرير الموظفين"));
    } finally {
      setReportBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
    getAdminSuggestions()
      .then((d) => setSuggestions(d.suggestions))
      // A failed suggestion feed must not take the page down — it is the ambient half.
      .catch(() => setSuggestions([]));

    // Restore the thread so the page is a conversation rather than a series of forgotten
    // questions. Proposals are NOT restored: a signed token expires in 10 minutes and an
    // action offered by yesterday's tab is a trap, not a convenience.
    getAdminChatHistory(15)
      .then((rows) =>
        setTurns(
          rows.map((r, i) => ({
            id: `h${i}-${r.created_at}`,
            question: r.question,
            answer: r.answer,
            facts: [],
            proposal: null,
          }))
        )
      )
      .catch(() => {});
  }, [loadReport]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setQuestion("");
    try {
      const res: AdminAskResult = await askAdminConsole(text);
      setTurns((prev) => [
        ...prev,
        {
          id: `${Date.now()}`,
          question: text,
          answer: res.answer,
          label: res.label,
          facts: res.facts || [],
          proposal: res.proposal,
        },
      ]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "ما كدرت أجيب الجواب، جرّب مرة ثانية"));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(turn: Turn) {
    if (!turn.proposal || confirming) return;
    setConfirming(turn.id);
    try {
      const res = await runAdminAction(turn.proposal.token);
      setTurns((prev) =>
        prev.map((t) => (t.id === turn.id ? { ...t, outcome: { ok: true, message: res.message } } : t))
      );
      toast.success(res.message);
      // The action changed the shop, so the ambient half is now stale. Refreshing both is
      // cheaper than leaving a suggestion on screen that the owner just resolved.
      void loadReport(reportDate || undefined);
      getAdminSuggestions().then((d) => setSuggestions(d.suggestions)).catch(() => {});
    } catch (err) {
      const message = getApiErrorMessage(err, "ما تم التنفيذ");
      setTurns((prev) =>
        prev.map((t) => (t.id === turn.id ? { ...t, outcome: { ok: false, message } } : t))
      );
      toast.error(message);
    } finally {
      setConfirming(null);
    }
  }

  const t = report?.totals;

  return (
    <div dir="rtl" lang="ar" className="mx-auto max-w-5xl space-y-6 pb-24">
      <header>
        <h1 className="font-playfair text-2xl font-semibold text-ink">لولو الإدارة</h1>
        <p className="mt-1 text-sm text-muted">
          اسأل عن أي رقم بالمحل، وأكدر أنفّذ بعض الإجراءات بعد ما تأكّدها. كل رقم ينحسب من قاعدة
          البيانات — المساعد يصيغه بس.
        </p>
      </header>

      {/* ── 1. TODAY ────────────────────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">الموظفون اليوم</h2>
        {t ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="فتحوا التطبيق"
              value={`${toArabicDigits(t.opened)} / ${toArabicDigits(t.staff)}`}
              tone={t.opened === 0 && t.staff > 0 ? "bad" : "ink"}
            />
            <StatTile label="بصموا حضور" value={toArabicDigits(t.checked_in)} />
            <StatTile
              label="غايبين"
              value={toArabicDigits(t.absent)}
              tone={t.absent > 0 ? "bad" : "good"}
            />
            <StatTile label="ساعات العمل" value={fmtHours(t.worked_minutes)} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[86px] animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        )}
      </section>

      {/* ── 2. SUGGESTIONS — computed from SQL, never from a model ──────────────────────── */}
      {suggestions !== null && suggestions.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">يستاهل انتباهك</h2>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li
                key={s.id}
                className={`rounded-2xl border p-4 ${SEVERITY_STYLE[s.severity]}`}
              >
                <p className="text-sm font-semibold text-ink">{s.title}</p>
                {s.detail && <p className="mt-1 text-xs leading-relaxed text-ink-soft">{s.detail}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={s.href}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:border-orange hover:text-orange-ink"
                  >
                    افتح الصفحة
                  </Link>
                  {s.ask && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void ask(s.ask as string)}
                      className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:border-orange hover:text-orange-ink disabled:opacity-40"
                    >
                      اسأل لولو
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 3. THE CONVERSATION ─────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-ink-soft">المحادثة</h2>

        <div className="mt-4 space-y-5">
          {turns.length === 0 && (
            <p className="rounded-xl bg-surface-sink px-4 py-6 text-center text-sm text-muted">
              اسألني عن أرقام المحل، أو اطلب مني أنفّذ شي.
            </p>
          )}

          {turns.map((turn) => (
            <div key={turn.id} className="space-y-2">
              <p className="ms-auto w-fit max-w-[85%] rounded-2xl rounded-se-sm bg-orange/10 px-4 py-2 text-sm text-ink">
                {turn.question}
              </p>

              <div className="me-auto w-fit max-w-[92%] rounded-2xl rounded-ss-sm bg-surface-sink px-4 py-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{turn.answer}</p>

                {turn.facts.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">
                      الأرقام كما هي{turn.label ? ` — ${turn.label}` : ""}
                    </summary>
                    <ul className="mt-2 space-y-1 border-t border-line pt-2">
                      {turn.facts.map((f, i) => (
                        <li key={i} className="text-xs leading-relaxed text-ink-soft">
                          {f}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              {/* The confirm card. The sentence is the SERVER's, shown verbatim — the model
                  never authors what the owner is agreeing to. */}
              {turn.proposal && !turn.outcome && (
                <div className="me-auto w-fit max-w-[92%] rounded-2xl border border-orange/40 bg-peach/30 p-4">
                  <p className="text-xs font-semibold text-orange-ink">تحتاج تأكيدك</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink">{turn.proposal.confirm}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={confirming === turn.id}
                      onClick={() => void confirm(turn)}
                      className="h-10 rounded-xl bg-orange px-5 text-sm font-semibold text-white transition disabled:opacity-40"
                    >
                      {confirming === turn.id ? "…" : "تأكيد"}
                    </button>
                    <button
                      type="button"
                      disabled={confirming === turn.id}
                      onClick={() =>
                        setTurns((prev) =>
                          prev.map((x) =>
                            x.id === turn.id
                              ? { ...x, outcome: { ok: false, message: "انلغى" } }
                              : x
                          )
                        )
                      }
                      className="h-10 rounded-xl border border-line px-5 text-sm font-medium text-ink-soft transition hover:border-orange disabled:opacity-40"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}

              {turn.outcome && (
                <p
                  className={`me-auto w-fit rounded-xl px-3 py-2 text-xs font-medium ${
                    turn.outcome.ok ? "bg-green-500/10 text-green-700" : "bg-blush text-danger"
                  }`}
                >
                  {turn.outcome.message}
                </p>
              )}
            </div>
          ))}

          {busy && (
            <p className="me-auto w-fit rounded-2xl bg-surface-sink px-4 py-3 text-sm text-muted">
              أفكر…
            </p>
          )}
          <div ref={threadEndRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
          className="mt-5 flex gap-2"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="مثلاً: منو ما فتح التطبيق اليوم؟"
            maxLength={600}
            /* ⚠️ NOT disabled while busy. Disabling an input mid-conversation dismisses the
               Android keyboard — the same defect the storefront assistant already fixed. */
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-cream px-4 text-sm text-ink outline-none transition placeholder:text-muted focus:border-orange"
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
              onClick={() => void ask(ex)}
              className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft transition hover:border-orange hover:text-orange-ink disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
        </div>
      </section>

      {/* ── 4. THE DAILY REPORT ─────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-soft">تقرير الموظفين اليومي</h2>
          <input
            type="date"
            value={reportDate}
            max={report?.date}
            onChange={(e) => void loadReport(e.target.value)}
            className="h-10 rounded-xl border border-line bg-cream px-3 text-sm text-ink outline-none focus:border-orange"
          />
        </div>

        <p className="mt-2 text-xs leading-relaxed text-muted">
          «فتح التطبيق» و«البصمة» إشارتان منفصلتان عن بعض — الموظف اللي بصم بس ما فتح التطبيق هو
          الصف اللي يستاهل الانتباه. فتح التطبيق ما يأثر على الراتب أبداً.
        </p>

        <div className="mt-4 -mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[640px] text-start text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="px-3 py-2 text-start font-medium">الموظف</th>
                <th className="px-3 py-2 text-start font-medium">فتح التطبيق</th>
                <th className="px-3 py-2 text-start font-medium">حضور</th>
                <th className="px-3 py-2 text-start font-medium">انصراف</th>
                <th className="px-3 py-2 text-start font-medium">ساعات العمل</th>
                <th className="px-3 py-2 text-start font-medium">حركات إنتاج</th>
              </tr>
            </thead>
            <tbody>
              {reportBusy && !report && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted">
                    جاري التحميل…
                  </td>
                </tr>
              )}
              {report?.rows.map((r: StaffDayRow) => {
                // The row the owner is looking for: present in person, absent from the system.
                const ghost = Boolean(r.check_in_at) && !r.opened;
                return (
                  <tr
                    key={r.user_id}
                    className={`border-b border-line/60 ${ghost ? "bg-peach/30" : ""}`}
                  >
                    <td className="px-3 py-2.5 font-medium text-ink">{r.name}</td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {r.opened ? (
                        <span className="text-ink">
                          {toArabicDigits(r.opens)} مرة
                          {r.last_seen_at && (
                            <span className="text-muted"> · آخرها {fmtClock(r.last_seen_at)}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-danger">لا</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-ink-soft">
                      {fmtClock(r.check_in_at)}
                      {r.late_minutes > 0 && (
                        <span className="text-danger"> (تأخير {toArabicDigits(r.late_minutes)} د)</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-ink-soft">
                      {r.still_in ? <span className="text-green-600">لا زال بالدوام</span> : fmtClock(r.check_out_at)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-ink-soft">
                      {fmtHours(r.worked_minutes)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-ink-soft">
                      {toArabicDigits(r.production_actions)}
                    </td>
                  </tr>
                );
              })}
              {report && report.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted">
                    ماكو موظفين مسجّلين
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
