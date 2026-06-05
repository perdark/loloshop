"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import {
  createPackage,
  deletePackage,
  listAdminPackages,
  setPackageRule,
  updatePackage,
  type PackagePayload,
} from "@/lib/admin";
import { getProductFull, getShopFeed, resolveCatalogMediaUrl, uploadCatalogImage } from "@/lib/catalog";
import { formatIQD } from "@/lib/format";
import type { CatalogOption, PackageTier } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";

const fieldCls =
  "min-h-10 w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink outline-none transition-colors focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/15";

interface Draft {
  id: string | null;
  nameAr: string;
  price: string;
  imageUrl: string | null;
  storyImageUrl: string | null;
  badgeLabel: string;
  accent: string;
  description: string;
  features: string[];
  includedItems: string[];
  sort: string;
  active: boolean;
  isVip: boolean;
  sashTypeOptionId: string;
}

const DEFAULT_ACCENT = "#b8860b";

function emptyDraft(): Draft {
  return {
    id: null,
    nameAr: "",
    price: "",
    imageUrl: null,
    storyImageUrl: null,
    badgeLabel: "VIP",
    accent: DEFAULT_ACCENT,
    description: "",
    features: ["", "", ""],
    includedItems: ["روب التخرج", "وشاح مطرّز", "قبعة التخرج"],
    sort: "0",
    active: true,
    isVip: true,
    sashTypeOptionId: "",
  };
}

function draftFromPackage(p: PackageTier): Draft {
  return {
    id: p.id,
    nameAr: p.nameAr,
    price: String(p.price ?? 0),
    imageUrl: p.imageUrl ?? null,
    storyImageUrl: p.storyImageUrl ?? null,
    badgeLabel: p.badgeLabel ?? "VIP",
    accent: p.accent ?? DEFAULT_ACCENT,
    description: p.description ?? "",
    features: p.features?.length ? p.features : [""],
    includedItems: p.includedItems?.length ? p.includedItems : [""],
    sort: String(p.sort ?? 0),
    active: p.active ?? true,
    isVip: p.isVip ?? false,
    sashTypeOptionId: p.sashTypeOptionId || "",
  };
}

function draftToPayload(d: Draft): PackagePayload {
  return {
    name_ar: d.nameAr.trim(),
    price: Number(d.price) || 0,
    role: "retail",
    image_url: d.imageUrl,
    story_image_url: d.storyImageUrl,
    badge_label: d.badgeLabel.trim() || null,
    accent: d.accent || null,
    description: d.description.trim() || null,
    features: d.features.map((f) => f.trim()).filter(Boolean),
    included_items: d.includedItems.map((f) => f.trim()).filter(Boolean),
    sort: Number(d.sort) || 0,
    active: d.active,
    is_vip: d.isVip,
  };
}

export default function AdminPackagesPage() {
  const [packages, setPackages] = useState<PackageTier[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sashOptions, setSashOptions] = useState<CatalogOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async (selectId?: string | null) => {
    setLoading(true);
    setLoadError(false);
    try {
      const list = await listAdminPackages();
      setPackages(list);
      setDraft((cur) => {
        if (selectId === null) return emptyDraft();
        const wantId = selectId ?? cur?.id ?? list[0]?.id ?? null;
        const found = list.find((p) => p.id === wantId);
        return found ? draftFromPackage(found) : list[0] ? draftFromPackage(list[0]) : emptyDraft();
      });
    } catch (e) {
      setLoadError(true);
      toast.error(getApiErrorMessage(e, "تعذر تحميل الباقات"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the sash product's first single-select options for the package rule picker.
  const loadSashOptions = useCallback(async () => {
    try {
      const feed = await getShopFeed();
      const sashId = feed.byType?.sash?.[0]?.id;
      if (!sashId) return;
      const full = await getProductFull(sashId);
      const group = full.optionGroups.find((g) => g.inputType === "single_select");
      setSashOptions(group?.options.filter((o) => o.active) ?? []);
    } catch {
      /* rule picker is optional — silently skip if unavailable */
    }
  }, []);

  useEffect(() => {
    load();
    loadSashOptions();
  }, [load, loadSashOptions]);

  function patch(p: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  // Upload an image and — for an already-saved package — persist it immediately so
  // it "sticks" without a separate Save click (matches the admin's mental model).
  async function handleImage(file: File, field: "imageUrl" | "storyImageUrl") {
    setSaving(true);
    try {
      const url = await uploadCatalogImage(file);
      patch(field === "imageUrl" ? { imageUrl: url } : { storyImageUrl: url });
      if (draft?.id) {
        const pid = draft.id;
        await updatePackage(pid, field === "imageUrl" ? { image_url: url } : { story_image_url: url });
        setPackages((ps) => ps.map((p) => (p.id === pid ? { ...p, [field]: url } : p)));
      }
      toast.success("تم رفع الصورة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر رفع الصورة"));
    } finally {
      setSaving(false);
    }
  }

  // Clear an image — also persisted immediately for a saved package.
  async function removeImage(field: "imageUrl" | "storyImageUrl") {
    patch(field === "imageUrl" ? { imageUrl: null } : { storyImageUrl: null });
    if (!draft?.id) return;
    const pid = draft.id;
    setSaving(true);
    try {
      await updatePackage(pid, field === "imageUrl" ? { image_url: null } : { story_image_url: null });
      setPackages((ps) => ps.map((p) => (p.id === pid ? { ...p, [field]: null } : p)));
      toast.success("تمت إزالة الصورة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر الحفظ"));
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!draft) return;
    if (!draft.nameAr.trim()) return toast.error("اسم الباقة مطلوب");
    if (!(Number(draft.price) > 0)) return toast.error("أدخل سعراً صحيحاً");
    setSaving(true);
    try {
      const payload = draftToPayload(draft);
      let id = draft.id;
      if (id) {
        await updatePackage(id, payload);
      } else {
        const res = await createPackage(payload);
        id = res.id;
      }
      // Persist the sash-type rule if chosen (needs a saved package id).
      if (id && draft.sashTypeOptionId) {
        await setPackageRule(id, draft.sashTypeOptionId);
      }
      toast.success(draft.id ? "تم حفظ الباقة" : "تم إنشاء الباقة");
      await load(id);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ الباقة"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setDeleteTarget(null);
    setSaving(true);
    try {
      await deletePackage(id);
      toast.success("تم حذف الباقة");
      await load(null);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حذف الباقة"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in">
        <div className="skeleton h-9 w-48 rounded-xl" />
        <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
          <div className="skeleton h-72 w-full rounded-2xl" />
          <div className="skeleton h-[480px] w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div dir="rtl" lang="ar" className="space-y-4">
        <Masthead />
        <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل الباقات</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={() => load()}>إعادة المحاولة</Button>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" lang="ar" className="animate-page-in">
      <Masthead />

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        {/* ── Packages rail ── */}
        <aside className="rounded-2xl border border-ink/10 bg-[var(--shop-sink)] p-3 lg:sticky lg:top-6 lg:self-start">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="font-display text-base font-bold text-ink">الباقات</h2>
            <button
              type="button"
              onClick={() => setDraft(emptyDraft())}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-orange-ink transition-colors hover:bg-orange/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink"
            >
              + باقة
            </button>
          </div>

          <nav className="space-y-1">
            {packages.map((p) => {
              const selected = draft?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDraft(draftFromPackage(p))}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-right transition-colors ${
                    selected ? "bg-orange/10 font-semibold text-orange-ink" : "text-ink hover:bg-beige"
                  } ${!p.active ? "opacity-50" : ""}`}
                >
                  <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-peach/40">
                    {p.imageUrl && (
                      <Image
                        src={resolveCatalogMediaUrl(p.imageUrl) || p.imageUrl}
                        alt=""
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate">{p.nameAr}</span>
                    <span className="mt-0.5 block text-xs font-normal text-[var(--shop-muted)]" dir="ltr">
                      {formatIQD(p.price)}
                    </span>
                  </span>
                  {p.isVip && (
                    <span className="shrink-0 rounded-full bg-orange/15 px-2 py-0.5 text-[10px] font-bold text-orange-ink">
                      VIP
                    </span>
                  )}
                </button>
              );
            })}
            {!packages.length && <EmptyState message="لا توجد باقات بعد — أنشئ باقة VIP للبدء." />}
          </nav>
        </aside>

        {/* ── Editor ── */}
        <section className="min-w-0">
          {!draft ? (
            <EmptyState title="اختر باقة" message="اختر باقة من القائمة أو أنشئ واحدة جديدة." />
          ) : (
            <div className="space-y-7 rounded-2xl border border-ink/10 bg-beige p-6 shadow-[var(--shadow-soft)]">
              <div className="flex items-center justify-between gap-3 border-b border-ink/10 pb-4">
                <h2 className="font-display text-2xl font-bold text-ink">
                  {draft.id ? "تعديل الباقة" : "باقة جديدة"}
                </h2>
                {draft.id && (
                  <button
                    type="button"
                    onClick={() => setDeleteTarget({ id: draft.id as string, name: draft.nameAr })}
                    className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 px-3.5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-white"
                  >
                    حذف
                  </button>
                )}
              </div>

              {/* Identity */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="اسم الباقة" htmlFor="pkg-nameAr">
                  <input
                    id="pkg-nameAr"
                    name="nameAr"
                    value={draft.nameAr}
                    onChange={(e) => patch({ nameAr: e.target.value })}
                    placeholder="باقة VIP الفاخرة"
                    className={fieldCls}
                  />
                </Field>
                <Field label="السعر (د.ع)" htmlFor="pkg-price">
                  <input
                    id="pkg-price"
                    name="price"
                    type="number"
                    value={draft.price}
                    onChange={(e) => patch({ price: e.target.value })}
                    dir="ltr"
                    className={`${fieldCls} text-right tabular-nums`}
                  />
                </Field>
              </div>

              {/* Images — hero (cover) + story band, both shown on the VIP page */}
              <div className="grid gap-5 sm:grid-cols-2">
                <ImagePicker
                  label="صورة الغلاف (الهيرو)"
                  hint="تظهر أعلى صفحة VIP خلف العنوان."
                  value={draft.imageUrl}
                  inputId="vip-img"
                  busy={saving}
                  onPick={(f) => handleImage(f, "imageUrl")}
                  onRemove={() => removeImage("imageUrl")}
                />
                <ImagePicker
                  label="صورة القصة (الشريط السفلي)"
                  hint="تظهر في شريط «لأن لحظة التخرج لا تتكرر»."
                  value={draft.storyImageUrl}
                  inputId="vip-story-img"
                  busy={saving}
                  onPick={(f) => handleImage(f, "storyImageUrl")}
                  onRemove={() => removeImage("storyImageUrl")}
                />
              </div>

              {/* Badge + accent */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="نص الشارة (Badge)" htmlFor="pkg-badgeLabel">
                  <input
                    id="pkg-badgeLabel"
                    name="badgeLabel"
                    value={draft.badgeLabel}
                    onChange={(e) => patch({ badgeLabel: e.target.value })}
                    placeholder="VIP"
                    className={fieldCls}
                  />
                </Field>
                <Field label="لون التميّز (الشارة فقط)" htmlFor="pkg-accent">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(draft.accent) ? draft.accent : DEFAULT_ACCENT}
                      onChange={(e) => patch({ accent: e.target.value })}
                      className="h-10 w-12 cursor-pointer rounded-lg border border-ink/15 bg-white p-1"
                      aria-label="لون التميّز"
                    />
                    <input
                      id="pkg-accent"
                      name="accent"
                      value={draft.accent}
                      onChange={(e) => patch({ accent: e.target.value })}
                      dir="ltr"
                      placeholder="#b8860b"
                      className={`${fieldCls} flex-1 tabular-nums`}
                    />
                  </div>
                </Field>
              </div>

              {/* Description */}
              <Field label="وصف الباقة" htmlFor="pkg-description">
                <textarea
                  id="pkg-description"
                  name="description"
                  value={draft.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  rows={3}
                  placeholder="الإطلالة الأرقى ليوم تخرجك…"
                  className={`${fieldCls} resize-y leading-relaxed`}
                />
              </Field>

              {/* Perks + included */}
              <ListEditor
                label="المزايا (Perks)"
                hint="ما يميّز باقة VIP — تظهر كقائمة فاخرة للطالب."
                items={draft.features}
                placeholder="خياطة فاخرة بخامات مستوردة"
                onChange={(features) => patch({ features })}
              />
              <ListEditor
                label="المحتويات (ما الذي تشمله)"
                hint="قائمة عناصر الباقة."
                items={draft.includedItems}
                placeholder="روب التخرج"
                onChange={(includedItems) => patch({ includedItems })}
              />

              {/* Sash rule */}
              {sashOptions.length > 0 && (
                <Field label="نوع الوشاح المرتبط (اختياري)" htmlFor="pkg-sashTypeOptionId">
                  <select
                    id="pkg-sashTypeOptionId"
                    name="sashTypeOptionId"
                    value={draft.sashTypeOptionId}
                    onChange={(e) => patch({ sashTypeOptionId: e.target.value })}
                    className={fieldCls}
                  >
                    <option value="">—</option>
                    {sashOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.labelAr}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {/* Flags */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="الترتيب" htmlFor="pkg-sort">
                  <input
                    id="pkg-sort"
                    name="sort"
                    type="number"
                    value={draft.sort}
                    onChange={(e) => patch({ sort: e.target.value })}
                    dir="ltr"
                    className={`${fieldCls} text-right`}
                  />
                </Field>
                <div className="flex items-end gap-6 pb-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
                    <input
                      type="checkbox"
                      checked={draft.isVip}
                      onChange={(e) => patch({ isVip: e.target.checked })}
                      className="h-4 w-4 accent-orange-ink"
                    />
                    باقة VIP
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(e) => patch({ active: e.target.checked })}
                      className="h-4 w-4 accent-orange-ink"
                    />
                    مفعّلة
                  </label>
                </div>
              </div>

              <div className="flex gap-3 border-t border-ink/10 pt-5">
                <Button loading={saving} onClick={handleSave}>
                  {draft.id ? "حفظ التغييرات" : "إنشاء الباقة"}
                </Button>
                {draft.id && (
                  <Button variant="ghost" onClick={() => load(draft.id)} disabled={saving}>
                    تجاهل التغييرات
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد حذف الباقة"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="danger" onClick={confirmDelete} loading={saving}>
              حذف «{deleteTarget?.name}»
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          ستُخفى الباقة «{deleteTarget?.name}» من المتجر (حذف ناعم — تبقى الطلبات السابقة سليمة).
        </p>
      </Modal>
    </div>
  );
}

function Masthead() {
  return (
    <header className="mb-9 border-b border-ink/15 pb-6">
      <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-ink lg:text-5xl">
        باقات VIP
      </h1>
      <p className="mt-2.5 max-w-xl text-base text-ink-soft">
        الباقات الفاخرة للطلاب — الاسم والسعر والمزايا والشارة، بتحكّم كامل.
      </p>
    </header>
  );
}

/* Single image slot — preview + upload + remove. Used for both the hero and the
   story photo. Resets the file input after each pick so re-selecting the same
   file fires onChange again. */
function ImagePicker({
  label,
  hint,
  value,
  inputId,
  busy,
  onPick,
  onRemove,
}: {
  label: string;
  hint?: string;
  value: string | null;
  inputId: string;
  busy?: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-4">
        <span className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-ink/10 bg-peach/30">
          {value && (
            <Image
              src={resolveCatalogMediaUrl(value) || value}
              alt=""
              fill
              className="object-cover"
              unoptimized
            />
          )}
        </span>
        <div className="min-w-0">
          <input
            type="file"
            accept="image/*"
            id={inputId}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={() => document.getElementById(inputId)?.click()}
          >
            {value ? "تغيير الصورة" : "رفع صورة"}
          </Button>
          {value && (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="ms-3 text-xs font-medium text-danger hover:underline disabled:opacity-50"
            >
              إزالة
            </button>
          )}
          {hint && <p className="mt-1.5 text-xs text-[var(--shop-muted)]">{hint}</p>}
        </div>
      </div>
    </Field>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1.5 block text-sm font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

/* Repeatable Arabic string list (perks / included items) with add · remove · reorder. */
function ListEditor({
  label,
  hint,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  items: string[];
  placeholder?: string;
  onChange: (items: string[]) => void;
}) {
  const set = (i: number, v: string) => onChange(items.map((it, idx) => (idx === i ? v : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink-soft">{label}</span>
        <button
          type="button"
          onClick={() => onChange([...items, ""])}
          className="text-xs font-semibold text-orange-ink hover:underline"
        >
          + إضافة
        </button>
      </div>
      {hint && <p className="mb-2 text-xs text-[var(--shop-muted)]">{hint}</p>}
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={it}
              onChange={(e) => set(i, e.target.value)}
              placeholder={placeholder}
              className={fieldCls}
            />
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="rounded-md p-1.5 text-ink-soft transition-colors hover:bg-orange/10 hover:text-orange-ink disabled:opacity-30"
              aria-label="تحريك لأعلى"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === items.length - 1}
              className="rounded-md p-1.5 text-ink-soft transition-colors hover:bg-orange/10 hover:text-orange-ink disabled:opacity-30"
              aria-label="تحريك لأسفل"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
              aria-label="حذف"
            >
              ✕
            </button>
          </div>
        ))}
        {!items.length && (
          <p className="text-xs text-[var(--shop-muted)]">لا عناصر — أضف عنصراً.</p>
        )}
      </div>
    </div>
  );
}
