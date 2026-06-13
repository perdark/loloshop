"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { AdminProductMedia } from "@/components/admin/AdminProductMedia";
import {
  createCatalogGroup,
  createCatalogOption,
  createCatalogProduct,
  deleteCatalogGroup,
  deleteCatalogOption,
  deleteCatalogProduct,
  getProductFull,
  listCatalogProductsAdmin,
  lockGroupOption,
  resolveCatalogMediaUrl,
  setOptionPriceRole,
  setProductPriceRole,
  unlockGroupOption,
  updateCatalogGroup,
  updateCatalogOption,
  updateCatalogProduct,
  uploadCatalogImage,
} from "@/lib/catalog";
import { getApiErrorMessage } from "@/lib/api";
import { computePriceBreakdown, type OptionSelection } from "@/lib/pricing";
import { PRODUCT_TYPE_LABELS } from "@/lib/constants";
import { formatIQD } from "@/lib/format";
import type {
  CatalogInputType,
  CatalogOptionGroup,
  CatalogProduct,
  CatalogProductSummary,
  PriceRole,
  ProductType,
} from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";

const INPUT_TYPE_LABELS: Record<CatalogInputType, string> = {
  single_select: "اختيار واحد",
  toggle: "تبديل",
  counter: "عدّاد",
};

const ROLE_LABELS: Record<PriceRole, string> = {
  retail: "تجزئة",
  wholesaler: "جملة",
};

/* Shared field styles so inline editors match the calm editorial surface. */
const fieldCls =
  "min-h-10 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink outline-none transition-colors focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/15";

/* ── Small line icon set (monochrome, 16px, inherits color) ── */
function Icon({ d, className = "" }: { d: React.ReactNode; className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {d}
    </svg>
  );
}

const TrashIcon = (
  <Icon
    d={
      <>
        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
        <path d="M10 11v6M14 11v6" />
      </>
    }
  />
);

const PlusIcon = (
  <Icon d={<><path d="M12 5v14M5 12h14" /></>} />
);

const PencilIcon = (
  <Icon d={<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>} />
);

/* A quiet labelled checkbox row used for group/option boolean settings. */
function CheckRow({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-orange-ink"
      />
      {children}
    </label>
  );
}

export default function AdminProductsPage() {
  const [summaries, setSummaries] = useState<CatalogProductSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [previewRole, setPreviewRole] = useState<PriceRole>("retail");
  const [previewSel, setPreviewSel] = useState<OptionSelection>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  // Inline name-edit state
  const [editingName, setEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState("");

  // Confirm-delete modals (replaces window.confirm)
  const [deleteProductTarget, setDeleteProductTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteOptionTarget, setDeleteOptionTarget] = useState<{ id: string; name: string } | null>(null);

  // Inline create-product form
  const [newOpen, setNewOpen] = useState(false);
  const [npType, setNpType] = useState<ProductType>("sash");
  const [npName, setNpName] = useState("");
  const [npPrice, setNpPrice] = useState("");
  const [npParent, setNpParent] = useState("");

  // Inline create-group form
  const [groupOpen, setGroupOpen] = useState(false);
  const [ngName, setNgName] = useState("");
  const [ngType, setNgType] = useState<CatalogInputType>("single_select");
  const [ngRequired, setNgRequired] = useState(false);

  // Inline create-option form (per group)
  const [optionForGroup, setOptionForGroup] = useState<string | null>(null);
  const [noLabel, setNoLabel] = useState("");
  const [noPrice, setNoPrice] = useState("");

  const loadList = useCallback(async (selectAfter?: string) => {
    setLoadingList(true);
    setListError(false);
    try {
      const list = await listCatalogProductsAdmin();
      setSummaries(list);
      setSelectedId((cur) => selectAfter ?? cur ?? list[0]?.id ?? null);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل الكتالوج"));
      setListError(true);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadProduct = useCallback(
    async (id: string, role: PriceRole, opts?: { silent?: boolean }) => {
      // Silent mode (post-save refresh): refetch data in the background without the
      // skeleton — keeps the editor mounted so focus, scroll, and inline edits survive.
      const silent = opts?.silent ?? false;
      if (!silent) setLoadingProduct(true);
      try {
        const full = await getProductFull(id, role);
        setProduct(full);
        if (!silent) setPreviewSel({});
      } catch (e) {
        toast.error(getApiErrorMessage(e, "تعذر تحميل المنتج"));
        if (!silent) setProduct(null);
      } finally {
        if (!silent) setLoadingProduct(false);
      }
    },
    []
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    loadList();
  }, [loadList]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on selection/role change
    setEditingName(false);
    if (selectedId) loadProduct(selectedId, previewRole);
    else setProduct(null);
  }, [selectedId, previewRole, loadProduct]);

  const previewBreakdown = useMemo(() => {
    if (!product) return { lines: [], total: 0 };
    return computePriceBreakdown(product, previewSel, previewRole);
  }, [product, previewSel, previewRole]);

  const reloadProduct = useCallback(() => {
    if (selectedId) return loadProduct(selectedId, previewRole, { silent: true });
    return Promise.resolve();
  }, [selectedId, previewRole, loadProduct]);

  const selectedSummary = summaries.find((s) => s.id === selectedId);
  const activeParents = summaries.filter((s) => !s.parentId && s.active);
  const parents = activeParents;
  const childrenOf = (pid: string) =>
    summaries.filter((s) => s.parentId === pid);
  const activeChildrenOf = (pid: string) =>
    summaries.filter((s) => s.parentId === pid && s.active);
  const inactiveProducts = summaries.filter((s) => !s.active);
  // parents list used in create form includes only active parents
  const activeParentsForSelect = summaries.filter((s) => !s.parentId && s.active);

  /* ── Actions ─────────────────────────────────────────── */

  async function run(id: string, fn: () => Promise<unknown>, ok?: string) {
    setSavingId(id);
    try {
      await fn();
      await reloadProduct();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر الحفظ"));
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreateProduct() {
    if (!npName.trim()) return toast.error("الاسم مطلوب");
    setSavingId("new-product");
    try {
      const { id } = await createCatalogProduct({
        type: npType,
        name_ar: npName.trim(),
        base_price: Number(npPrice) || 0,
        parent_id: npParent || null,
      });
      toast.success("تم إنشاء المنتج");
      setNewOpen(false);
      setNpName("");
      setNpPrice("");
      setNpParent("");
      setNpType("sash");
      await loadList(id);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر إنشاء المنتج"));
    } finally {
      setSavingId(null);
    }
  }

  function handleDeleteProduct() {
    if (!product) return;
    if (activeChildrenOf(product.id).length) {
      toast.error("احذف المنتجات الفرعية أولاً");
      return;
    }
    setDeleteProductTarget({ id: product.id, name: product.nameAr });
  }

  async function confirmDeleteProduct() {
    if (!deleteProductTarget) return;
    const { id } = deleteProductTarget;
    setDeleteProductTarget(null);
    setSavingId("delete-product");
    try {
      const result = await deleteCatalogProduct(id);
      if (result.mode === "archived") {
        toast.success("المنتج مرتبط بطلبات سابقة — تم نقله إلى المؤرشفة");
      } else {
        toast.success("تم حذف المنتج نهائياً");
      }
      const next = summaries.find((s) => s.id !== id && s.active)?.id ?? null;
      setSelectedId(next);
      await loadList(next ?? undefined);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حذف المنتج"));
    } finally {
      setSavingId(null);
    }
  }

  async function confirmDeleteGroup() {
    if (!deleteGroupTarget) return;
    const { id } = deleteGroupTarget;
    setDeleteGroupTarget(null);
    await run(id, () => deleteCatalogGroup(id));
    await loadList();
  }

  async function confirmDeleteOption() {
    if (!deleteOptionTarget) return;
    const { id } = deleteOptionTarget;
    setDeleteOptionTarget(null);
    await run(id, () => deleteCatalogOption(id));
  }

  async function commitNameEdit() {
    if (!product) return;
    const trimmed = editingNameValue.trim();
    setEditingName(false);
    if (!trimmed || trimmed === product.nameAr) return;
    await run(
      "name-edit",
      () => updateCatalogProduct(product.id, { name_ar: trimmed }),
      "تم تغيير الاسم"
    );
    await loadList();
  }

  async function handleCreateGroup() {
    if (!product) return;
    if (!ngName.trim()) return toast.error("الاسم مطلوب");
    setSavingId("new-group");
    try {
      await createCatalogGroup(product.id, {
        name_ar: ngName.trim(),
        input_type: ngType,
        required: ngRequired,
      });
      toast.success("تمت إضافة المجموعة");
      setGroupOpen(false);
      setNgName("");
      setNgType("single_select");
      setNgRequired(false);
      await Promise.all([reloadProduct(), loadList()]);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر إضافة المجموعة"));
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreateOption(groupId: string) {
    if (!noLabel.trim()) return toast.error("اسم الخيار مطلوب");
    setSavingId(`new-option-${groupId}`);
    try {
      await createCatalogOption(groupId, {
        label_ar: noLabel.trim(),
        price_delta: Number(noPrice) || 0,
      });
      setOptionForGroup(null);
      setNoLabel("");
      setNoPrice("");
      await reloadProduct();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر إضافة الخيار"));
    } finally {
      setSavingId(null);
    }
  }

  /** Commits an option price into whichever role is currently previewed. */
  function commitOptionPrice(optId: string, value: number) {
    if (previewRole === "wholesaler") {
      return run(optId, () => setOptionPriceRole(optId, "wholesaler", value));
    }
    return run(optId, () => updateCatalogOption(optId, { price_delta: value }));
  }

  function commitBasePrice(value: number) {
    if (!product) return;
    return run("base-price", () =>
      setProductPriceRole(product.id, previewRole, value)
    );
  }

  async function handleGroupImage(groupId: string, file: File) {
    setSavingId(groupId);
    try {
      const url = await uploadCatalogImage(file);
      await updateCatalogGroup(groupId, { image_url: url, has_image: true });
      await reloadProduct();
      toast.success("تم رفع الصورة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر رفع الصورة"));
    } finally {
      setSavingId(null);
    }
  }

  if (loadingList) return (
    <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in">
      <div className="skeleton h-8 w-48" />
      <div className="grid gap-8 lg:grid-cols-[256px_1fr_300px]">
        <div className="skeleton h-64 w-full rounded-2xl" />
        <div className="space-y-4">
          <div className="skeleton h-12 w-full rounded-2xl" />
          <div className="skeleton h-40 w-full rounded-2xl" />
          <div className="skeleton h-32 w-full rounded-2xl" />
        </div>
        <div className="skeleton h-64 w-full rounded-2xl" />
      </div>
    </div>
  );

  if (listError) return (
    <div dir="rtl" lang="ar" className="space-y-4">
      <header className="mb-9 border-b border-ink/15 pb-6">
        <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-ink lg:text-5xl">كتالوج المنتجات</h1>
      </header>
      <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
        <p className="text-base font-semibold text-ink">تعذر تحميل الكتالوج</p>
        <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
        <Button className="mt-4" onClick={() => loadList()}>إعادة المحاولة</Button>
      </div>
    </div>
  );

  return (
    <div dir="rtl" lang="ar" className="animate-page-in">
      {/* Masthead */}
      <header className="mb-9 flex flex-wrap items-end justify-between gap-4 border-b border-ink/15 pb-6">
        <div>
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-ink lg:text-5xl">
            كتالوج المنتجات
          </h1>
          <p className="mt-2.5 max-w-xl text-base text-ink-soft">
            الخيارات والأسعار، مع معاينة حية لتفصيل سعر الطالب
          </p>
        </div>
        <a
          href="/admin/packages"
          className="inline-flex min-h-10 items-center gap-2 rounded-full border border-orange/30 bg-orange/5 px-4 text-sm font-medium text-orange-ink transition-colors hover:bg-orange/10"
        >
          الباقات والأطقم
          <span aria-hidden>←</span>
        </a>
      </header>

      <div className="grid gap-8 lg:grid-cols-[256px_1fr_300px]">
        {/* ── Products rail — recessed swatch drawer ── */}
        <aside className="rounded-2xl border border-ink/10 bg-[var(--shop-sink)] p-3 lg:sticky lg:top-6 lg:self-start">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="font-display text-base font-bold text-ink">
              المنتجات
            </h2>
            <button
              type="button"
              onClick={() => setNewOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-orange-ink transition-colors hover:bg-orange/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink"
            >
              {PlusIcon} منتج
            </button>
          </div>

          {newOpen && (
            <div className="mb-4 space-y-2.5 rounded-xl border border-ink/10 bg-beige p-3">
              {/* Type select — disabled when parent is chosen (type follows parent) */}
              <div>
                <select
                  value={npType}
                  onChange={(e) => setNpType(e.target.value as ProductType)}
                  disabled={!!npParent}
                  className={`${fieldCls} w-full disabled:opacity-60`}
                >
                  {Object.entries(PRODUCT_TYPE_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                {npParent && (
                  <p className="mt-1 text-xs text-[var(--shop-muted)]">
                    النوع يتبع المنتج الأساسي
                  </p>
                )}
              </div>
              <input
                value={npName}
                onChange={(e) => setNpName(e.target.value)}
                placeholder="اسم المنتج"
                className={`${fieldCls} w-full`}
              />
              <input
                type="number"
                value={npPrice}
                onChange={(e) => setNpPrice(e.target.value)}
                placeholder="السعر الأساسي (د.ع)"
                dir="ltr"
                className={`${fieldCls} w-full text-right`}
              />
              <select
                value={npParent}
                onChange={(e) => {
                  const pid = e.target.value;
                  setNpParent(pid);
                  if (pid) {
                    const parentProduct = activeParentsForSelect.find((p) => p.id === pid);
                    if (parentProduct) setNpType(parentProduct.type);
                  }
                }}
                className={`${fieldCls} w-full`}
              >
                <option value="">منتج مستقل (بدون أساسي)</option>
                {activeParentsForSelect.map((p) => (
                  <option key={p.id} value={p.id}>
                    منتج فرعي لـ: {p.nameAr}
                  </option>
                ))}
              </select>
              <div className="flex gap-2 pt-0.5">
                <Button
                  size="sm"
                  className="flex-1"
                  loading={savingId === "new-product"}
                  onClick={handleCreateProduct}
                >
                  إنشاء
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setNewOpen(false); setNpParent(""); setNpType("sash"); }}
                >
                  إلغاء
                </Button>
              </div>
            </div>
          )}

          <nav className="space-y-1">
            {parents.map((p) => {
              const kids = activeChildrenOf(p.id);
              return (
                <div key={p.id}>
                  <ProductRailItem
                    summary={p}
                    selected={selectedId === p.id}
                    isParent={kids.length > 0}
                    onSelect={() => setSelectedId(p.id)}
                    onAddChild={() => {
                      setNpParent(p.id);
                      setNpType(p.type);
                      setNpName("");
                      setNpPrice("");
                      setNewOpen(true);
                    }}
                  />
                  {kids.map((c) => (
                    <ProductRailItem
                      key={c.id}
                      summary={c}
                      selected={selectedId === c.id}
                      child
                      onSelect={() => setSelectedId(c.id)}
                    />
                  ))}
                </div>
              );
            })}
            {!parents.length && (
              <EmptyState message="لا توجد منتجات بعد — أضف منتجاً للبدء." />
            )}
          </nav>

          {/* Archived products disclosure */}
          {inactiveProducts.length > 0 && (
            <ArchivedSection
              products={inactiveProducts}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRestore={async (id) => {
                await run(
                  `restore-${id}`,
                  () => updateCatalogProduct(id, { active: true }),
                  "تمت استعادة المنتج"
                );
                await loadList();
              }}
            />
          )}
        </aside>

        {/* ── Editor ── */}
        <section className="min-w-0">
          {loadingProduct || !product ? (
            <div className="space-y-4 animate-fade-page-in" aria-hidden>
              <div className="skeleton h-10 w-64 rounded-xl" />
              <div className="skeleton h-36 w-full rounded-2xl" />
              <div className="skeleton h-24 w-full rounded-2xl" />
              <div className="skeleton h-48 w-full rounded-2xl" />
            </div>
          ) : (
            <div className="space-y-8">
              <AdminProductMedia
                summary={selectedSummary}
                product={product}
                onUpdated={() => {
                  reloadProduct();
                  loadList();
                }}
              />

              {/* Product header */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink/10 pb-6">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    {editingName ? (
                      <input
                        autoFocus
                        value={editingNameValue}
                        onChange={(e) => setEditingNameValue(e.target.value)}
                        onBlur={commitNameEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); commitNameEdit(); }
                          if (e.key === "Escape") { setEditingName(false); }
                        }}
                        disabled={savingId === "name-edit"}
                        className={`${fieldCls} font-display text-3xl font-bold leading-tight w-64`}
                        aria-label="تعديل اسم المنتج"
                      />
                    ) : (
                      <h2 className="font-display text-3xl font-bold leading-tight text-ink">
                        {product.nameAr}
                      </h2>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingNameValue(product.nameAr);
                        setEditingName(true);
                      }}
                      disabled={savingId === "name-edit"}
                      aria-label="تعديل اسم المنتج"
                      className="rounded-full p-1.5 text-ink-soft transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-50"
                    >
                      {PencilIcon}
                    </button>
                    <span className="rounded-full bg-ink/[0.06] px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                      {PRODUCT_TYPE_LABELS[product.type]}
                    </span>
                  </div>
                  {product.parentNameAr && (
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1 text-sm text-orange-ink hover:underline"
                      onClick={() =>
                        product.parentId && setSelectedId(product.parentId)
                      }
                    >
                      منتج فرعي لـ: {product.parentNameAr}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleDeleteProduct}
                  disabled={savingId === "delete-product"}
                  className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 px-3.5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50"
                >
                  {TrashIcon} حذف المنتج
                </button>
              </div>

              {/* Price band: role tabs + inline base price for that role */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-[var(--shop-muted)]">
                    السعر الأساسي · {ROLE_LABELS[previewRole]}
                  </p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <input
                      key={`base-${product.id}-${previewRole}`}
                      type="number"
                      defaultValue={product.basePrice}
                      dir="ltr"
                      disabled={savingId === "base-price"}
                      onBlur={(e) => {
                        const n = Number(e.target.value) || 0;
                        if (n !== product.basePrice) commitBasePrice(n);
                      }}
                      className={`${fieldCls} w-40 text-2xl font-bold tabular-nums`}
                    />
                    <span className="text-sm text-[var(--shop-muted)]">د.ع</span>
                  </div>
                </div>
                <div
                  className="inline-flex gap-1 rounded-full bg-ink/[0.05] p-1"
                  role="tablist"
                  aria-label="دور التسعير"
                >
                  {(["retail", "wholesaler"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="tab"
                      aria-selected={previewRole === r}
                      onClick={() => setPreviewRole(r)}
                      className={`min-h-9 rounded-full px-5 py-1.5 text-sm font-semibold transition-colors ${
                        previewRole === r
                          ? "bg-orange-ink text-white"
                          : "text-ink-soft hover:text-ink"
                      }`}
                    >
                      {ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Audience / visibility — 3-way radio */}
              {(() => {
                type AudienceChoice = "all" | "wholesaler" | "retail";
                const current: AudienceChoice = product.wholesalerOnly
                  ? "wholesaler"
                  : product.retailOnly
                  ? "retail"
                  : "all";
                const audienceOptions: { value: AudienceChoice; label: string; hint: string }[] = [
                  {
                    value: "all",
                    label: "متاح للجميع",
                    hint: "يظهر لجميع الطلاب بغض النظر عن طريقة التسجيل.",
                  },
                  {
                    value: "wholesaler",
                    label: "خاص بطلاب الممثل فقط",
                    hint: "يظهر فقط للطلاب المنضمين عبر رابط الممثل.",
                  },
                  {
                    value: "retail",
                    label: "خاص بطلاب التجزئة فقط",
                    hint: "يظهر فقط للطلاب العاديين، ويُخفى عن طلاب الممثلين.",
                  },
                ];
                const isBusy = savingId === "audience";
                return (
                  <div className="rounded-2xl border border-ink/10 bg-[var(--shop-sink)] p-4">
                    <p className="mb-3 text-sm font-semibold text-ink">الجمهور المستهدف</p>
                    <div className="space-y-3" role="radiogroup" aria-label="الجمهور المستهدف">
                      {audienceOptions.map((opt) => (
                        <label key={opt.value} className="flex cursor-pointer items-start gap-2.5">
                          <input
                            type="radio"
                            name="audience"
                            value={opt.value}
                            checked={current === opt.value}
                            disabled={isBusy}
                            onChange={() => {
                              const patch =
                                opt.value === "wholesaler"
                                  ? { wholesaler_only: true, retail_only: false }
                                  : opt.value === "retail"
                                  ? { retail_only: true, wholesaler_only: false }
                                  : { wholesaler_only: false, retail_only: false };
                              run("audience", () => updateCatalogProduct(product.id, patch), opt.label);
                            }}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-orange-ink"
                          />
                          <span>
                            <span className="block text-sm text-ink">{opt.label}</span>
                            <span className="block text-xs text-[var(--shop-muted)]">{opt.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Option groups */}
              <div>
                <div className="section-heading mb-1">
                  <h3 className="shrink-0 font-display text-xl font-bold text-ink">
                    مجموعات الخيارات
                  </h3>
                </div>

                {product.optionGroups
                  .slice()
                  .sort((a, b) => a.sort - b.sort)
                  .map((group) => (
                    <GroupBlock
                      key={group.id}
                      group={group}
                      product={product}
                      previewRole={previewRole}
                      savingId={savingId}
                      fieldCls={fieldCls}
                      optionForGroup={optionForGroup}
                      noLabel={noLabel}
                      noPrice={noPrice}
                      setOptionForGroup={setOptionForGroup}
                      setNoLabel={setNoLabel}
                      setNoPrice={setNoPrice}
                      onCreateOption={handleCreateOption}
                      onPersistGroup={(patch) =>
                        run(
                          group.id,
                          () => updateCatalogGroup(group.id, patch),
                          "تم الحفظ"
                        )
                      }
                      onDeleteGroup={() => {
                        setDeleteGroupTarget({ id: group.id, name: group.nameAr });
                      }}
                      onGroupImage={handleGroupImage}
                      onCommitOptionPrice={commitOptionPrice}
                      onToggleOptionImage={(optId, v) =>
                        run(
                          optId,
                          () =>
                            updateCatalogOption(optId, {
                              requires_customer_image: v,
                            }),
                          "تم الحفظ"
                        )
                      }
                      onToggleOptionText={(optId, v) =>
                        run(
                          optId,
                          () =>
                            updateCatalogOption(optId, {
                              requires_customer_text: v,
                            }),
                          "تم الحفظ"
                        )
                      }
                      onDeleteOption={(optId, label) => {
                        setDeleteOptionTarget({ id: optId, name: label });
                      }}
                      onRenameOption={(optId, newLabel) =>
                        run(
                          optId,
                          () => updateCatalogOption(optId, { label_ar: newLabel }),
                          "تم تغيير الاسم"
                        )
                      }
                      onLockOption={(optId) =>
                        run(
                          `lock-${group.id}`,
                          () =>
                            optId
                              ? lockGroupOption(product.id, group.id, optId)
                              : unlockGroupOption(product.id, group.id),
                          "تم الحفظ"
                        )
                      }
                    />
                  ))}

                {/* Add group */}
                {groupOpen ? (
                  <div className="mt-6 space-y-3 rounded-xl border border-ink/10 bg-beige p-4">
                    <input
                      value={ngName}
                      onChange={(e) => setNgName(e.target.value)}
                      placeholder="اسم المجموعة (مثل: اللون)"
                      className={`${fieldCls} w-full`}
                    />
                    <div className="flex flex-wrap gap-3">
                      <select
                        value={ngType}
                        onChange={(e) =>
                          setNgType(e.target.value as CatalogInputType)
                        }
                        className={fieldCls}
                      >
                        {Object.entries(INPUT_TYPE_LABELS).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <CheckRow checked={ngRequired} onChange={setNgRequired}>
                        مطلوب
                      </CheckRow>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        loading={savingId === "new-group"}
                        onClick={handleCreateGroup}
                      >
                        إضافة المجموعة
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setGroupOpen(false)}
                      >
                        إلغاء
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setGroupOpen(true)}
                    className="mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/20 py-3 text-sm font-semibold text-ink-soft transition-colors hover:border-orange/40 hover:text-orange-ink"
                  >
                    {PlusIcon} إضافة مجموعة خيارات
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── Live student preview — framed lookbook proof ── */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          {product && (
            <div className="overflow-hidden rounded-2xl border border-ink/15 bg-beige shadow-[var(--shadow-soft)]">
              {/* Proof header */}
              <div className="flex items-center justify-between border-b border-ink/10 bg-[var(--shop-sink)] px-4 py-2.5">
                <span className="font-display text-sm font-bold text-ink">
                  معاينة الطالب
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-orange-ink" aria-hidden />
              </div>

              {/* Hero price — the one number that matters */}
              <div className="border-b border-ink/10 px-4 pb-4 pt-3.5">
                <p className="text-xs font-medium text-[var(--shop-muted)]">
                  سعر الطالب · {ROLE_LABELS[previewRole]}
                </p>
                <p
                  dir="ltr"
                  className="mt-1.5 text-[2.4rem] font-bold leading-none text-orange-ink"
                  style={{ fontFamily: "var(--font-amiri)" }}
                >
                  {formatIQD(previewBreakdown.total)}
                </p>
              </div>

              {/* Option selectors */}
              <div className="px-4 pb-1 pt-3.5">
                {product.optionGroups.length === 0 && (
                  <p className="py-2 text-xs text-[var(--shop-muted)]">
                    أضف مجموعة خيارات لتظهر هنا
                  </p>
                )}
                {product.optionGroups.map((g) => {
                  if (g.inputType === "single_select") {
                    return (
                      <label key={g.id} className="mb-3 block text-xs text-ink-soft">
                        {g.nameAr}
                        <select
                          className={`${fieldCls} mt-1 w-full`}
                          value={(previewSel[g.id] as string) || ""}
                          onChange={(e) =>
                            setPreviewSel((s) => ({ ...s, [g.id]: e.target.value }))
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
                        className="mb-3 flex items-center gap-2 text-xs text-ink-soft"
                      >
                        <input
                          type="checkbox"
                          checked={!!previewSel[g.id]}
                          onChange={(e) =>
                            setPreviewSel((s) => ({ ...s, [g.id]: e.target.checked }))
                          }
                          className="h-4 w-4 accent-orange-ink"
                        />
                        {g.nameAr}
                      </label>
                    );
                  }
                  return (
                    <label key={g.id} className="mb-3 block text-xs text-ink-soft">
                      {g.nameAr}
                      <input
                        type="number"
                        min={0}
                        max={g.maxSelect ?? 99}
                        className={`${fieldCls} mt-1 w-full`}
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
                })}
              </div>

              {/* Itemised proof — no nested card; the hero above carries the total */}
              <div className="border-t border-ink/10 px-4 py-3.5">
                <p className="mb-2.5 text-xs font-semibold text-ink">تفاصيل السعر</p>
                <ul className="space-y-2 text-sm">
                  {previewBreakdown.lines.map((line) => (
                    <li
                      key={line.key}
                      className="flex justify-between gap-2 text-ink/75"
                    >
                      <span>{line.label}</span>
                      <span className="tabular-nums" dir="ltr">
                        {formatIQD(line.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ── Confirm: delete product ── */}
      <Modal
        open={!!deleteProductTarget}
        onClose={() => setDeleteProductTarget(null)}
        title="تأكيد حذف المنتج"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteProductTarget(null)}>إلغاء</Button>
            <Button variant="danger" onClick={confirmDeleteProduct} loading={savingId === "delete-product"}>
              حذف «{deleteProductTarget?.name}»
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          سيُحذف المنتج «{deleteProductTarget?.name}» من المتجر. إذا كان مرتبطاً بطلبات سابقة، سيُنقل إلى الأرشيف بدلاً من الحذف النهائي.
        </p>
      </Modal>

      {/* ── Confirm: delete group ── */}
      <Modal
        open={!!deleteGroupTarget}
        onClose={() => setDeleteGroupTarget(null)}
        title="تأكيد حذف المجموعة"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteGroupTarget(null)}>إلغاء</Button>
            <Button variant="danger" onClick={confirmDeleteGroup}>
              حذف «{deleteGroupTarget?.name}»
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          ستُحذف مجموعة «{deleteGroupTarget?.name}» وجميع خياراتها. لا يمكن التراجع.
        </p>
      </Modal>

      {/* ── Confirm: delete option ── */}
      <Modal
        open={!!deleteOptionTarget}
        onClose={() => setDeleteOptionTarget(null)}
        title="تأكيد حذف الخيار"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOptionTarget(null)}>إلغاء</Button>
            <Button variant="danger" onClick={confirmDeleteOption}>
              حذف «{deleteOptionTarget?.name}»
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          سيُحذف الخيار «{deleteOptionTarget?.name}» نهائياً. لا يمكن التراجع.
        </p>
      </Modal>
    </div>
  );
}

/* ── Products rail item ── */
function ProductRailItem({
  summary,
  selected,
  isParent,
  child,
  onSelect,
  onAddChild,
}: {
  summary: CatalogProductSummary;
  selected: boolean;
  isParent?: boolean;
  child?: boolean;
  onSelect: () => void;
  onAddChild?: () => void;
}) {
  return (
    <div className={`flex items-center gap-0.5 ${child ? "ms-3" : ""}`}>
      <button
        type="button"
        onClick={onSelect}
        className={`flex flex-1 min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-right transition-colors ${
          child ? "border-s border-ink/10 ps-3" : ""
        } ${
          selected
            ? "bg-orange/10 font-semibold text-orange-ink"
            : "text-ink hover:bg-[var(--shop-sink)]"
        }`}
      >
        <span
          className={`relative shrink-0 overflow-hidden rounded-md bg-peach/40 ${
            child ? "h-8 w-8" : "h-10 w-10"
          }`}
        >
          {summary.imageUrl && (
            <Image
              src={resolveCatalogMediaUrl(summary.imageUrl) || summary.imageUrl}
              alt=""
              fill
              className="object-cover"
              unoptimized
            />
          )}
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <span className="block truncate">{summary.nameAr}</span>
          <span className="mt-0.5 block text-xs font-normal text-[var(--shop-muted)]">
            {PRODUCT_TYPE_LABELS[summary.type]} · {summary.groupCount} مجموعة
          </span>
        </span>
        {isParent && (
          <span className="shrink-0 rounded-full bg-orange/15 px-2 py-0.5 text-[10px] font-semibold text-orange-ink">
            أساسي
          </span>
        )}
      </button>
      {onAddChild && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAddChild(); }}
          aria-label={`إضافة منتج فرعي لـ ${summary.nameAr}`}
          className="shrink-0 rounded-full p-1.5 text-ink-soft transition-colors hover:bg-orange/10 hover:text-orange-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          {PlusIcon}
        </button>
      )}
    </div>
  );
}

/* ── Archived products disclosure ── */
function ArchivedSection({
  products,
  selectedId,
  onSelect,
  onRestore,
}: {
  products: CatalogProductSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mt-3 border-t border-ink/10 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-1 py-1 text-xs text-[var(--shop-muted)] hover:text-ink-soft transition-colors"
        aria-expanded={open}
      >
        <span>المؤرشفة ({products.length})</span>
        <span aria-hidden className="transition-transform" style={{ display: "inline-block", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {products.map((p) => (
            <li key={p.id} className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[var(--shop-muted)] hover:bg-[var(--shop-sink)] transition-colors">
              <button
                type="button"
                className="flex-1 min-w-0 text-right text-xs truncate"
                onClick={() => onSelect(p.id)}
              >
                {p.nameAr}
              </button>
              <button
                type="button"
                onClick={() => onRestore(p.id)}
                className="shrink-0 rounded-full border border-ink/15 px-2 py-0.5 text-[10px] font-medium text-ink-soft hover:border-orange/40 hover:text-orange-ink transition-colors"
              >
                استعادة
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── A single option group with its options + inline add-option ── */
function GroupBlock({
  group,
  product,
  previewRole,
  savingId,
  fieldCls,
  optionForGroup,
  noLabel,
  noPrice,
  setOptionForGroup,
  setNoLabel,
  setNoPrice,
  onCreateOption,
  onPersistGroup,
  onDeleteGroup,
  onGroupImage,
  onCommitOptionPrice,
  onToggleOptionImage,
  onToggleOptionText,
  onDeleteOption,
  onRenameOption,
  onLockOption,
}: {
  group: CatalogOptionGroup;
  product: CatalogProduct;
  previewRole: PriceRole;
  savingId: string | null;
  fieldCls: string;
  optionForGroup: string | null;
  noLabel: string;
  noPrice: string;
  setOptionForGroup: (v: string | null) => void;
  setNoLabel: (v: string) => void;
  setNoPrice: (v: string) => void;
  onCreateOption: (groupId: string) => void;
  onPersistGroup: (patch: Record<string, unknown>) => void;
  onDeleteGroup: () => void;
  onGroupImage: (groupId: string, file: File) => void;
  onToggleOptionText: (optId: string, v: boolean) => void;
  onCommitOptionPrice: (optId: string, value: number) => void;
  onToggleOptionImage: (optId: string, v: boolean) => void;
  onDeleteOption: (optId: string, label: string) => void;
  /** Rename an option label (non-inherited groups only). */
  onRenameOption: (optId: string, newLabel: string) => void;
  /** Pass an option id to lock the group to it, or null to clear the lock. */
  onLockOption: (optId: string | null) => void;
}) {
  const inherited = !!group.inherited;
  const busy = savingId === group.id;
  const lockBusy = savingId === `lock-${group.id}`;
  const lockedOptionId = group.lockedOptionId ?? null;
  const lockedOption = group.options.find((o) => o.id === lockedOptionId);

  // Inline group-name edit state
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [editingGroupNameValue, setEditingGroupNameValue] = useState("");

  // Inline option-label edit state — one at a time (option id or null)
  const [editingOptId, setEditingOptId] = useState<string | null>(null);
  const [editingOptValue, setEditingOptValue] = useState("");

  function commitGroupName() {
    setEditingGroupName(false);
    const v = editingGroupNameValue.trim();
    if (!v || v === group.nameAr) return;
    onPersistGroup({ name_ar: v });
  }

  function commitOptLabel(optId: string, original: string) {
    setEditingOptId(null);
    const v = editingOptValue.trim();
    if (!v || v === original) return;
    onRenameOption(optId, v);
  }

  return (
    <div className="border-t border-ink/10 py-6 first:border-t-0">
      {/* Group header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {editingGroupName && !inherited ? (
            <input
              autoFocus
              value={editingGroupNameValue}
              onChange={(e) => setEditingGroupNameValue(e.target.value)}
              onBlur={commitGroupName}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitGroupName(); }
                if (e.key === "Escape") setEditingGroupName(false);
              }}
              disabled={busy}
              className={`${fieldCls} w-44 font-semibold`}
              aria-label="تعديل اسم المجموعة"
            />
          ) : (
            <h4 className="font-semibold text-ink">{group.nameAr}</h4>
          )}
          {!inherited && !editingGroupName && (
            <button
              type="button"
              onClick={() => {
                setEditingGroupNameValue(group.nameAr);
                setEditingGroupName(true);
              }}
              disabled={busy}
              aria-label="تعديل اسم المجموعة"
              className="rounded-full p-1 text-ink-soft transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-50"
            >
              {PencilIcon}
            </button>
          )}
          <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-medium text-ink-soft">
            {INPUT_TYPE_LABELS[group.inputType]}
          </span>
          {inherited && (
            <span className="rounded-full bg-orange/10 px-2 py-0.5 text-[11px] font-medium text-orange-ink">
              موروث من الأساسي
            </span>
          )}
        </div>
        {!inherited && (
          <button
            type="button"
            onClick={onDeleteGroup}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
          >
            {TrashIcon} حذف المجموعة
          </button>
        )}
      </div>

      {inherited ? (
        <p className="mt-1 text-xs text-[var(--shop-muted)]">
          تُحرَّر من المنتج الأساسي «{product.parentNameAr}».
        </p>
      ) : (
        /* Group settings */
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2.5">
          <CheckRow
            checked={group.required}
            disabled={busy}
            onChange={(v) => onPersistGroup({ required: v })}
          >
            مطلوب
          </CheckRow>
          <CheckRow
            checked={group.requiresCustomerImage}
            disabled={busy}
            onChange={(v) => onPersistGroup({ requires_customer_image: v })}
          >
            تتطلب صورة من الزبون
          </CheckRow>
          <CheckRow
            checked={!!group.requiresCustomerText}
            disabled={busy}
            onChange={(v) => onPersistGroup({ requires_customer_text: v })}
          >
            كتابة مطلوبة من الزبون
          </CheckRow>
          <CheckRow
            checked={group.hasImage}
            disabled={busy}
            onChange={(v) => onPersistGroup({ has_image: v })}
          >
            إظهار صورة توضيحية
          </CheckRow>
          <label className="text-xs">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              id={`gimg-${group.id}`}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onGroupImage(group.id, f);
              }}
            />
            <span
              role="button"
              tabIndex={0}
              className="cursor-pointer font-medium text-orange-ink underline-offset-2 hover:underline"
              onClick={() =>
                document.getElementById(`gimg-${group.id}`)?.click()
              }
            >
              رفع صورة توضيحية
            </span>
          </label>

          {/* What the customer must type — admin controls the title + the in-box example. */}
          {(group.requiresCustomerText ||
            group.options.some((o) => o.requiresCustomerText)) && (
            <div className="w-full max-w-md rounded-xl border border-orange/25 bg-orange/5 p-3">
              <p className="mb-2 text-xs font-semibold text-orange-ink">
                ما الذي يكتبه الزبون؟
              </p>
              <div className="space-y-2.5">
                <div>
                  <label
                    className="block text-[11px] font-medium text-ink-soft"
                    htmlFor={`ctp-${group.id}`}
                  >
                    السؤال / العنوان
                  </label>
                  <input
                    id={`ctp-${group.id}`}
                    key={`ctp-${group.id}-${group.customerTextPromptAr ?? ""}`}
                    defaultValue={group.customerTextPromptAr ?? ""}
                    placeholder="مثال: ما هو لون الوشاح المطلوب؟"
                    disabled={busy}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (group.customerTextPromptAr ?? "")) {
                        onPersistGroup({ customer_text_prompt_ar: v || null });
                      }
                    }}
                    className={`${fieldCls} mt-1 w-full`}
                  />
                </div>
                <div>
                  <label
                    className="block text-[11px] font-medium text-ink-soft"
                    htmlFor={`ctph-${group.id}`}
                  >
                    مثال داخل الخانة
                  </label>
                  <input
                    id={`ctph-${group.id}`}
                    key={`ctph-${group.id}-${group.customerTextPlaceholderAr ?? ""}`}
                    defaultValue={group.customerTextPlaceholderAr ?? ""}
                    placeholder="مثال: أحمر غامق"
                    disabled={busy}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (group.customerTextPlaceholderAr ?? "")) {
                        onPersistGroup({ customer_text_placeholder_ar: v || null });
                      }
                    }}
                    className={`${fieldCls} mt-1 w-full`}
                  />
                </div>
              </div>

              {/* Live preview of exactly what the student will see */}
              <div className="mt-3 rounded-lg border border-ink/10 bg-white p-2.5">
                <p className="text-[10px] font-medium text-[var(--shop-muted)]">
                  ما يراه الطالب:
                </p>
                <p className="mt-1 text-xs font-semibold text-ink">
                  {group.customerTextPromptAr?.trim() || "اكتب التفاصيل المطلوبة"}
                  <span className="text-orange-ink"> *</span>
                </p>
                <div className="mt-1 rounded-md border border-ink/15 px-2 py-1.5 text-xs text-ink/35">
                  {group.customerTextPlaceholderAr?.trim() ||
                    "اكتب هنا التفاصيل المطلوبة…"}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-[var(--shop-muted)]">
                اتركهما فارغين للنص الافتراضي. لا علاقة بالتطريز — اكتب ما يناسب منتجك.
              </p>
            </div>
          )}
        </div>
      )}

      {lockedOption && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-orange/25 bg-orange/5 px-3 py-2 text-xs text-ink-soft">
          <span className="rounded-full bg-orange/15 px-2 py-0.5 font-medium text-orange-ink">
            مثبّت للطلاب
          </span>
          <span>
            الخيار «{lockedOption.labelAr}» مقفل — لا يمكن للطالب تغييره.
          </span>
          <button
            type="button"
            disabled={lockBusy}
            onClick={() => onLockOption(null)}
            className="ms-auto font-medium text-orange-ink underline-offset-2 hover:underline disabled:opacity-50"
          >
            إلغاء القفل
          </button>
        </div>
      )}

      {/* Options */}
      <ul className="mt-4 space-y-1.5">
        {group.options.length === 0 && !inherited && (
          <li className="text-xs text-[var(--shop-muted)]">لا خيارات بعد</li>
        )}
        {group.options.map((opt) => (
          <li
            key={opt.id}
            className="flex flex-wrap items-center gap-3 border-b border-ink/8 py-2.5 last:border-0"
          >
            {!inherited && editingOptId === opt.id ? (
              <input
                autoFocus
                value={editingOptValue}
                onChange={(e) => setEditingOptValue(e.target.value)}
                onBlur={() => commitOptLabel(opt.id, opt.labelAr)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitOptLabel(opt.id, opt.labelAr); }
                  if (e.key === "Escape") setEditingOptId(null);
                }}
                disabled={savingId === opt.id}
                className={`${fieldCls} min-w-[6rem] flex-1`}
                aria-label={`تعديل اسم ${opt.labelAr}`}
              />
            ) : (
              <span className="flex min-w-[6rem] flex-1 items-center gap-1.5 font-medium text-ink">
                {opt.labelAr}
                {!inherited && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingOptId(opt.id);
                      setEditingOptValue(opt.labelAr);
                    }}
                    disabled={savingId === opt.id}
                    aria-label={`تعديل اسم ${opt.labelAr}`}
                    className="rounded-full p-1 text-ink-soft transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-50"
                  >
                    {PencilIcon}
                  </button>
                )}
              </span>
            )}
            {inherited ? (
              <>
                <span className="text-sm tabular-nums text-ink-soft" dir="ltr">
                  {opt.priceDelta !== 0 ? `+${formatIQD(opt.priceDelta)}` : "—"}
                </span>
                {/* Price/options are edited on the parent, but the lock is per-child —
                    so students of THIS sub-product can be pinned to one option. */}
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
                  <input
                    type="radio"
                    name={`lock-${group.id}`}
                    checked={lockedOptionId === opt.id}
                    disabled={lockBusy}
                    onChange={() => onLockOption(opt.id)}
                    className="h-4 w-4 accent-orange-ink"
                  />
                  قفل هذا الخيار للطلاب
                </label>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  <input
                    key={`${opt.id}-${previewRole}`}
                    type="number"
                    defaultValue={opt.priceDelta}
                    dir="ltr"
                    disabled={savingId === opt.id}
                    onBlur={(e) => {
                      const n = Number(e.target.value) || 0;
                      if (n !== opt.priceDelta) onCommitOptionPrice(opt.id, n);
                    }}
                    className={`${fieldCls} w-28 text-right tabular-nums`}
                    aria-label={`سعر ${opt.labelAr} (${ROLE_LABELS[previewRole]})`}
                  />
                  <span className="text-xs text-[var(--shop-muted)]">د.ع</span>
                </span>
                <CheckRow
                  checked={opt.requiresCustomerImage}
                  disabled={savingId === opt.id}
                  onChange={(v) => onToggleOptionImage(opt.id, v)}
                >
                  <span className="text-xs">صورة مطلوبة</span>
                </CheckRow>
                <CheckRow
                  checked={!!opt.requiresCustomerText}
                  disabled={savingId === opt.id}
                  onChange={(v) => onToggleOptionText(opt.id, v)}
                >
                  <span className="text-xs">كتابة مطلوبة</span>
                </CheckRow>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
                  <input
                    type="radio"
                    name={`lock-${group.id}`}
                    checked={lockedOptionId === opt.id}
                    disabled={lockBusy}
                    onChange={() => onLockOption(opt.id)}
                    className="h-4 w-4 accent-orange-ink"
                  />
                  قفل هذا الخيار للطلاب
                </label>
                <button
                  type="button"
                  onClick={() => onDeleteOption(opt.id, opt.labelAr)}
                  disabled={savingId === opt.id}
                  className="rounded-full p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                  aria-label={`حذف ${opt.labelAr}`}
                >
                  {TrashIcon}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {/* Add option */}
      {!inherited &&
        (optionForGroup === group.id ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={noLabel}
              onChange={(e) => setNoLabel(e.target.value)}
              placeholder="اسم الخيار"
              className={`${fieldCls} flex-1`}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCreateOption(group.id);
              }}
            />
            <input
              type="number"
              value={noPrice}
              onChange={(e) => setNoPrice(e.target.value)}
              placeholder="السعر"
              dir="ltr"
              className={`${fieldCls} w-28 text-right`}
            />
            <Button
              size="sm"
              loading={savingId === `new-option-${group.id}`}
              onClick={() => onCreateOption(group.id)}
            >
              إضافة
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOptionForGroup(null)}
            >
              إلغاء
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setOptionForGroup(group.id);
              setNoLabel("");
              setNoPrice("");
            }}
            className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-orange-ink transition-colors hover:underline"
          >
            {PlusIcon} إضافة خيار
          </button>
        ))}
    </div>
  );
}
