"use client";

// «ولّد الكل بذكاء» — one press for a whole zone of a ممثل's students.
//
// Owner, 2026-09-26: «اجي واولد 300 اسم بدون تعب مو اشوف اقتراح اقتراح». So this screen shows
// the PLAN, not the lines: how many generate on their own, at which ornament level, how many
// follow the student's own photo, what it will roughly cost — and the short list the system
// refused to guess about. The per-line list is there, collapsed, for the designer who wants it.
//
// ⚠️ Nothing here is trusted by the server. `runSmart` re-resolves every line from the DB and
// the reference photo is always the line's own upload; this screen can only choose the text
// and the ornament, which is the same power the manual workbench already gives a designer.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { getApiErrorMessage } from "@/lib/api";
import { toArabicDigits } from "@/lib/format";
import {
  MIN_BATCH,
  ORNAMENT_LABEL,
  VARIANT_LABEL,
  planSmart,
  runSmart,
  type CalJob,
  type CalOrnament,
  type CalSmartPlan,
  type CalSmartRunItem,
  type CalVariant,
} from "@/lib/calligraphy";

const ORNAMENTS: CalOrnament[] = ["light", "medium", "rich", "none"];

// Mirror of backend lib/calligraphyPipeline.js `estimate()`, re-run here because the designer
// can move names between ornament groups, and every group is its own set of sheets. Same
// prices (measured 2026-09-26): a sheet ~$0.10, a single name or a photo-reference plate ~$0.068.
const SHEET_USD = 0.1;
const SOLO_USD = 0.068;
function estimateSpend(groups: Map<string, number>, references: number) {
  let sheets = 0;
  let usd = references * SOLO_USD;
  for (const n of groups.values()) {
    const full = Math.floor(n / MIN_BATCH);
    const rest = n % MIN_BATCH;
    sheets += full + (rest ? 1 : 0);
    usd += full * SHEET_USD + (rest === 1 ? SOLO_USD : rest ? SHEET_USD : 0);
  }
  return { sheets, references, usd };
}

function OrnamentPicker({
  value,
  onChange,
  defaultLabel,
}: {
  value: CalOrnament | null;
  onChange: (v: CalOrnament | null) => void;
  defaultLabel: string;
}) {
  const options: (CalOrnament | null)[] = [null, ...ORNAMENTS];
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => {
        const on = value === o;
        return (
          <button
            key={o ?? "default"}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o)}
            className={`min-h-11 rounded-full border px-3.5 text-sm font-semibold transition-colors ${
              on ? "border-ink bg-ink text-cream" : "border-line bg-white text-ink-soft hover:border-ink/40"
            }`}
          >
            {o ? ORNAMENT_LABEL[o] : defaultLabel}
          </button>
        );
      })}
    </div>
  );
}

export function SmartRunModal({
  open,
  variant,
  wholesalerId,
  wholesalerName,
  onClose,
  onStarted,
}: {
  open: boolean;
  variant: CalVariant;
  wholesalerId: string | null;
  wholesalerName?: string | null;
  onClose: () => void;
  onStarted: (job: CalJob) => Promise<void> | void;
}) {
  const [defaultOrn, setDefaultOrn] = useState<CalOrnament | null>(null);
  const [plan, setPlan] = useState<CalSmartPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ornOf, setOrnOf] = useState<Record<string, CalOrnament | null>>({});
  const [showAuto, setShowAuto] = useState(false);
  // What the «غيّر زخرفة الكل» row shows as picked: undefined = «مثل ما فهمها» (the plan as read).
  const [bulk, setBulk] = useState<CalOrnament | undefined>(undefined);
  const [excText, setExcText] = useState<Record<string, string>>({});
  const [excOn, setExcOn] = useState<Record<string, boolean>>({});

  function reset() {
    setPlan(null);
    setOrnOf({});
    setExcText({});
    setExcOn({});
    setShowAuto(false);
    setBulk(undefined);
  }

  async function analyse() {
    setLoading(true);
    try {
      const p = await planSmart(variant, wholesalerId, defaultOrn);
      setPlan(p);
      setOrnOf(Object.fromEntries(p.auto.map((a) => [a.order_item_id, a.ornament])));
      setExcText(Object.fromEntries(p.exceptions.map((e) => [e.order_item_id, e.proposed_text ?? ""])));
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر تحليل الطلبات"));
    } finally {
      setLoading(false);
    }
  }

  const included = useMemo(
    () => (plan ? plan.exceptions.filter((e) => excOn[e.order_item_id] && (excText[e.order_item_id] || "").trim()) : []),
    [plan, excOn, excText]
  );

  const byOrnament = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of plan?.auto ?? []) {
      const k = ornOf[a.order_item_id] ?? "default";
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }, [plan, ornOf]);

  async function start() {
    if (!plan) return;
    const items: CalSmartRunItem[] = [
      ...plan.auto.map((a) => ({
        order_item_id: a.order_item_id,
        render_text: a.render_text,
        element_text: a.element_text,
        ornament: ornOf[a.order_item_id] ?? null,
        use_reference: !!a.ref_image_url,
      })),
      ...included.map((e) => ({
        order_item_id: e.order_item_id,
        render_text: (excText[e.order_item_id] || "").trim(),
        ornament: e.ornament,
      })),
    ];
    if (!items.length) return;
    setStarting(true);
    try {
      const job = await runSmart(variant, items);
      reset();
      onClose();
      await onStarted(job);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر بدء التوليد"));
    } finally {
      setStarting(false);
    }
  }

  const total = (plan?.auto.length ?? 0) + included.length;
  const est = useMemo(() => {
    if (!plan) return null;
    const groups = new Map<string, number>();
    let references = 0;
    for (const a of plan.auto) {
      if (a.ref_image_url) { references += 1; continue; }
      const k = ornOf[a.order_item_id] ?? "";
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    for (const e of included) {
      const k = e.ornament ?? "";
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    return estimateSpend(groups, references);
  }, [plan, ornOf, included]);

  return (
    <Modal
      open={open}
      onClose={() => { if (!starting) { reset(); onClose(); } }}
      title={`ولّد الكل بذكاء — ${VARIANT_LABEL[variant]}`}
      footer={
        !plan ? (
          <>
            <Button variant="ghost" fullWidth onClick={() => { reset(); onClose(); }}>إلغاء</Button>
            <Button variant="primary" fullWidth loading={loading} onClick={analyse}>
              حلّل الطلبات
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" fullWidth disabled={starting} onClick={reset}>رجوع</Button>
            <Button variant="primary" fullWidth loading={starting} disabled={total < 1} onClick={start}>
              ولّد {toArabicDigits(total)} اسم
            </Button>
          </>
        )
      }
    >
      {!plan ? (
        <div className="space-y-4 text-sm">
          <p className="text-ink-soft leading-relaxed">
            يقرا كل طلب{wholesalerName ? <> لطلاب <span className="font-semibold text-ink">{wholesalerName}</span></> : " لطلاب الممثلين"}،
            ويفهم الاسم والزخرفة والصورة اللي طلبها الطالب، ويولّد الواضح لحاله.
            اللي ما ينفهم يوكف لك بقائمة قصيرة.
          </p>
          <div className="space-y-2">
            <p className="font-semibold text-ink">الزخرفة إذا الطالب ما حدّدها</p>
            <OrnamentPicker value={defaultOrn} onChange={setDefaultOrn} defaultLabel="حسب المكان" />
          </div>
          {loading && (
            <p className="rounded-xl bg-beige border border-line px-3 py-2.5 text-ink-soft">
              دا يقرا الطلبات… ياخذ تقريباً نص دقيقة لكل ١٠٠ طلب.
            </p>
          )}
        </div>
      ) : plan.counts.lines === 0 ? (
        <p className="text-sm text-ink-soft">ماكو طلبات بانتظار التوليد بهذا المكان.</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-line bg-white p-3">
              <p className="text-2xl font-bold text-ink">{toArabicDigits(plan.auto.length)}</p>
              <p className="text-ink-soft">يتولد تلقائياً</p>
            </div>
            <div className={`rounded-2xl border p-3 ${plan.exceptions.length ? "border-amber-200 bg-amber-50" : "border-line bg-white"}`}>
              <p className="text-2xl font-bold text-ink">{toArabicDigits(plan.exceptions.length)}</p>
              <p className="text-ink-soft">يحتاج نظرتك</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 text-xs">
            {Object.entries(byOrnament).map(([k, n]) => (
              <span key={k} className="rounded-full border border-line bg-beige px-2.5 py-1 font-semibold text-ink-soft">
                {k === "default" ? "زخرفة المكان" : `زخرفة ${ORNAMENT_LABEL[k as CalOrnament]}`}: {toArabicDigits(n)}
              </span>
            ))}
            {!!plan.counts.with_reference && (
              <span className="rounded-full border border-line bg-beige px-2.5 py-1 font-semibold text-ink-soft">
                مثل صورة الطالب: {toArabicDigits(plan.counts.with_reference)}
              </span>
            )}
          </div>

          {est && (
            <p className="text-ink-soft">
              الكلفة التقريبية: <span className="font-semibold text-ink">${est.usd.toFixed(2)}</span>
              {" "}({toArabicDigits(est.sheets)} ورقة{est.references ? ` + ${toArabicDigits(est.references)} لوحة بصورة الطالب` : ""})
            </p>
          )}

          {plan.auto.length > 0 && (
            <div className="space-y-2">
              <p className="font-semibold text-ink">غيّر زخرفة الكل</p>
              <OrnamentPicker
                value={bulk ?? null}
                defaultLabel="مثل ما فهمها"
                onChange={(o) => {
                  setBulk(o ?? undefined);
                  if (o === null) setOrnOf(Object.fromEntries(plan.auto.map((a) => [a.order_item_id, a.ornament])));
                  else setOrnOf(Object.fromEntries(plan.auto.map((a) => [a.order_item_id, o])));
                }}
              />
            </div>
          )}

          {plan.exceptions.length > 0 && (
            <div className="space-y-2">
              <p className="font-semibold text-amber-800">يحتاج نظرتك — ما يتولد إلا إذا أشرت عليه</p>
              <ul className="space-y-2">
                {plan.exceptions.map((e) => (
                  <li key={e.order_item_id} className="rounded-xl border border-amber-200 bg-white p-3 space-y-2">
                    <p className="break-words text-ink">«{e.student_text}»</p>
                    <p className="text-xs text-amber-800">
                      {[...e.flags, e.photo_note ? `الصورة: ${e.photo_note}` : ""].filter(Boolean).join(" · ") || e.why}
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label="ضيفه للتوليد"
                        className="size-5 shrink-0 accent-ink"
                        checked={!!excOn[e.order_item_id]}
                        disabled={!(excText[e.order_item_id] || "").trim()}
                        onChange={(ev) => setExcOn((m) => ({ ...m, [e.order_item_id]: ev.target.checked }))}
                      />
                      <input
                        dir="rtl"
                        value={excText[e.order_item_id] ?? ""}
                        placeholder="اكتب النص اللي ينكتب"
                        onChange={(ev) => {
                          const v = ev.target.value;
                          setExcText((m) => ({ ...m, [e.order_item_id]: v }));
                          if (!v.trim()) setExcOn((m) => ({ ...m, [e.order_item_id]: false }));
                        }}
                        className="min-h-11 w-full rounded-lg border border-line bg-cream px-3 text-ink"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.auto.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowAuto((v) => !v)}
                className="flex min-h-11 w-full items-center justify-between font-semibold text-ink"
              >
                <span>الأسماء اللي تتولد ({toArabicDigits(plan.auto.length)})</span>
                <span className="text-ink-soft">{showAuto ? "▾" : "◂"}</span>
              </button>
              {showAuto && (
                <ul className="divide-y divide-line rounded-xl border border-line bg-white">
                  {plan.auto.map((a) => (
                    <li key={a.order_item_id} className="flex items-center gap-2 p-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-semibold text-ink">
                          {a.render_text}
                          {a.element_text && <span className="font-normal text-ink-soft"> + {a.element_text}</span>}
                        </p>
                        {a.render_text.trim() !== a.student_text.trim() && (
                          <p className="break-words text-xs text-ink-soft">كتب: «{a.student_text}»</p>
                        )}
                        {a.ref_image_url && <p className="text-xs text-ink-soft">مثل صورة الطالب</p>}
                      </div>
                      <select
                        aria-label="مستوى الزخرفة"
                        value={ornOf[a.order_item_id] ?? ""}
                        onChange={(ev) => {
                          setBulk(undefined);
                          setOrnOf((m) => ({ ...m, [a.order_item_id]: (ev.target.value || null) as CalOrnament | null }));
                        }}
                        className="min-h-11 shrink-0 rounded-lg border border-line bg-cream px-2 text-sm text-ink"
                      >
                        <option value="">حسب المكان</option>
                        {ORNAMENTS.map((o) => <option key={o} value={o}>{ORNAMENT_LABEL[o]}</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
