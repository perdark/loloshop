"use client";

/**
 * «إرسال إشعار» — the first notification in this system that a HUMAN writes.
 *
 * ⚠️ THERE IS NO UNSEND. Every other push in the shop is emitted by code because an event
 * happened, so the event bounded who received it. Here the sender picks, and a mis-pick reaches
 * every phone at once. Three things follow, and none of them is decoration:
 *
 *   1. The reach is resolved on the SERVER and shown before the send button does anything.
 *      «٣١٢ شخص · ١٩٤ جهاز» — the gap is normal: people without a device token still get the
 *      in-app bell, so hiding it would make the bell look broken.
 *   2. «الكل» demands the recipient count typed back. The server enforces it too; this is the
 *      copy of the rule the sender can actually see. It is asked ONLY for «الكل» — asking every
 *      time would train the sender to type numbers without reading them.
 *   3. The link is a picker, not a text box. The server refuses anything off its allowlist
 *      (an admin-composed push carrying an arbitrary URL is a phishing primitive wearing the
 *      shop's name), so a free-text field could only ever produce a rejected send.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { getApiErrorMessage } from "@/lib/api";
import { toArabicDigits } from "@/lib/format";
import {
  getPushHistory,
  getPushReach,
  sendPush,
  type PushAudienceKind,
  type PushBroadcastRow,
  type PushReach,
} from "@/lib/admin";
import { getAdminWholesalers } from "@/lib/admin";
import type { AdminWholesaler } from "@/lib/types";

const KINDS: { key: PushAudienceKind; label: string; hint: string }[] = [
  { key: "role", label: "حسب الدور", hint: "كل الطلاب، أو كل الممثلين، أو كل الموظفين." },
  { key: "university", label: "حسب الجامعة", hint: "كل طلاب جامعة معيّنة." },
  { key: "wholesaler", label: "طلاب ممثل", hint: "طلاب ممثل واحد — بدون الممثل نفسه." },
  { key: "all", label: "الكل", hint: "كل من عنده حساب. ما تنرجع بعد الإرسال." },
];

const ROLES: { key: string; label: string }[] = [
  { key: "retail", label: "الطلاب" },
  { key: "wholesaler", label: "الممثلون" },
  { key: "staff", label: "الموظفون" },
];

/** Mirrors the server's allowlist. A picker, not a text box — see the header. */
const LINKS: { value: string; label: string }[] = [
  { value: "", label: "بدون رابط" },
  { value: "/", label: "الصفحة الرئيسية" },
  { value: "/products", label: "المنتجات" },
  { value: "/cart", label: "السلة" },
  { value: "/orders", label: "الطلبات" },
  { value: "/design", label: "التصميم" },
  { value: "/wholesaler", label: "لوحة الممثل" },
  { value: "/staff", label: "لوحة الموظف" },
];

const TITLE_MAX = 80;
const BODY_MAX = 300;

const KIND_LABEL: Record<PushAudienceKind, string> = {
  all: "الكل",
  role: "دور",
  university: "جامعة",
  wholesaler: "طلاب ممثل",
  user: "شخص",
};

export function PushComposer() {
  const [kind, setKind] = useState<PushAudienceKind>("role");
  const [value, setValue] = useState<string>("retail");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [reach, setReach] = useState<PushReach | null>(null);
  const [reaching, setReaching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typedCount, setTypedCount] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<PushBroadcastRow[]>([]);
  const [reps, setReps] = useState<AdminWholesaler[]>([]);

  /** Guards against a slow reach response overwriting a newer one (the audience changed). */
  const reqRef = useRef(0);

  const audience = useMemo(
    () => ({ kind, value: kind === "all" ? undefined : value }),
    [kind, value]
  );

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await getPushHistory());
    } catch {
      /* history is context, never the point — a failure must not block sending */
    }
  }, []);

  useEffect(() => {
    loadHistory();
    getAdminWholesalers()
      .then(setReps)
      .catch(() => setReps([]));
  }, [loadHistory]);

  // Resolve the reach whenever the audience changes. Debounced, because «حسب الجامعة» is typed
  // and every keystroke would otherwise be a query.
  useEffect(() => {
    if (kind !== "all" && !value) {
      setReach(null);
      return;
    }
    const id = ++reqRef.current;
    setReaching(true);
    const t = setTimeout(async () => {
      try {
        const next = await getPushReach(audience);
        if (reqRef.current === id) setReach(next);
      } catch {
        if (reqRef.current === id) setReach(null);
      } finally {
        if (reqRef.current === id) setReaching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [audience, kind, value]);

  function switchKind(next: PushAudienceKind) {
    setKind(next);
    setTypedCount("");
    setValue(next === "role" ? "retail" : "");
  }

  async function handleSend() {
    setSending(true);
    try {
      const result = await sendPush({
        audience,
        title_ar: title.trim(),
        body_ar: body.trim() || undefined,
        link: link || undefined,
        confirmed_count: kind === "all" ? Number(typedCount) : undefined,
      });
      toast.success(
        `انرسل — ${toArabicDigits(result.people)} شخص، ${toArabicDigits(result.devices)} جهاز`
      );
      setConfirming(false);
      setTitle("");
      setBody("");
      setTypedCount("");
      await loadHistory();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إرسال الإشعار"));
    } finally {
      setSending(false);
    }
  }

  const needsValue = kind !== "all";
  const countOk = kind !== "all" || Number(typedCount) === reach?.people;
  const blocked =
    !title.trim() || (needsValue && !value) || !reach || reach.people === 0 || sending;

  return (
    <section dir="rtl" lang="ar" className="rounded-2xl border border-ink/10 bg-beige p-5 sm:p-7">
      <h2 className="font-display text-xl font-bold tracking-tight text-ink">إرسال إشعار</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-ink/50">
        الرسالة توصل إشعار على التلفون، وتنحفظ بجرس الإشعارات داخل التطبيق — يعني اللي تلفونه
        مطفي يشوفها بعدين. <b className="text-ink/70">ما في طريقة تلغي إشعار بعد ما ينرسل.</b>
      </p>

      <div className="mt-5 space-y-5">
        {/* Audience */}
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-ink/70">لمن يوصل؟</legend>
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => switchKind(k.key)}
                className={`min-h-[40px] rounded-full border px-4 text-xs font-semibold transition ${
                  kind === k.key
                    ? k.key === "all"
                      ? "border-danger/50 bg-danger/10 text-danger"
                      : "border-orange bg-orange/20 text-ink"
                    : "border-ink/10 bg-white/60 text-ink/60"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-ink/50">
            {KINDS.find((k) => k.key === kind)?.hint}
          </p>
        </fieldset>

        {kind === "role" && (
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setValue(r.key)}
                className={`min-h-[40px] rounded-xl border px-4 text-xs font-semibold ${
                  value === r.key
                    ? "border-orange bg-orange/20 text-ink"
                    : "border-ink/10 bg-white/60 text-ink/60"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        {kind === "university" && (
          <div>
            <input
              className="min-h-[44px] w-full rounded-xl border border-ink/15 bg-white px-3 text-sm text-ink"
              placeholder="اسم الجامعة أو جزء منه — مثلاً: ديالى"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink/50">
              نفس الجامعة مكتوبة بأكثر من صيغة بالحسابات، فالبحث يمسك أي اسم يحتوي اللي كتبته.
              تأكّد من عدد المستلمين تحت — هو الدليل الوحيد إن الكتابة مسكت الكل.
            </p>
          </div>
        )}

        {kind === "wholesaler" && (
          <select
            className="min-h-[44px] w-full rounded-xl border border-ink/15 bg-white px-3 text-sm text-ink"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">اختر ممثلاً…</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} {r.universityName ? `— ${r.universityName}` : ""}
              </option>
            ))}
          </select>
        )}

        {/* Reach */}
        <div
          className={`rounded-xl border px-4 py-3 ${
            kind === "all" ? "border-danger/30 bg-danger/5" : "border-orange/25 bg-orange/10"
          }`}
        >
          {reaching ? (
            <p className="text-sm text-ink/50">نحسب…</p>
          ) : !reach ? (
            <p className="text-sm text-ink/50">اختر الجمهور حتى نحسب كم شخص يوصله.</p>
          ) : (
            <>
              <p className="text-sm font-semibold tabular-nums text-ink">
                {toArabicDigits(reach.people)} شخص · {toArabicDigits(reach.devices)} جهاز
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink/60">
                {toArabicDigits(reach.devices)} منهم يوصلهم إشعار على التلفون هسه. الباقي يشوفون
                الرسالة بجرس الإشعارات أول ما يفتحون التطبيق.
              </p>
            </>
          )}
        </div>

        {/* The message */}
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink/70" htmlFor="push-title">
              العنوان
            </label>
            <input
              id="push-title"
              className="min-h-[44px] w-full rounded-xl border border-ink/15 bg-white px-3 text-sm text-ink"
              maxLength={TITLE_MAX}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً: آخر موعد للطلبات"
            />
            <p className="mt-1 text-[10px] tabular-nums text-ink/40">
              {toArabicDigits(title.length)}/{toArabicDigits(TITLE_MAX)}
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink/70" htmlFor="push-body">
              النص (اختياري)
            </label>
            <textarea
              id="push-body"
              rows={3}
              className="w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
              maxLength={BODY_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="mt-1 text-[10px] tabular-nums text-ink/40">
              {toArabicDigits(body.length)}/{toArabicDigits(BODY_MAX)}
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink/70" htmlFor="push-link">
              يفتح على
            </label>
            <select
              id="push-link"
              className="min-h-[44px] w-full rounded-xl border border-ink/15 bg-white px-3 text-sm text-ink"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            >
              {LINKS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-ink/40">
              الروابط محصورة بصفحات التطبيق — ما نقدر نرسل رابط خارجي.
            </p>
          </div>
        </div>

        <Button variant="primary" fullWidth disabled={blocked} onClick={() => setConfirming(true)}>
          {reach ? `ارسل لـ${toArabicDigits(reach.people)} شخص` : "ارسل"}
        </Button>
      </div>

      {/* What was sent before */}
      {history.length > 0 && (
        <div className="mt-7 border-t border-ink/10 pt-5">
          <h3 className="mb-3 text-xs font-semibold text-ink/70">آخر الإشعارات المرسلة</h3>
          <ul className="space-y-2">
            {history.slice(0, 6).map((b) => (
              <li key={b.id} className="rounded-xl border border-ink/10 bg-white/60 px-4 py-2.5">
                <p className="text-sm font-medium text-ink">{b.title_ar}</p>
                <p className="mt-0.5 text-[11px] tabular-nums text-ink/50">
                  {KIND_LABEL[b.audience_kind]}
                  {b.audience_value ? ` · ${b.audience_value}` : ""} · {toArabicDigits(b.people)}{" "}
                  شخص · {toArabicDigits(b.devices)} جهاز
                  {b.admin_name ? ` · ${b.admin_name}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="تأكيد الإرسال"
        footer={
          <>
            <Button
              variant={kind === "all" ? "danger" : "primary"}
              fullWidth
              loading={sending}
              disabled={!countOk}
              onClick={handleSend}
            >
              نعم، ارسل
            </Button>
            <Button variant="ghost" fullWidth onClick={() => setConfirming(false)}>
              رجوع
            </Button>
          </>
        }
      >
        <div dir="rtl" className="space-y-3 text-sm text-ink">
          <p>
            راح يوصل لـ<b>{toArabicDigits(reach?.people ?? 0)}</b> شخص (
            {toArabicDigits(reach?.devices ?? 0)} جهاز يستلم إشعار هسه).
          </p>
          <div className="rounded-xl bg-white/60 p-3">
            <p className="font-semibold">{title}</p>
            {body && <p className="mt-1 text-xs text-ink/70">{body}</p>}
          </div>
          {kind === "all" && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
              <p className="text-xs leading-relaxed text-danger">
                هذا يوصل <b>كل</b> من عنده حساب، وما ينلغى. اكتب عدد المستلمين (
                {toArabicDigits(reach?.people ?? 0)}) حتى تتأكد.
              </p>
              <input
                inputMode="numeric"
                dir="ltr"
                className="mt-2 min-h-[44px] w-full rounded-xl border border-danger/30 bg-white px-3 text-center text-base font-semibold tabular-nums text-ink"
                value={typedCount}
                onChange={(e) => setTypedCount(e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
          )}
          <p className="text-xs text-ink/60">
            الرسالة تنحفظ بجرس الإشعارات داخل التطبيق، فحتى اللي ما وصله إشعار يشوفها.
          </p>
        </div>
      </Modal>
    </section>
  );
}
