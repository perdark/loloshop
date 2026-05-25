"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AdminProductMedia } from "@/components/admin/AdminProductMedia";
import { PriceBreakdown } from "@/components/catalog/PriceBreakdown";
import { resolveCatalogMediaUrl } from "@/lib/catalog";
import Image from "next/image";
import {
  getProductFull,
  listCatalogProductsAdmin,
  setOptionPriceRole,
  setProductPriceRole,
  updateCatalogGroup,
  updateCatalogOption,
  uploadCatalogImage,
} from "@/lib/catalog";
import { getApiErrorMessage } from "@/lib/api";
import { computePriceBreakdown, type OptionSelection } from "@/lib/pricing";
import { PRODUCT_TYPE_LABELS } from "@/lib/constants";
import { formatIQD } from "@/lib/format";
import type {
  CatalogOptionGroup,
  CatalogProduct,
  CatalogProductSummary,
  PriceRole,
} from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageLoader } from "@/components/ui/Spinner";

export default function AdminProductsPage() {
  const [summaries, setSummaries] = useState<CatalogProductSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [previewRole, setPreviewRole] = useState<PriceRole>("retail");
  const [previewSel, setPreviewSel] = useState<OptionSelection>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await listCatalogProductsAdmin();
      setSummaries(list);
      if (!selectedId && list[0]) setSelectedId(list[0].id);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل الكتالوج"));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadProduct = useCallback(
    async (id: string, role: PriceRole) => {
      setLoadingProduct(true);
      try {
        const full = await getProductFull(id, role);
        setProduct(full);
        setPreviewSel({});
      } catch (e) {
        toast.error(getApiErrorMessage(e, "تعذر تحميل المنتج"));
        setProduct(null);
      } finally {
        setLoadingProduct(false);
      }
    },
    []
  );

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) loadProduct(selectedId, previewRole);
  }, [selectedId, previewRole, loadProduct]);

  const previewBreakdown = useMemo(() => {
    if (!product) return { lines: [], total: 0 };
    return computePriceBreakdown(product, previewSel, previewRole);
  }, [product, previewSel, previewRole]);

  async function persistGroup(
    groupId: string,
    patch: Partial<CatalogOptionGroup>
  ) {
    setSavingId(groupId);
    try {
      await updateCatalogGroup(groupId, {
        required: patch.required,
        has_image: patch.hasImage,
        hint_ar: patch.hintAr,
        image_url: patch.imageUrl,
        name_ar: patch.nameAr,
        requires_customer_image: patch.requiresCustomerImage,
      });
      if (selectedId) await loadProduct(selectedId, previewRole);
      toast.success("تم الحفظ");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر الحفظ"));
    } finally {
      setSavingId(null);
    }
  }

  async function persistOption(
    optionId: string,
    priceDelta: number,
    groupId: string
  ) {
    setSavingId(optionId);
    try {
      await updateCatalogOption(optionId, { price_delta: priceDelta });
      if (selectedId) await loadProduct(selectedId, previewRole);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحديث السعر"));
    } finally {
      setSavingId(null);
    }
  }

  async function persistOptionRole(
    optionId: string,
    role: PriceRole,
    priceDelta: number | null
  ) {
    setSavingId(`${optionId}-${role}`);
    try {
      await setOptionPriceRole(optionId, role, priceDelta);
      if (selectedId) await loadProduct(selectedId, previewRole);
      toast.success("تم تحديث سعر الدور");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحديث سعر الدور"));
    } finally {
      setSavingId(null);
    }
  }

  async function refreshProduct() {
    await loadList();
    if (selectedId) await loadProduct(selectedId, previewRole);
  }

  const selectedSummary = summaries.find((s) => s.id === selectedId);

  async function handleGroupImage(groupId: string, file: File) {
    try {
      const url = await uploadCatalogImage(file);
      await persistGroup(groupId, { imageUrl: url });
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر رفع الصورة"));
    }
  }

  if (loadingList) return <PageLoader />;

  return (
    <div dir="rtl" lang="ar" className="space-y-6">
      <PageHeader
        title="كتالوج المنتجات"
        subtitle="تحرير الخيارات والأسعار — معاينة تفصيل السعر"
      />

      <div className="grid gap-6 lg:grid-cols-[220px_1fr_260px]">
        <aside className="space-y-2">
          {summaries.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={`flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-right text-sm ${
                selectedId === p.id
                  ? "border-orange bg-orange/10 font-semibold text-orange"
                  : "border-ink/10 bg-beige hover:bg-peach/30"
              } ${!p.active ? "opacity-50" : ""}`}
            >
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-peach/40">
                {p.imageUrl ? (
                  <Image
                    src={resolveCatalogMediaUrl(p.imageUrl) || p.imageUrl}
                    alt=""
                    fill
                    className="object-cover"
                    unoptimized
                  />
                ) : null}
              </div>
              <span className="min-w-0 flex-1">
                {p.nameAr}
                <span className="mt-0.5 block text-xs font-normal text-ink/50">
                  {PRODUCT_TYPE_LABELS[p.type]} · {p.groupCount} مجموعة
                  {p.featured ? " · مميز" : ""}
                </span>
              </span>
            </button>
          ))}
        </aside>

        <section className="min-h-[320px] rounded-xl border border-ink/10 bg-beige p-5">
          {loadingProduct || !product ? (
            <PageLoader />
          ) : (
            <>
              <AdminProductMedia
                summary={selectedSummary}
                product={product}
                onUpdated={refreshProduct}
              />
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold text-ink">
                    {product.nameAr}
                  </h2>
                  <p className="text-sm text-ink/60">
                    أساس ({previewRole}): {formatIQD(product.basePrice)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {(["retail", "wholesaler"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setPreviewRole(r)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                        previewRole === r
                          ? "bg-orange text-white"
                          : "border border-neutral"
                      }`}
                    >
                      {r === "retail" ? "تجزئة" : "جملة"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4 flex gap-2">
                <Button
                  variant="ghost"
                  loading={savingId === "base-retail"}
                  onClick={async () => {
                    const v = prompt("سعر أساس تجزئة (د.ع)", String(product.basePrice));
                    if (v == null) return;
                    setSavingId("base-retail");
                    try {
                      await setProductPriceRole(product.id, "retail", Number(v));
                      await loadProduct(product.id, previewRole);
                    } catch (e) {
                      toast.error(getApiErrorMessage(e, "فشل"));
                    } finally {
                      setSavingId(null);
                    }
                  }}
                >
                  سعر تجزئة
                </Button>
                <Button
                  variant="ghost"
                  loading={savingId === "base-wh"}
                  onClick={async () => {
                    const v = prompt("سعر أساس جملة (د.ع)", String(product.basePrice));
                    if (v == null) return;
                    setSavingId("base-wh");
                    try {
                      await setProductPriceRole(product.id, "wholesaler", Number(v));
                      await loadProduct(product.id, previewRole);
                    } catch (e) {
                      toast.error(getApiErrorMessage(e, "فشل"));
                    } finally {
                      setSavingId(null);
                    }
                  }}
                >
                  سعر جملة
                </Button>
              </div>

              {product.optionGroups
                .sort((a, b) => a.sort - b.sort)
                .map((group) => (
                  <article
                    key={group.id}
                    className="mb-4 rounded-lg border border-ink/10 p-4"
                  >
                    <h3 className="font-semibold text-ink">
                      {group.nameAr}
                      <span className="mr-2 text-xs font-normal text-ink/50">
                        ({group.inputType})
                      </span>
                    </h3>

                    <div className="mt-2 flex flex-wrap gap-4 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={group.required}
                          disabled={savingId === group.id}
                          onChange={(e) =>
                            persistGroup(group.id, { required: e.target.checked })
                          }
                          className="accent-orange"
                        />
                        مطلوب
                      </label>
                    </div>

                    <div className="mt-3 rounded-lg border border-ink/10 bg-cream/60 p-3">
                      <p className="text-xs font-semibold text-ink/70">
                        صورة توضيحية للزبون (من الأدمن)
                      </p>
                      <div className="mt-2 flex flex-wrap gap-4 text-sm">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={group.hasImage}
                            disabled={savingId === group.id}
                            onChange={(e) =>
                              persistGroup(group.id, {
                                hasImage: e.target.checked,
                              })
                            }
                            className="accent-orange"
                          />
                          إظهار صورة توضيحية
                        </label>
                        <label className="text-xs text-ink/60">
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            id={`img-${group.id}`}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleGroupImage(group.id, f);
                            }}
                          />
                          <span
                            role="button"
                            tabIndex={0}
                            className="cursor-pointer text-orange underline"
                            onClick={() =>
                              document
                                .getElementById(`img-${group.id}`)
                                ?.click()
                            }
                          >
                            رفع صورة توضيحية
                          </span>
                        </label>
                      </div>
                      <Input
                        className="mt-2"
                        value={group.hintAr || ""}
                        placeholder="تلميح للطالب"
                        onBlur={(e) => {
                          if (e.target.value !== (group.hintAr || "")) {
                            persistGroup(group.id, {
                              hintAr: e.target.value || null,
                            });
                          }
                        }}
                      />
                    </div>

                    <div className="mt-3 rounded-lg border-2 border-orange/30 bg-orange/5 p-3">
                      <p className="text-xs font-semibold text-ink">
                        صورة مطلوبة من الزبون
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink/50">
                        يجب على الطالب رفع صورة عند اختيار أي خيار في هذه
                        المجموعة
                      </p>
                      <label className="mt-2 flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={group.requiresCustomerImage}
                          disabled={savingId === group.id}
                          onChange={(e) =>
                            persistGroup(group.id, {
                              requiresCustomerImage: e.target.checked,
                            })
                          }
                          className="accent-orange"
                        />
                        تفعيل على مستوى المجموعة
                      </label>
                    </div>

                    <ul className="mt-3 space-y-2">
                      {group.options.map((opt) => (
                        <li
                          key={opt.id}
                          className="flex flex-wrap items-center gap-2 rounded-lg bg-cream/60 px-3 py-2 text-sm"
                        >
                          <span className="min-w-[6rem] flex-1">{opt.labelAr}</span>
                          <Input
                            type="number"
                            className="max-w-[7rem]"
                            defaultValue={opt.priceDelta}
                            onBlur={(e) => {
                              const n = Number(e.target.value) || 0;
                              if (n !== opt.priceDelta) {
                                persistOption(opt.id, n, group.id);
                              }
                            }}
                          />
                          <Button
                            variant="ghost"
                            className="!min-h-8 !px-2 text-xs"
                            onClick={() => {
                              const v = prompt(
                                `سعر جملة لـ ${opt.labelAr}`,
                                String(opt.priceDelta)
                              );
                              if (v != null) {
                                persistOptionRole(
                                  opt.id,
                                  "wholesaler",
                                  Number(v)
                                );
                              }
                            }}
                          >
                            جملة
                          </Button>
                          <label className="flex w-full items-center gap-2 border-t border-ink/10 pt-2 text-xs text-ink/70">
                            <input
                              type="checkbox"
                              checked={opt.requiresCustomerImage}
                              disabled={savingId === opt.id}
                              onChange={async (e) => {
                                setSavingId(opt.id);
                                try {
                                  await updateCatalogOption(opt.id, {
                                    requires_customer_image: e.target.checked,
                                  });
                                  if (selectedId) {
                                    await loadProduct(selectedId, previewRole);
                                  }
                                  toast.success("تم الحفظ");
                                } catch (err) {
                                  toast.error(
                                    getApiErrorMessage(err, "تعذر الحفظ")
                                  );
                                } finally {
                                  setSavingId(null);
                                }
                              }}
                              className="accent-orange"
                            />
                            صورة مطلوبة من الزبون (لهذا الخيار)
                          </label>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
            </>
          )}
        </section>

        <aside className="space-y-4">
          {product && (
            <>
              <div className="rounded-xl border border-ink/10 bg-cream p-4">
                <p className="mb-2 text-sm font-semibold text-ink">معاينة الطالب</p>
                {product.optionGroups.map((g) => {
                  if (g.inputType === "single_select") {
                    return (
                      <label key={g.id} className="mb-2 block text-xs">
                        {g.nameAr}
                        <select
                          className="mt-1 w-full rounded border border-neutral px-2 py-1"
                          value={(previewSel[g.id] as string) || ""}
                          onChange={(e) =>
                            setPreviewSel((s) => ({
                              ...s,
                              [g.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">—</option>
                          {g.options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.labelAr}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  }
                  if (g.inputType === "toggle") {
                    return (
                      <label
                        key={g.id}
                        className="mb-2 flex items-center gap-2 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={!!previewSel[g.id]}
                          onChange={(e) =>
                            setPreviewSel((s) => ({
                              ...s,
                              [g.id]: e.target.checked,
                            }))
                          }
                        />
                        {g.nameAr}
                      </label>
                    );
                  }
                  if (g.inputType === "counter") {
                    return (
                      <label key={g.id} className="mb-2 block text-xs">
                        {g.nameAr}
                        <input
                          type="number"
                          min={0}
                          max={g.maxSelect ?? 99}
                          className="mt-1 w-full rounded border px-2 py-1"
                          value={Number(previewSel[g.id] || 0)}
                          onChange={(e) =>
                            setPreviewSel((s) => ({
                              ...s,
                              [g.id]: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                    );
                  }
                  return null;
                })}
              </div>
              <PriceBreakdown
                lines={previewBreakdown.lines}
                total={previewBreakdown.total}
              />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
