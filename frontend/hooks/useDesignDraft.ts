"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  completeDesign,
  getMyDesign,
  saveDesign,
} from "@/lib/designer";
import { getProductFull, getShopFeed } from "@/lib/catalog";
import { buildConfigureSelections, configureOrder } from "@/lib/orders";
import {
  computePriceBreakdown,
  groupVisibleForGender,
  validateSelection,
  type OptionSelection,
} from "@/lib/pricing";
import { validateCustomerImages } from "@/lib/customerImage";
import type { CatalogProduct } from "@/lib/types";
import { getApiErrorMessage } from "@/lib/api";

const GENDER_KEY = "loloshop_student_gender";
const AUTO_SAVE_MS = 8_000;
const DRAFT_SELECTION_KEY = "loloshop_draft_selection";
const DRAFT_CUSTOMER_IMAGES_KEY = "loloshop_draft_customer_images";
const DRAFT_STEP_KEY = "loloshop_draft_step";
const SASH_PRESET_KEY = "loloshop_sash_preset";
const DRAFT_PRODUCT_ID_KEY = "loloshop_draft_product_id";

function readSessionJson<T>(key: string): T | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeSessionJson(key: string, value: unknown) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function useDesignDraft(enabled: boolean, pauseAutosave = false) {
  const router = useRouter();

  const [bootLoading, setBootLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [studentStatus, setStudentStatus] = useState<string | null>(null);
  const [completedLocked, setCompletedLocked] = useState(false);
  const [editException, setEditException] = useState(false);
  const [gender, setGender] = useState<"male" | "female" | null>(null);

  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [selection, setSelection] = useState<OptionSelection>({});
  const [customerImages, setCustomerImages] = useState<Record<string, string>>({});

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [leftJson, setLeftJson] = useState<unknown | null>(null);
  const [rightJson, setRightJson] = useState<unknown | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [extraImageUrl, setExtraImageUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const usedFontsRef = useRef<Set<string>>(new Set());
  const [fontsUsed, setFontsUsed] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const saveSeqRef = useRef(0);
  const [confirming, setConfirming] = useState(false);
  const [singleSideOnly, setSingleSideOnly] = useState(false);

  const colorGroup = useMemo(
    () => product?.optionGroups.find((g) => g.nameAr.includes("لون")) ?? null,
    [product]
  );

  const sashColor = useMemo(() => {
    if (!colorGroup) return "أبيض";
    const id = selection[colorGroup.id];
    const opt = colorGroup.options.find((o) => o.id === id);
    return opt?.labelAr ?? "أبيض";
  }, [colorGroup, selection]);

  const role = product?.priceRole ?? "retail";
  const preview = useMemo(() => {
    if (!product) return { lines: [], total: 0 };
    return computePriceBreakdown(product, selection, role);
  }, [product, selection, role]);

  const sortedGroups = useMemo(() => {
    const priority = (g: { nameAr: string; sort: number }) => {
      if (g.nameAr.includes("لون")) return 0;
      if (g.nameAr.includes("نوع")) return 1;
      return 2 + g.sort;
    };
    return (product?.optionGroups ?? [])
      .filter((g) => groupVisibleForGender(g, gender))
      .sort((a, b) => priority(a) - priority(b));
  }, [product, gender]);

  const canPreview =
    singleSideOnly || (!!leftJson && !!rightJson) || (!!leftJson && !!rightJson);

  const previewReady = singleSideOnly
    ? !!(leftJson || rightJson)
    : !!(leftJson && rightJson);

  const clearSaveFailed = useCallback(() => setSaveFailed(false), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setBootError(null);
      try {
        const [feed, my] = await Promise.all([getShopFeed(), getMyDesign()]);
        if (cancelled) return;

        if (my.student_gender === "male" || my.student_gender === "female") {
          setGender(my.student_gender);
          localStorage.setItem(GENDER_KEY, my.student_gender);
        } else {
          const saved = localStorage.getItem(GENDER_KEY);
          if (saved === "male" || saved === "female") setGender(saved);
        }

        setEditException(!!my.edit_exception);
        setStudentStatus(my.student_status);

        // Check for preset from product page (consumes it once)
        const preset = readSessionJson<{ productId: string; selections: OptionSelection }>(SASH_PRESET_KEY);
        if (preset) {
          try { sessionStorage.removeItem(SASH_PRESET_KEY); } catch { /* ignore */ }
        }

        // Determine which sash product to load
        const savedProductId = typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem(DRAFT_PRODUCT_ID_KEY)
          : null;
        const targetProductId = preset?.productId
          ?? savedProductId
          ?? (feed.byType.sash ?? [])[0]?.id;

        if (targetProductId) {
          const full = await getProductFull(targetProductId);
          if (cancelled) return;
          setProduct(full);

          // Persist product choice for page refreshes
          try { sessionStorage.setItem(DRAFT_PRODUCT_ID_KEY, targetProductId); } catch { /* ignore */ }

          const savedSelection = readSessionJson<OptionSelection>(DRAFT_SELECTION_KEY);
          const savedCustomerImages = readSessionJson<Record<string, string>>(
            DRAFT_CUSTOMER_IMAGES_KEY
          );

          // Preset selections take priority, fall back to saved session
          const mergedSelection: OptionSelection = {
            ...(savedSelection ?? {}),
            ...(preset?.selections ?? {}),
          };
          if (Object.keys(mergedSelection).length > 0) {
            setSelection(mergedSelection);
          }
          if (savedCustomerImages && Object.keys(savedCustomerImages).length > 0) {
            setCustomerImages(savedCustomerImages);
          }

          if (my.data) {
            setLeftJson(my.data.left_canvas);
            setRightJson(my.data.right_canvas);
            setLogoUrl(my.data.logo_url);
            setExtraImageUrl(my.data.extra_image_url);
            setNotes(my.data.notes || "");
            const loadedFonts = my.data.fonts_used || [];
            loadedFonts.forEach((f) => usedFontsRef.current.add(f));
            setFontsUsed(loadedFonts);
            const cg = full.optionGroups.find((g) => g.nameAr.includes("لون"));
            const match = cg?.options.find((o) => o.labelAr === my.data?.sash_color);
            if (cg && match) {
              setSelection((prev) => ({ ...prev, [cg.id]: match.id }));
            }
            if (my.data.completed && !my.edit_exception) {
              setCompletedLocked(true);
            }
          }

          const hasCanvas = !!(my.data?.left_canvas || my.data?.right_canvas);
          let restoredStep: 1 | 2 | 3 = hasCanvas ? 2 : 1;
          const savedStepRaw =
            typeof sessionStorage !== "undefined"
              ? sessionStorage.getItem(DRAFT_STEP_KEY)
              : null;
          if (savedStepRaw === "1" || savedStepRaw === "2" || savedStepRaw === "3") {
            restoredStep = Number(savedStepRaw) as 1 | 2 | 3;
          }
          setStep(restoredStep);
        }
      } catch (e) {
        if (!cancelled) {
          setBootError(getApiErrorMessage(e, "تعذر تحميل صفحة التصميم"));
        }
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || bootLoading) return;
    writeSessionJson(DRAFT_SELECTION_KEY, selection);
  }, [enabled, bootLoading, selection]);

  useEffect(() => {
    if (!enabled || bootLoading) return;
    writeSessionJson(DRAFT_CUSTOMER_IMAGES_KEY, customerImages);
  }, [enabled, bootLoading, customerImages]);

  useEffect(() => {
    if (!enabled || bootLoading) return;
    try {
      sessionStorage.setItem(DRAFT_STEP_KEY, String(step));
    } catch {
      /* ignore */
    }
  }, [enabled, bootLoading, step]);

  const persist = useCallback(
    async (silent = false, override?: { left?: unknown; right?: unknown }) => {
      if ((completedLocked && !editException) || !product) return;
      const seq = ++saveSeqRef.current;
      setSaving(true);
      try {
        await saveDesign({
          sash_color: sashColor,
          left_canvas: override && "left" in override ? override.left : leftJson,
          right_canvas: override && "right" in override ? override.right : rightJson,
          logo_url: logoUrl,
          extra_image_url: extraImageUrl,
          fonts_used: Array.from(usedFontsRef.current),
          notes: notes || null,
        });
        if (seq === saveSeqRef.current) {
          setSavedAt(Date.now());
          setSaveFailed(false);
        }
        if (!silent) toast.success("تم الحفظ");
      } catch (e) {
        if (seq === saveSeqRef.current) {
          if (silent) setSaveFailed(true);
        }
        if (!silent) toast.error(getApiErrorMessage(e, "تعذر الحفظ"));
        throw e;
      } finally {
        if (seq === saveSeqRef.current) {
          setSaving(false);
        }
      }
    },
    [
      completedLocked,
      editException,
      product,
      sashColor,
      leftJson,
      rightJson,
      logoUrl,
      extraImageUrl,
      notes,
    ]
  );

  useEffect(() => {
    if (bootLoading || completedLocked || pauseAutosave) return;
    if (step === 2) {
      const t = setTimeout(() => {
        persist(true).catch(() => {});
      }, AUTO_SAVE_MS);
      return () => clearTimeout(t);
    }
    if (step === 3) {
      const t = setTimeout(() => {
        persist(true).catch(() => {});
      }, AUTO_SAVE_MS);
      return () => clearTimeout(t);
    }
  }, [
    bootLoading,
    step,
    completedLocked,
    pauseAutosave,
    persist,
    leftJson,
    rightJson,
    logoUrl,
    extraImageUrl,
    notes,
    sashColor,
  ]);

  function setGroupValue(groupId: string, value: OptionSelection[string]) {
    setSelection((prev) => ({ ...prev, [groupId]: value }));
    setCustomerImages((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(`${groupId}:`)) delete next[k];
      }
      return next;
    });
  }

  function goToCanvas() {
    if (!product) return;
    if (!gender) {
      toast.error("اختر جنسك من صفحة المتجر أولاً");
      return;
    }
    const err = validateSelection(product, selection, gender);
    if (err) return toast.error(err);
    const imgErr = validateCustomerImages(product, selection, customerImages);
    if (imgErr) return toast.error(imgErr);
    setStep(2);
    persist(true).catch(() => {});
  }

  async function goToPreview() {
    if (!previewReady) return;
    try {
      await persist(true);
      setStep(3);
    } catch {
      toast.error("احفظ المسودة أولاً ثم حاول المعاينة");
    }
  }

  async function confirmDesign(): Promise<boolean> {
    if (!product) return false;
    if (!gender) {
      toast.error("يجب تحديد الجنس في ملفك");
      return false;
    }
    const err = validateSelection(product, selection, gender);
    if (err) {
      toast.error(err);
      return false;
    }

    setConfirming(true);
    try {
      const { id: designId } = await saveDesign({
        sash_color: sashColor,
        left_canvas: leftJson,
        right_canvas: rightJson,
        logo_url: logoUrl,
        extra_image_url: extraImageUrl,
        fonts_used: Array.from(usedFontsRef.current),
        notes: notes || null,
      });
      try {
        await configureOrder({
          productId: product.id,
          designId,
          selections: buildConfigureSelections(product, selection, customerImages),
        });
      } catch (e) {
        toast.error(getApiErrorMessage(e, "تعذر تسعير الطلب — تواصل مع الدعم"));
        return false;
      }
      try {
        await completeDesign();
      } catch (e) {
        toast.error(getApiErrorMessage(e, "تم الحفظ لكن تعذر قفل التصميم — تواصل مع الدعم"));
        return false;
      }
      toast.success("تم تأكيد تصميمك وطلبك");
      router.replace("/");
      return true;
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ التصميم"));
      return false;
    } finally {
      setConfirming(false);
    }
  }

  function registerFonts(fonts: string[]) {
    let changed = false;
    for (const f of fonts) {
      if (!usedFontsRef.current.has(f)) {
        usedFontsRef.current.add(f);
        changed = true;
      }
    }
    if (changed) setFontsUsed(Array.from(usedFontsRef.current));
  }

  return {
    router,
    bootLoading,
    bootError,
    studentStatus,
    completedLocked,
    editException,
    gender,
    product,
    selection,
    customerImages,
    setCustomerImages,
    step,
    setStep,
    leftJson,
    rightJson,
    setLeftJson,
    setRightJson,
    logoUrl,
    extraImageUrl,
    setLogoUrl,
    setExtraImageUrl,
    notes,
    setNotes,
    saving,
    savedAt,
    saveFailed,
    clearSaveFailed,
    confirming,
    singleSideOnly,
    setSingleSideOnly,
    sashColor,
    role,
    preview,
    sortedGroups,
    previewReady,
    setGroupValue,
    goToCanvas,
    goToPreview,
    confirmDesign,
    persist,
    registerFonts,
    fontsUsed,
  };
}
