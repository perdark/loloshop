"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import {
  type Cart,
  type CartItem,
  checkout,
  getCart,
  removeCartItem,
  updateCartItem,
} from "@/lib/cart";
import { formatIQD } from "@/lib/format";
import { PRODUCT_TYPE_LABELS } from "@/lib/constants";
import type { ProductType } from "@/lib/types";
import { getMyOrders, type StudentOrder } from "@/lib/orders";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { MyOrdersList } from "@/components/student/MyOrdersList";
import { VipUpsellCard } from "@/components/vip/VipUpsellCard";
import { isAuthenticated, loginHref } from "@/lib/auth";

function CartSkeleton() {
  return (
    <div className="animate-fade-page-in space-y-4 pb-32" aria-busy="true">
      <span className="sr-only">جارٍ تحميل السلة…</span>
      <div className="skeleton h-7 w-1/3 rounded-xl" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3 rounded-2xl bg-surface p-3">
          <div className="skeleton h-20 w-16 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="skeleton h-4 w-2/3 rounded-pill" />
            <div className="skeleton h-3 w-1/3 rounded-pill" />
            <div className="skeleton h-8 w-24 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Quantity stepper — plus/minus with 44 px tap targets. */
function QtyStepper({
  qty,
  itemId,
  onUpdate,
}: {
  qty: number;
  itemId: string;
  onUpdate: (id: string, qty: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0 rounded-xl border border-line bg-[var(--shop-sink)] text-sm font-semibold text-ink">
      <button
        type="button"
        aria-label="تقليل الكمية"
        disabled={qty <= 1}
        onClick={() => onUpdate(itemId, qty - 1)}
        className="flex h-11 w-11 items-center justify-center rounded-s-xl text-ink-soft transition-colors hover:bg-line active:bg-line disabled:opacity-40"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M5 12h14" />
        </svg>
      </button>
      <span className="w-8 select-none text-center tabular-nums">{qty}</span>
      <button
        type="button"
        aria-label="زيادة الكمية"
        onClick={() => onUpdate(itemId, qty + 1)}
        className="flex h-11 w-11 items-center justify-center rounded-e-xl text-ink-soft transition-colors hover:bg-line active:bg-line"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}

function CartRow({
  item,
  onUpdate,
  onRemove,
}: {
  item: CartItem;
  onUpdate: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
}) {
  const lineTotal = item.priceSnapshot * item.qty;
  return (
    <article className="flex gap-3 rounded-2xl bg-surface p-3 shadow-[var(--shadow-soft)] ring-1 ring-line">
      {/* Thumbnail */}
      <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-[var(--shop-sink)]">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.productName}
            fill
            className="object-cover"
            sizes="64px"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center font-script text-xl text-orange-ink/30">
            lolo
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="line-clamp-2 font-display-ar text-sm font-semibold leading-relaxed text-ink">
          {item.productName}
        </p>
        <p className="text-xs text-[var(--shop-muted)]" dir="ltr">
          {formatIQD(item.priceSnapshot)} × {item.qty} = {formatIQD(lineTotal)}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2">
          <QtyStepper qty={item.qty} itemId={item.id} onUpdate={onUpdate} />
          <button
            type="button"
            aria-label={`حذف ${item.productName}`}
            onClick={() => onRemove(item.id)}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-danger/10 hover:text-danger active:scale-95"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  );
}

const GRADUATION_LOOK: ProductType[] = ["sash", "robe", "cap"];

/**
 * Shows which graduation-look pieces are missing from the cart and
 * offers a CTA to the shop pre-filtered to those types.
 * Renders nothing if the look is already complete.
 */
function MissingPiecesCard({ cartItems }: { cartItems: CartItem[] }) {
  const presentTypes = new Set(cartItems.map((it) => it.productType));
  const missing = GRADUATION_LOOK.filter((t) => !presentTypes.has(t));

  if (missing.length === 0) {
    return (
      <p className="text-center text-sm font-medium text-ink-soft">
        إطلالتك مكتملة ✓
      </p>
    );
  }

  const missingLabels = missing
    .map((t) => PRODUCT_TYPE_LABELS[t as ProductType])
    .join(" + ");
  const href = `/?need=${missing.join(",")}`;

  return (
    <Link
      href={href}
      className="group relative flex items-center gap-4 overflow-hidden rounded-[var(--radius-card)] border border-orange/25 bg-warm-veil p-5 shadow-[var(--shadow-card)] transition-all duration-250 hover:border-orange/45 hover:shadow-[var(--shadow-float)] active:scale-[0.99] card-lift"
    >
      {/* Icon */}
      <span
        aria-hidden
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white shadow-[var(--shadow-card)]"
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <path d="M22 4 12 14.01l-3-3" />
        </svg>
      </span>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className="font-display-ar text-base font-bold text-ink">
          أكمل إطلالة تخرّجك
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          ينقصك: {missingLabels}
        </p>
      </div>

      {/* RTL arrow — points inward (to the right in RTL) */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-5 w-5 shrink-0 text-orange-ink transition-transform duration-200 group-hover:-translate-x-0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Link>
  );
}

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [done, setDone] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  // The student's submitted orders — shown when the cart is empty so a completed
  // checkout doesn't dead-end on a blank cart.
  const [myOrders, setMyOrders] = useState<StudentOrder[]>([]);

  const authed = isAuthenticated();

  const loadMyOrders = useCallback(() => {
    if (!isAuthenticated()) return;
    getMyOrders()
      .then(setMyOrders)
      .catch(() => setMyOrders([]));
  }, []);

  const loadCart = useCallback(async () => {
    if (!isAuthenticated()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const c = await getCart();
      setCart(c);
    } catch (e) {
      setLoadError(true);
      toast.error(getApiErrorMessage(e, "تعذر تحميل السلة"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCart();
    loadMyOrders();
  }, [loadCart, loadMyOrders]);

  async function handleUpdate(id: string, qty: number) {
    if (updatingIds.has(id)) return;
    setUpdatingIds((prev) => new Set(prev).add(id));
    try {
      await updateCartItem(id, qty);
      setCart((prev) => {
        if (!prev) return prev;
        const items = prev.items.map((it) =>
          it.id === id ? { ...it, qty } : it
        );
        return {
          ...prev,
          items,
          total: items.reduce((s, it) => s + it.priceSnapshot * it.qty, 0),
        };
      });
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحديث الكمية"));
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleRemove(id: string) {
    try {
      await removeCartItem(id);
      setCart((prev) => {
        if (!prev) return prev;
        const items = prev.items.filter((it) => it.id !== id);
        return {
          ...prev,
          items,
          total: items.reduce((s, it) => s + it.priceSnapshot * it.qty, 0),
        };
      });
      toast.success("تمت الإزالة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حذف العنصر"));
    }
  }

  async function handleCheckout() {
    if (!cart || cart.items.length === 0) return;
    setCheckingOut(true);
    const hasCustomizable = cart.items.some((it) => it.customizable);
    try {
      await checkout();
      toast.success("تم تأكيد طلبك");
      loadMyOrders();
      if (hasCustomizable) {
        router.push("/design");
      } else {
        setDone(true);
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر إتمام الطلب — سجّل دخولك كطالب"));
    } finally {
      setCheckingOut(false);
    }
  }

  if (!authed) {
    return (
      <div className="space-y-4 py-8">
        <BackLink />
        <EmptyState
          title="سجّل دخولك لإكمال طلبك"
          message="سلة التسوق متاحة بعد تسجيل الدخول — تصفّحك محفوظ."
          action={
            <div className="flex flex-col items-center gap-3">
              <Link
                href={loginHref("/cart")}
                className="btn-shine inline-flex min-h-[44px] w-full max-w-[240px] items-center justify-center gap-2 rounded-pill bg-brand-gradient px-7 text-sm font-bold text-white shadow-[var(--shadow-card)]"
              >
                تسجيل الدخول
              </Link>
              <Link
                href="/"
                className="inline-flex min-h-[44px] items-center justify-center gap-1 text-sm font-semibold text-orange-ink transition-colors hover:text-ink"
              >
                تابع التصفّح
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  if (loading) return <CartSkeleton />;

  if (loadError) {
    return (
      <div className="space-y-4 py-8">
        <BackLink />
        <EmptyState
          title="تعذر تحميل السلة"
          message="تحقق من الاتصال ثم حاول مجدداً."
          action={
            <Button variant="ghost" onClick={loadCart}>
              إعادة المحاولة
            </Button>
          }
        />
      </div>
    );
  }

  if (done) {
    return (
      <div className="py-12 animate-page-in">
        <BackLink />
        <div className="mt-10 flex flex-col items-center gap-5 text-center">
          <span
            aria-hidden
            className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-gradient text-white shadow-[var(--shadow-float)]"
          >
            <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <h1 className="font-display-ar text-2xl font-bold text-ink">
            تم تأكيد طلبك
          </h1>
          <p className="max-w-[32ch] text-sm leading-relaxed text-ink-soft">
            سيصلك طلبك ويُدفع نقداً عند الاستلام. شكراً لثقتك بلولو شوب.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setDone(false)}
              className="inline-flex min-h-12 items-center gap-2 rounded-pill border border-orange-ink/30 bg-surface px-6 text-sm font-bold text-orange-ink transition-colors hover:bg-orange-ink/10"
            >
              عرض طلباتي
            </button>
            <Link
              href="/"
              className="btn-shine inline-flex min-h-12 items-center gap-2 rounded-pill bg-brand-gradient px-7 text-sm font-bold text-white shadow-[var(--shadow-card)]"
            >
              متابعة التسوق
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isEmpty = !cart || cart.items.length === 0;

  return (
    <div className="space-y-4 pb-36">
      <BackLink />

      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display-ar text-2xl font-bold text-ink">سلة التسوق</h1>
        {!isEmpty && (
          <span className="rounded-full bg-orange/10 px-3 py-1 text-sm font-semibold text-orange-ink">
            {cart.items.length} عنصر
          </span>
        )}
      </div>

      {isEmpty ? (
        myOrders.length > 0 ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-line bg-surface-sink/60 px-4 py-3 text-sm text-ink-soft">
              سلتك فارغة — في الأسفل طلباتك وحالتها.
            </div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display-ar text-lg font-bold text-ink">طلباتي</h2>
              <Link href="/" className="text-sm font-semibold text-orange-ink hover:underline">
                تصفّح المتجر
              </Link>
            </div>
            <MyOrdersList orders={myOrders} />
          </div>
        ) : (
          <EmptyState
            title="السلة فارغة"
            message="أضف منتجات من المتجر لتبدأ طلبك."
            action={
              <Link
                href="/"
                className="btn-shine inline-flex min-h-11 items-center gap-2 rounded-pill bg-brand-gradient px-6 text-sm font-bold text-white shadow-[var(--shadow-soft)]"
              >
                تصفّح المتجر
              </Link>
            }
          />
        )
      ) : (
        <>
          {/* Items */}
          <div className="space-y-3">
            {cart.items.map((item) => (
              <CartRow
                key={item.id}
                item={item}
                onUpdate={handleUpdate}
                onRemove={handleRemove}
              />
            ))}
          </div>

          {/* Missing pieces — one card only, not a grid */}
          <MissingPiecesCard cartItems={cart.items} />

          {/* VIP upsell — upgrade an existing bundle, or discover VIP */}
          <VipUpsellCard onUpgraded={loadCart} />

          {/* Total */}
          <div className="flex items-center justify-between rounded-[var(--radius-card)] bg-warm-veil border border-orange/20 px-5 py-4 shadow-[var(--shadow-soft)]">
            <span className="text-sm font-semibold text-ink-soft">المجموع الكلي</span>
            <span className="font-display-ar text-2xl font-bold text-ink" dir="ltr">
              {formatIQD(cart.total)}
            </span>
          </div>
          <p className="text-center text-xs text-[var(--shop-muted)]">
            الدفع نقداً عند الاستلام، لا دفع إلكتروني
          </p>
        </>
      )}

      {/* Sticky checkout bar */}
      {!isEmpty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line surface-glass px-4 py-3.5 shadow-[var(--shadow-float)]">
          <div className="mx-auto max-w-lg">
            <Button
              fullWidth
              size="lg"
              loading={checkingOut}
              disabled={checkingOut || isEmpty}
              onClick={handleCheckout}
            >
              {checkingOut ? "جارٍ تأكيد الطلب…" : "إتمام الطلب"}
            </Button>
            <p className="mt-1.5 text-center text-xs text-[var(--shop-muted)]">
              {formatIQD(cart.total)} — الدفع نقداً عند الاستلام
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-orange-ink transition-colors hover:text-ink"
    >
      <span aria-hidden>→</span>
      المتجر
    </Link>
  );
}
