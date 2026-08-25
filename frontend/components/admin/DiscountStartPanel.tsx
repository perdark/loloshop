"use client";

/**
 * «ابدأ الخصومات» — the screen that starts a discount round.
 *
 * ⚠️ WHY THIS EXISTS AT ALL. Ending a round shipped first, so for three months the shop could
 * stop a discount but not start one. Starting meant hand-editing every product on
 * /admin/products — lower the price, then retype the old price into «السعر قبل الخصم» — two
 * edits per product, 51 products, no preview and no undo. Every round needed a developer.
 *
 * ⚠️ A PRODUCT ALREADY CARRYING A DISCOUNT IS SHOWN AND DISABLED, NEVER HIDDEN. Running a round
 * on it twice would store the already-discounted price as "the old price" and the real price
 * would be gone from the database for good — the one loss no ledger can undo. A product that
 * silently vanished from this list would read as a bug; one marked «مخصوم أصلاً» explains
 * itself and points at «إنهاء الخصومات» below.
 *
 * Mobile-first, like its sibling: every row is a ≥44px tap target and nothing needs a hover.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatIQD, toArabicDigits } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/api";
import {
  getDiscountCandidates,
  startDiscounts,
  type DiscountCandidate,
  type DiscountCandidates,
  type DiscountScope,
} from "@/lib/admin";

const SCOPE_LABEL: Record<DiscountScope, string> = {
  product: "السعر الأساسي",
  retail: "سعر الطلاب (مفرد)",
  wholesaler: "سعر الممثلين (جملة)",
};

/** The four `product_type` values, in the order the shop thinks about them. */
const TYPES: { key: string; label: string }[] = [
  { key: "sash", label: "أوشحة" },
  { key: "robe", label: "روبات" },
  { key: "cap", label: "قبعات" },
  { key: "shawl", label: "شالات" },
];

/** Every real round the shop has run moved by exactly this much. */
const DEFAULT_AMOUNT = 5000;

const cellKey = (id: string, scope: DiscountScope) => `${id}:${scope}`;

export function DiscountStartPanel() {
  const [data, setData] = useState<DiscountCandidates | null>(null);
  const [loading, setLoading] = useState(true);
  const [amountText, setAmountText] = useState(String(DEFAULT_AMOUNT));
  const [type, setType] = useState<string>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [startPromo, setStartPromo] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getDiscountCandidates();
      setData(next);
      setPicked(new Set());
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل المنتجات"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const amount = Number(amountText);
  const amountValid = Number.isInteger(amount) && amount > 0;

  const visible = useMemo(
    () => (data?.products ?? []).filter((p) => type === "all" || p.type === type),
    [data, type]
  );

  /** Products with at least one cell ticked — the round's actual subject. */
  const chosen = useMemo(() => {
    const out: { product: DiscountCandidate; scopes: DiscountScope[] }[] = [];
    for (const p of data?.products ?? []) {
      if (p.already_discounted) continue;
      const scopes = p.cells
        .map((c) => c.scope)
        .filter((s) => picked.has(cellKey(p.id, s)));
      if (scopes.length) out.push({ product: p, scopes });
    }
    return out;
  }, [data, picked]);

  /**
   * The refusal the server will issue, computed here so the button explains itself instead of
   * failing after the press. Mirrors planStart's ERR_AMOUNT_TOO_BIG.
   */
  const tooBig = useMemo(() => {
    if (!amountValid) return null;
    for (const { product, scopes } of chosen) {
      for (const c of product.cells) {
        if (scopes.includes(c.scope) && amount >= c.current_price) return product;
      }
    }
    return null;
  }, [chosen, amount, amountValid]);

  function toggleProduct(p: DiscountCandidate) {
    if (p.already_discounted) return;
    setPicked((prev) => {
      const next = new Set(prev);
      const on = p.cells.some((c) => next.has(cellKey(p.id, c.scope)));
      for (const c of p.cells) next.delete(cellKey(p.id, c.scope));
      // Ticking a product ticks the cell that IS its retail price — never سعر الجملة, which is
      // a separate, deliberate press below.
      if (!on) for (const s of p.default_scopes) next.add(cellKey(p.id, s));
      return next;
    });
  }

  function toggleCell(id: string, scope: DiscountScope) {
    setPicked((prev) => {
      const next = new Set(prev);
      const key = cellKey(id, scope);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Tick every still-discountable product in the current filter. */
  function pickAllVisible() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const p of visible) {
        if (p.already_discounted) continue;
        for (const s of p.default_scopes) next.add(cellKey(p.id, s));
      }
      return next;
    });
  }

  async function handleApply() {
    setSaving(true);
    try {
      const result = await startDiscounts({
        amount,
        products: chosen.map(({ product, scopes }) => ({
          id: product.id,
          expected_price: product.retail_price_now,
          scopes,
        })),
        activate_promo: startPromo,
      });
      toast.success(
        `تم — ${toArabicDigits(result.products_discounted)} منتج انخصم، و${toArabicDigits(
          result.prices_lowered
        )} سعر نزل`
      );
      setConfirming(false);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر بدء الخصومات"));
    } finally {
      setSaving(false);
    }
  }

  const blocked = !amountValid || chosen.length === 0 || tooBig !== null;

  return (
    <section dir="rtl" lang="ar" className="rounded-2xl border border-ink/10 bg-beige p-5 sm:p-7">
      <h2 className="mb-1.5 font-display text-xl font-bold tracking-tight text-ink">
        ابدأ الخصومات
      </h2>
      <p className="mb-5 text-xs leading-relaxed text-ink/50">
        اختر المنتجات وكم تريد تنزّل من سعر كل واحد. السعر الحالي ينحفظ تلقائياً كـ«السعر قبل
        الخصم» حتى يظهر مشطوب للزبون، وتقدر ترجعه من «إنهاء الخصومات» تحت. الطلبات المسجّلة ما
        تتأثر أبداً.
      </p>

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-16 w-full rounded-xl" />
          <div className="skeleton h-40 w-full rounded-xl" />
        </div>
      ) : !data ? null : (
        <div className="space-y-5">
          {/* How much comes off */}
          <div className="rounded-xl border border-orange/25 bg-orange/10 px-4 py-3">
            <label className="block text-xs font-semibold text-ink/70" htmlFor="discount-amount">
              كم تنزّل من سعر كل منتج؟
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="discount-amount"
                inputMode="numeric"
                dir="ltr"
                className="min-h-[44px] w-40 rounded-xl border border-ink/15 bg-white px-3 text-center text-base font-semibold tabular-nums text-ink"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, ""))}
              />
              <span className="text-sm text-ink/60">دينار</span>
            </div>
            {!amountValid && amountText !== "" && (
              <p className="mt-1.5 text-[11px] text-danger">اكتب مبلغ أكبر من صفر.</p>
            )}
          </div>

          {/* Filter by kind */}
          <div className="-mx-1 flex flex-wrap gap-2 px-1">
            {[{ key: "all", label: "الكل" }, ...TYPES].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setType(t.key)}
                className={`min-h-[36px] rounded-full border px-4 text-xs font-semibold transition ${
                  type === t.key
                    ? "border-orange bg-orange/20 text-ink"
                    : "border-ink/10 bg-white/60 text-ink/60"
                }`}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              onClick={pickAllVisible}
              className="min-h-[36px] rounded-full border border-ink/10 bg-white/60 px-4 text-xs font-semibold text-ink/60"
            >
              أشّر كل المعروض
            </button>
          </div>

          {visible.length === 0 ? (
            <div className="rounded-xl border border-ink/10 bg-white/60 px-4 py-5 text-center text-sm text-ink/60">
              ما في منتجات بهذا الصنف.
            </div>
          ) : (
            <ul className="space-y-2">
              {visible.map((p) => {
                const on = p.cells.some((c) => picked.has(cellKey(p.id, c.scope)));
                return (
                  <li
                    key={p.id}
                    className={`rounded-xl border px-4 py-3 ${
                      p.already_discounted
                        ? "border-ink/10 bg-ink/[0.03]"
                        : on
                          ? "border-orange/40 bg-white"
                          : "border-ink/10 bg-white/60"
                    }`}
                  >
                    <label
                      className={`flex min-h-[44px] items-start gap-3 ${
                        p.already_discounted ? "cursor-not-allowed" : "cursor-pointer"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-[var(--color-orange-ink)]"
                        checked={on}
                        disabled={p.already_discounted}
                        onChange={() => toggleProduct(p)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink">{p.name_ar}</span>
                        {p.already_discounted ? (
                          <span className="mt-0.5 block text-[11px] text-ink/50">
                            مخصوم أصلاً — أنهِ الخصم الحالي أول من «إنهاء الخصومات» تحت، وبعدين
                            ابدأ جولة جديدة.
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-xs tabular-nums text-ink/60">
                            {formatIQD(p.retail_price_now)}
                            {on && amountValid && amount < p.retail_price_now && (
                              <span className="text-orange-ink">
                                {" "}
                                ← {formatIQD(p.retail_price_now - amount)}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </label>

                    {/* Which exact cells move. Only shown once the product is in the round —
                        before that it is noise, and the default is right for almost every one. */}
                    {on && (
                      <ul className="mt-2 space-y-1 border-t border-ink/10 pt-2 ps-7">
                        {p.cells.map((c) => (
                          <li key={c.scope}>
                            <label className="flex min-h-[36px] cursor-pointer items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-1 h-3.5 w-3.5 accent-[var(--color-orange-ink)]"
                                checked={picked.has(cellKey(p.id, c.scope))}
                                onChange={() => toggleCell(p.id, c.scope)}
                              />
                              <span className="min-w-0 flex-1 text-[11px] text-ink">
                                <span className="font-medium">{SCOPE_LABEL[c.scope]}</span>
                                <span className="mt-0.5 block tabular-nums text-ink/60">
                                  {formatIQD(c.current_price)}
                                  {picked.has(cellKey(p.id, c.scope)) &&
                                    amountValid &&
                                    (amount < c.current_price ? (
                                      <span className="text-orange-ink">
                                        {" "}
                                        ← {formatIQD(c.current_price - amount)}
                                      </span>
                                    ) : (
                                      <span className="text-danger"> — الخصم أكبر من السعر</span>
                                    ))}
                                </span>
                                {c.scope === "wholesaler" && (
                                  <span className="mt-0.5 block text-[10px] text-danger">
                                    انتبه: سعر الجملة أصلاً أرخص من سعر المفرد. تنزيله يقلّل ربحك
                                    من كل طلب ممثل.
                                  </span>
                                )}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-ink/10 bg-white/60 px-4 py-3">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-orange-ink)]"
              checked={startPromo}
              onChange={(e) => setStartPromo(e.target.checked)}
            />
            <span className="text-sm text-ink">
              شغّل إعلان العروض
              <span className="mt-0.5 block text-[11px] text-ink/50">
                {data.promo.configured
                  ? "حتى يشوف الزبون إعلان الخصم بالصفحة الرئيسية."
                  : "ما مكتوب نص الإعلان بعد — اكتبه فوق بـ«إعلان العروض» حتى يشتغل."}
              </span>
            </span>
          </label>

          {tooBig && (
            <p className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-xs text-danger">
              الخصم أكبر من سعر «{tooBig.name_ar}» — نزّل المبلغ أو شيل هذا المنتج.
            </p>
          )}

          <Button
            variant="primary"
            fullWidth
            disabled={blocked}
            onClick={() => setConfirming(true)}
          >
            {chosen.length === 0
              ? "اختر منتج واحد على الأقل"
              : `نزّل ${toArabicDigits(chosen.length)} منتج ${formatIQD(amountValid ? amount : 0)}`}
          </Button>
        </div>
      )}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="تأكيد"
        footer={
          <>
            <Button variant="primary" fullWidth loading={saving} onClick={handleApply}>
              نعم، نزّل الأسعار
            </Button>
            <Button variant="ghost" fullWidth onClick={() => setConfirming(false)}>
              رجوع
            </Button>
          </>
        }
      >
        <div dir="rtl" className="space-y-3 text-sm text-ink">
          <p>
            راح ينزل سعر <b>{toArabicDigits(chosen.length)}</b> منتج بمقدار{" "}
            <b>{formatIQD(amountValid ? amount : 0)}</b>، وينحفظ سعرهم الحالي كـ«السعر قبل الخصم»
            {startPromo ? "، ويشتغل إعلان العروض" : ""}.
          </p>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-white/60 p-3 text-xs tabular-nums text-ink/70">
            {chosen.map(({ product }) => (
              <li key={product.id} className="flex items-center justify-between gap-3">
                <span className="truncate">{product.name_ar}</span>
                <span className="shrink-0">
                  {formatIQD(product.retail_price_now)} ←{" "}
                  <b className="text-orange-ink">
                    {formatIQD(product.retail_price_now - (amountValid ? amount : 0))}
                  </b>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink/60">
            الأسعار القديمة تنحفظ بسجل، فتقدر ترجعها كلها من «إنهاء الخصومات». الطلبات المسجّلة ما
            تتغيّر.
          </p>
        </div>
      </Modal>
    </section>
  );
}
