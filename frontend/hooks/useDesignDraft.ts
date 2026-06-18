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
import { addToCart } from "@/lib/cart";
import {
  computePriceBreakdown,
  groupVisibleForGender,
  validateSelection,
  type OptionSelection,
} from "@/lib/pricing";
import {
  validateCustomerImages,
  validateCustomerTexts,
  getSelectedOptionId,
  selectionKey,
} from "@/lib/customerImage";
import type { CatalogProduct, ShopProductCard } from "@/lib/types";
import { getApiErrorMessage } from "@/lib/api";

const GENDER_KEY = "loloshop_student_gender";
const AUTO_SAVE_MS = 8_000;
const DRAFT_SELECTION_KEY = "loloshop_draft_selection";
const DRAFT_CUSTOMER_IMAGES_KEY = "loloshop_draft_customer_images";
const DRAFT_CUSTOMER_TEXTS_KEY = "loloshop_draft_customer_texts";
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
  const [isRepStudent, setIsRepStudent] = useState(false);
  const [gender, setGender] = useState<"male" | "female" | null>(null);
  // Per-wholesaler sash side lock: which side the student may edit (null = both).
  const [editableSide, setEditableSide] = useState<"left" | "right" | null>(null);
  const lockedSideRef = useRef<unknown | null>(null);

  const [product, setProduct] = useState<CatalogProduct | null>(null);
  // Available sash products — used to render the "choose a sash" step when no
  // specific sash has been picked yet (a fresh account must select one first).
  const [sashChoices, setSashChoices] = useState<ShopProductCard[]>([]);
  const [selection, setSelection] = useState<OptionSelection>({});
  const [customerImages, setCustomerImages] = useState<Record<string, string>>({});
  const [customerTexts, setCustomerTexts] = useState<Record<string, string>>({});

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
    const optId = getSelectedOptionId(colorGroup, selection);
    // Typed-color group: the real color is the customer's free text, not the option label.
    if (colorGroup.requiresCustomerText) {
      const txt = optId
        ? customerTexts[selectionKey(colorGroup.id, optId)]
        : undefined;
      return txt?.trim() || "أبيض";
    }
    const opt = colorGroup.options.find((o) => o.id === optId);
    return opt?.labelAr ?? "أبيض";
  }, [colorGroup, selection, customerTexts]);

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

  const previewReady = editableSide
    ? // Locked: student only needs to design their editable side.
      editableSide === "left"
      ? !!leftJson
      : !!rightJson
    : singleSideOnly
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

        let resolvedGender: "male" | "female" | null = null;
        if (my.student_gender === "male" || my.student_gender === "female") {
          resolvedGender = my.student_gender;
          setGender(my.student_gender);
          localStorage.setItem(GENDER_KEY, my.student_gender);
        } else {
          const saved = localStorage.getItem(GENDER_KEY);
          if (saved === "male" || saved === "female") {
            resolvedGender = saved;
            setGender(saved);
          }
        }

        setEditException(!!my.edit_exception);
        setStudentStatus(my.student_status);
        setIsRepStudent(!!my.is_rep_student);

        // Per-wholesaler sash side lock. The locked side = opposite of editable.
        const editSide =
          my.editable_sash_side === "left" || my.editable_sash_side === "right"
            ? my.editable_sash_side
            : null;
        setEditableSide(editSide);
        lockedSideRef.current = editSide ? (my.locked_side_design ?? null) : null;

        // Check for preset from product page (consumes it once). The product page
        // also forwards any color photo/text the student already entered there, so
        // they never re-do it in the designer.
        const preset = readSessionJson<{
          productId: string;
          selections: OptionSelection;
          customerImages?: Record<string, string>;
          customerTexts?: Record<string, string>;
        }>(SASH_PRESET_KEY);
        if (preset) {
          try { sessionStorage.removeItem(SASH_PRESET_KEY); } catch { /* ignore */ }
        }

        // The sash catalog — drives the "choose your sash" step.
        const sashList = feed.byType.sash ?? [];
        setSashChoices(sashList);

        // Determine which sash product to load. A NEW account that just opened
        // «صمم وشاحك» with no chosen sash must NOT be dropped into an arbitrary
        // auto-picked sash — leave the product unset so the chooser shows. We only
        // fall back to the first sash when there is an existing design to render
        // (returning student whose product id is no longer in this session).
        const savedProductId = typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem(DRAFT_PRODUCT_ID_KEY)
          : null;
        const hasExistingDesign = !!(my.data?.left_canvas || my.data?.right_canvas);
        const targetProductId = preset?.productId
          ?? savedProductId
          ?? (hasExistingDesign ? sashList[0]?.id : undefined);

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
          const savedCustomerTexts = readSessionJson<Record<string, string>>(
            DRAFT_CUSTOMER_TEXTS_KEY
          );

          // Preset selections take priority, fall back to saved session
          const mergedSelection: OptionSelection = {
            ...(savedSelection ?? {}),
            ...(preset?.selections ?? {}),
          };
          if (Object.keys(mergedSelection).length > 0) {
            setSelection(mergedSelection);
          }
          // Preset photo/text (from the product page) take priority over any saved draft.
          const mergedCustomerImages = {
            ...(savedCustomerImages ?? {}),
            ...(preset?.customerImages ?? {}),
          };
          const mergedCustomerTexts = {
            ...(savedCustomerTexts ?? {}),
            ...(preset?.customerTexts ?? {}),
          };
          if (Object.keys(mergedCustomerImages).length > 0) {
            setCustomerImages(mergedCustomerImages);
          }
          if (Object.keys(mergedCustomerTexts).length > 0) {
            setCustomerTexts(mergedCustomerTexts);
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
            const savedColor = my.data?.sash_color;
            if (cg && savedColor) {
              if (cg.requiresCustomerText) {
                // Typed-color sash: auto-select the sole option + restore the typed text,
                // unless a fresher preset/draft already supplied it.
                const opt = cg.options.find((o) => o.active) ?? cg.options[0];
                if (opt) {
                  setSelection((prev) =>
                    prev[cg.id] != null ? prev : { ...prev, [cg.id]: opt.id }
                  );
                  const ckey = selectionKey(cg.id, opt.id);
                  setCustomerTexts((prev) =>
                    prev[ckey] ? prev : { ...prev, [ckey]: savedColor }
                  );
                }
              } else {
                const match = cg.options.find((o) => o.labelAr === savedColor);
                if (match) {
                  setSelection((prev) => ({ ...prev, [cg.id]: match.id }));
                }
              }
            }
            if (my.data.completed && !my.edit_exception) {
              setCompletedLocked(true);
            }
          }

          // Enforce the locked side: force the admin/wholesaler default onto the
          // side the student is NOT allowed to edit, overriding any saved content.
          if (editSide && lockedSideRef.current) {
            if (editSide === "left") setRightJson(lockedSideRef.current);
            else setLeftJson(lockedSideRef.current);
          }

          // Arriving from a product page with a complete configuration (color +
          // any required photo/text) → skip the options step and open the canvas
          // (step 2) directly, so the student doesn't re-pick what they just set.
          const presetComplete =
            !!preset &&
            !validateSelection(full, mergedSelection, resolvedGender) &&
            !validateCustomerImages(full, mergedSelection, mergedCustomerImages) &&
            !validateCustomerTexts(full, mergedSelection, mergedCustomerTexts);

          const hasCanvas = !!(my.data?.left_canvas || my.data?.right_canvas);
          let restoredStep: 1 | 2 | 3 = hasCanvas || presetComplete ? 2 : 1;
          const savedStepRaw =
            typeof sessionStorage !== "undefined"
              ? sessionStorage.getItem(DRAFT_STEP_KEY)
              : null;
          // A fresh, complete preset wins over a stale saved step.
          if (
            !presetComplete &&
            (savedStepRaw === "1" || savedStepRaw === "2" || savedStepRaw === "3")
          ) {
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
    writeSessionJson(DRAFT_CUSTOMER_TEXTS_KEY, customerTexts);
  }, [enabled, bootLoading, customerTexts]);

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
      // Always persist the locked side's admin default so orders/staff get a
      // complete sash even though the student never edits that side.
      const lockedLeft = editableSide === "right" ? lockedSideRef.current : undefined;
      const lockedRight = editableSide === "left" ? lockedSideRef.current : undefined;
      try {
        await saveDesign({
          sash_color: sashColor,
          left_canvas:
            lockedLeft !== undefined
              ? lockedLeft
              : override && "left" in override
              ? override.left
              : leftJson,
          right_canvas:
            lockedRight !== undefined
              ? lockedRight
              : override && "right" in override
              ? override.right
              : rightJson,
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
      editableSide,
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

  // Explicitly load a sash the student picked from the chooser, then enter the
  // options step. Restores any in-progress option/photo drafts for this session.
  const selectSashProduct = useCallback(async (productId: string) => {
    setBootError(null);
    try {
      const full = await getProductFull(productId);
      setProduct(full);
      try {
        sessionStorage.setItem(DRAFT_PRODUCT_ID_KEY, productId);
      } catch {
        /* ignore */
      }
      const savedSelection = readSessionJson<OptionSelection>(DRAFT_SELECTION_KEY);
      if (savedSelection && Object.keys(savedSelection).length > 0) {
        setSelection(savedSelection);
      }
      const savedImages = readSessionJson<Record<string, string>>(
        DRAFT_CUSTOMER_IMAGES_KEY
      );
      if (savedImages && Object.keys(savedImages).length > 0) {
        setCustomerImages(savedImages);
      }
      const savedTexts = readSessionJson<Record<string, string>>(
        DRAFT_CUSTOMER_TEXTS_KEY
      );
      if (savedTexts && Object.keys(savedTexts).length > 0) {
        setCustomerTexts(savedTexts);
      }
      setStep(1);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل الوشاح"));
    }
  }, []);

  function setGroupValue(groupId: string, value: OptionSelection[string]) {
    setSelection((prev) => ({ ...prev, [groupId]: value }));
    // Changing the option invalidates any per-selection image/text the customer
    // supplied for the previous choice — clear both so stale data never ships.
    const clearForGroup = (prev: Record<string, string>) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(`${groupId}:`)) delete next[k];
      }
      return next;
    };
    setCustomerImages(clearForGroup);
    setCustomerTexts(clearForGroup);
  }

  function goToCanvas() {
    if (!product) return;
    const err = validateSelection(product, selection, gender);
    if (err) return toast.error(err);
    const imgErr = validateCustomerImages(product, selection, customerImages);
    if (imgErr) return toast.error(imgErr);
    const txtErr = validateCustomerTexts(product, selection, customerTexts);
    if (txtErr) return toast.error(txtErr);
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
    const err = validateSelection(product, selection, gender);
    if (err) {
      toast.error(err);
      return false;
    }
    // Mirror the backend's customer-image/text requirements so a missing color
    // photo or color text is caught here, not as a raw 400 on add-to-cart.
    const imgErr = validateCustomerImages(product, selection, customerImages);
    if (imgErr) {
      toast.error(imgErr);
      setStep(1);
      return false;
    }
    const txtErr = validateCustomerTexts(product, selection, customerTexts);
    if (txtErr) {
      toast.error(txtErr);
      setStep(1);
      return false;
    }

    setConfirming(true);
    const lockedLeft = editableSide === "right" ? lockedSideRef.current : undefined;
    const lockedRight = editableSide === "left" ? lockedSideRef.current : undefined;
    try {
      const { id: designId } = await saveDesign({
        sash_color: sashColor,
        left_canvas: lockedLeft !== undefined ? lockedLeft : leftJson,
        right_canvas: lockedRight !== undefined ? lockedRight : rightJson,
        logo_url: logoUrl,
        extra_image_url: extraImageUrl,
        fonts_used: Array.from(usedFontsRef.current),
        notes: notes || null,
      });

      if (isRepStudent) {
        // Rep-student (wholesaler-joined): keep the direct order flow.
        try {
          await configureOrder({
            productId: product.id,
            designId,
            selections: buildConfigureSelections(product, selection, customerImages, customerTexts),
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
      } else {
        // Retail student: add designed sash to cart, then go to cart.
        try {
          await addToCart(
            product.id,
            buildConfigureSelections(product, selection, customerImages, customerTexts),
            { designId }
          );
        } catch (e) {
          toast.error(getApiErrorMessage(e, "تعذر إضافة الوشاح للسلة — تواصل مع الدعم"));
          return false;
        }
        toast.success("أُضيف تصميمك إلى السلة");
        router.replace("/cart");
      }
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

  function pickGender(g: "male" | "female") {
    setGender(g);
    try { localStorage.setItem(GENDER_KEY, g); } catch { /* private mode */ }
  }

  return {
    router,
    bootLoading,
    bootError,
    studentStatus,
    completedLocked,
    editException,
    isRepStudent,
    gender,
    pickGender,
    product,
    sashChoices,
    selectSashProduct,
    selection,
    customerImages,
    setCustomerImages,
    customerTexts,
    setCustomerTexts,
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
    editableSide,
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
