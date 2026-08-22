"use client";

/**
 * «إنهاء الخصومات» — the screen that ends a discount round.
 *
 * ⚠️ WHY THIS IS A SCREEN AND NOT A ONE-LINE MIGRATION.
 * Ending a discount is the only catalogue edit that RAISES a live price, across many products
 * at once, and the data cannot say which of two rounds was run:
 *   · the real prices were LOWERED and «السعر قبل الخصم» kept the old one  → put the prices back
 *   · the prices never moved and «السعر قبل الخصم» is a strike-through     → just clear it
 * Both look identical in the database (`compare_at_price > base_price` by the same amount), so
 * the choice belongs to the person who ran the round, made after seeing the real numbers. This
 * panel shows them, defaults conservatively, and writes only what is ticked.
 *
 * Mobile-first: the owner's own note for this work was «i don't have my laptop rn». Every row
 * is a ≥44px tap target and nothing depends on a hover state.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatIQD, toArabicDigits } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/api";
import {
  endDiscounts,
  getDiscountReport,
  type DiscountReport,
  type DiscountScope,
} from "@/lib/admin";

type Mode = "restore" | "clear_only";

const SCOPE_LABEL: Record<DiscountScope, string> = {
  product: "السعر الأساسي",
  retail: "سعر الطلاب (مفرد)",
  wholesaler: "سعر الممثلين (جملة)",
};

/** `${productId}:${scope}` — one key per price cell. */
const cellKey = (id: string, scope: DiscountScope) => `${id}:${scope}`;

export function DiscountRestorePanel() {
  const [report, setReport] = useState<DiscountReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("restore");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [stopPromo, setStopPromo] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * Default selection: the product-level price and the retail price, never the wholesaler one.
   * A wholesaler price sitting below the compare-at is usually the normal wholesale margin
   * rather than a discount, and raising it to a retail old-price would overcharge every rep.
   */
  const applyDefaults = useCallback((data: DiscountReport) => {
    const next = new Set<string>();
    for (const p of data.products) {
      for (const c of p.cells) {
        if (c.discounted && c.scope !== "wholesaler") next.add(cellKey(p.id, c.scope));
      }
    }
    setPicked(next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getDiscountReport();
      setReport(data);
      applyDefaults(data);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل الخصومات"));
    } finally {
      setLoading(false);
    }
  }, [applyDefaults]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id: string, scope: DiscountScope) {
    setPicked((prev) => {
      const next = new Set(prev);
      const key = cellKey(id, scope);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function switchMode(next: Mode) {
    setMode(next);
    if (next === "clear_only") setPicked(new Set());
    else if (report) applyDefaults(report);
  }

  async function handleApply() {
    if (!report) return;
    setSaving(true);
    try {
      const result = await endDiscounts({
        products: report.products.map((p) => ({
          id: p.id,
          expected_compare_at_price: p.compare_at_price,
          scopes:
            mode === "clear_only"
              ? []
              : p.cells
                  .filter((c) => picked.has(cellKey(p.id, c.scope)))
                  .map((c) => c.scope),
        })),
        deactivate_promo: stopPromo,
      });
      toast.success(
        `تم — ${toArabicDigits(result.prices_restored)} سعر رجع، و${toArabicDigits(
          result.products_cleared
        )} منتج انمسح عنه الخصم`
      );
      setConfirming(false);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إنهاء الخصومات"));
    } finally {
      setSaving(false);
    }
  }

  const pickedCount = mode === "clear_only" ? 0 : picked.size;

  return (
    <section
      dir="rtl"
      lang="ar"
      className="rounded-2xl border border-ink/10 bg-beige p-5 sm:p-7"
    >
      <h2 className="mb-1.5 font-display text-xl font-bold tracking-tight text-ink">
        إنهاء الخصومات
      </h2>
      <p className="mb-5 text-xs leading-relaxed text-ink/50">
        كل منتج عليه «سعر قبل الخصم». شوف الأرقام قبل ما تضغط — الأسعار القديمة تنحفظ
        وتقدر ترجعها. الطلبات المسجّلة ما تتأثر أبداً؛ سعرها محفوظ وقت الطلب.
      </p>

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-16 w-full rounded-xl" />
          <div className="skeleton h-24 w-full rounded-xl" />
        </div>
      ) : !report ? null : report.products.length === 0 ? (
        <div className="rounded-xl border border-ink/10 bg-white/60 px-4 py-5 text-center">
          <p className="text-sm font-semibold text-ink">ما في أي منتج عليه خصم.</p>
          <p className="mt-1 text-xs text-ink/50">
            {report.promo.live
              ? "بس إعلان العروض بعده شغّال — طفّيه من «الإعلانات والعروض» فوق."
              : "وإعلان العروض مطفي."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* What the round did, in one line */}
          <div className="rounded-xl border border-orange/25 bg-orange/10 px-4 py-3">
            <p className="text-sm font-semibold text-ink">
              {toArabicDigits(report.summary.products)} منتج عليه خصم
              {report.summary.uniform_delta != null && report.summary.uniform_delta > 0 ? (
                <> — الفرق {formatIQD(report.summary.uniform_delta)} لكل منتج</>
              ) : null}
            </p>
            <p className="mt-1 text-[11px] text-ink/60">
              {report.promo.live
                ? "إعلان العروض شغّال، يعني الخصم ظاهر للزباين هسه."
                : "إعلان العروض مطفي، يعني الخصم مو ظاهر للزباين — بس السعر القديم بعده مسجّل."}
            </p>
          </div>

          {/* The choice this panel exists to make */}
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-semibold text-ink/70">
              شنو تريد يصير بالأسعار؟
            </legend>
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-ink/10 bg-white/60 px-4 py-3">
              <input
                type="radio"
                name="discount-mode"
                className="mt-1 h-4 w-4 accent-[var(--color-orange-ink)]"
                checked={mode === "restore"}
                onChange={() => switchMode("restore")}
              />
              <span className="text-sm text-ink">
                رجّع الأسعار للسعر القديم
                <span className="mt-0.5 block text-[11px] text-ink/50">
                  إذا كنت نزّلت الأسعار وقت الخصم — هذا يرجعها مثل ما كانت.
                </span>
              </span>
            </label>
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-ink/10 bg-white/60 px-4 py-3">
              <input
                type="radio"
                name="discount-mode"
                className="mt-1 h-4 w-4 accent-[var(--color-orange-ink)]"
                checked={mode === "clear_only"}
                onChange={() => switchMode("clear_only")}
              />
              <span className="text-sm text-ink">
                الأسعار صحيحة — امسح السعر القديم بس
                <span className="mt-0.5 block text-[11px] text-ink/50">
                  إذا ما نزّلت الأسعار أصلاً وكان «السعر قبل الخصم» للعرض فقط.
                </span>
              </span>
            </label>
          </fieldset>

          {/* Per-product, per-cell */}
          <ul className="space-y-3">
            {report.products.map((p) => (
              <li
                key={p.id}
                className="rounded-xl border border-ink/10 bg-white/60 px-4 py-3"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink">{p.name_ar}</span>
                  {!p.active && (
                    <span className="shrink-0 rounded-full bg-ink/10 px-2 py-0.5 text-[10px] text-ink/60">
                      غير مفعّل
                    </span>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {p.cells.map((c) => {
                    const key = cellKey(p.id, c.scope);
                    const on = mode === "restore" && picked.has(key);
                    return (
                      <li key={key}>
                        <label
                          className={`flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-2 ${
                            c.discounted && mode === "restore"
                              ? "cursor-pointer hover:bg-orange/5"
                              : "opacity-60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-[var(--color-orange-ink)]"
                            checked={on}
                            disabled={!c.discounted || mode === "clear_only"}
                            onChange={() => toggle(p.id, c.scope)}
                          />
                          <span className="min-w-0 flex-1 text-xs text-ink">
                            <span className="font-medium">{SCOPE_LABEL[c.scope]}</span>
                            <span className="mt-0.5 block tabular-nums text-ink/60">
                              {c.discounted ? (
                                <>
                                  {formatIQD(c.current_price)} ← {formatIQD(c.compare_at_price)}
                                  <span className="text-orange-ink"> (+{formatIQD(c.delta)})</span>
                                </>
                              ) : (
                                <>{formatIQD(c.current_price)} — ما عليه خصم</>
                              )}
                            </span>
                            {c.scope === "wholesaler" && c.discounted && (
                              <span className="mt-0.5 block text-[10px] text-danger">
                                انتبه: سعر الجملة عادةً أرخص من سعر المفرد أصلاً. لا تأشّره إلا إذا
                                متأكد إنك نزّلته للخصم.
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>

          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-ink/10 bg-white/60 px-4 py-3">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-orange-ink)]"
              checked={stopPromo}
              onChange={(e) => setStopPromo(e.target.checked)}
            />
            <span className="text-sm text-ink">
              طفّي إعلان العروض بعد
              <span className="mt-0.5 block text-[11px] text-ink/50">
                حتى ما تظل الرسالة تقول «أسعار مخفّضة» بعد ما ترجع الأسعار.
              </span>
            </span>
          </label>

          <Button variant="primary" fullWidth onClick={() => setConfirming(true)}>
            {mode === "clear_only"
              ? "امسح الخصم عن كل المنتجات"
              : `رجّع ${toArabicDigits(pickedCount)} سعر وامسح الخصم`}
          </Button>
        </div>
      )}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="تأكيد"
        footer={
          <>
            <Button variant="danger" fullWidth loading={saving} onClick={handleApply}>
              نعم، نفّذ
            </Button>
            <Button variant="ghost" fullWidth onClick={() => setConfirming(false)}>
              رجوع
            </Button>
          </>
        }
      >
        <div dir="rtl" className="space-y-3 text-sm text-ink">
          <p>
            راح ينمسح «السعر قبل الخصم» عن{" "}
            <b>{toArabicDigits(report?.products.length ?? 0)}</b> منتج
            {pickedCount > 0 ? (
              <>
                ، وترجع <b>{toArabicDigits(pickedCount)}</b> سعر للسعر القديم
              </>
            ) : (
              <>، بدون أي تغيير بالأسعار</>
            )}
            {stopPromo ? "، ويطفي إعلان العروض" : ""}.
          </p>
          <p className="text-xs text-ink/60">
            الأسعار القديمة تنحفظ بسجل، فتقدر ترجعها. الطلبات القديمة ما تتغيّر.
          </p>
        </div>
      </Modal>
    </section>
  );
}
