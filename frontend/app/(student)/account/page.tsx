"use client";

// حسابي — the student's own account screen, and the home of self-service account
// deletion (Apple App Store guideline 5.1.1(v)).
//
// Apple rejected the first iOS submission because the app let a student create an
// account but never delete one. It has to be reachable from inside the app, without
// contacting anyone, so this page is linked from the header on every storefront
// screen — not buried behind an external link.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { getDeletionPreview, deleteAccount, type DeletionPreview } from "@/lib/auth-api";
import { getApiErrorMessage } from "@/lib/api";
import { getUser, isAuthenticated, logoutAndForgetDevice, loginHref } from "@/lib/auth";
import type { User } from "@/lib/types";
import { PageLoader } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Auth is resolved after mount — reading localStorage during render would
  // mismatch the server-rendered HTML.
  const [authed, setAuthed] = useState<boolean | null>(null);

  // Deletion is a two-step commitment: read the consequences, then confirm with
  // the password. `confirming` is the second step.
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState<string | undefined>();
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const ok = isAuthenticated();
    setAuthed(ok);
    if (!ok) return;
    setUser(getUser());
    getDeletionPreview()
      .then(setPreview)
      .catch(() => setLoadError(true));
  }, []);

  async function handleDelete() {
    if (!password) {
      setPwError("أدخل كلمة المرور لتأكيد الحذف");
      return;
    }
    setDeleting(true);
    setPwError(undefined);
    try {
      await deleteAccount(password);
      // The token died server-side with this call, so no further request can
      // succeed. Clear local state first, then show the receipt.
      logoutAndForgetDevice();
      setDone(true);
    } catch (err) {
      const message = getApiErrorMessage(err, "تعذر حذف الحساب");
      setPwError(message);
      toast.error(message);
      setDeleting(false);
    }
  }

  if (authed === null) return <PageLoader />;

  if (!authed) {
    return (
      <section className="py-10 text-center">
        <h1 className="font-display text-2xl font-bold text-ink">حسابي</h1>
        <p className="mt-3 text-sm text-ink-soft">سجّل الدخول لعرض حسابك أو حذفه.</p>
        <Link href={loginHref("/account")} className="mt-6 inline-block">
          <Button>تسجيل الدخول</Button>
        </Link>
      </section>
    );
  }

  // Terminal state — the account no longer exists, so there is nothing left to
  // show and no request left to make.
  if (done) {
    return (
      <section className="py-10 text-center">
        <div
          aria-hidden
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-beige text-orange-ink"
        >
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold text-ink">تم حذف حسابك</h1>
        <p className="mx-auto mt-3 max-w-[42ch] text-sm leading-relaxed text-ink-soft">
          حُذف حسابك وبياناتك الشخصية نهائياً، ولا يمكن تسجيل الدخول إليه مرة أخرى. يمكنك
          إنشاء حساب جديد بنفس رقم الهاتف في أي وقت.
        </p>
        <Button className="mt-7" onClick={() => router.replace("/")}>
          العودة إلى المتجر
        </Button>
      </section>
    );
  }

  return (
    <section className="py-2">
      <h1 className="font-display text-2xl font-bold text-ink">حسابي</h1>

      {/* Identity card */}
      <div className="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]">
        <p className="text-base font-bold text-ink">{user?.name || "—"}</p>
        {user?.phone && (
          <p className="mt-1 text-sm text-ink-soft" dir="ltr">
            {user.phone}
          </p>
        )}
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        <Link href="/my-order" className="block">
          <Button variant="ghost" fullWidth>
            طلباتي
          </Button>
        </Link>
        <Link href="/returned-orders" className="block">
          <Button variant="ghost" fullWidth>
            الطلبات المُعادة
          </Button>
        </Link>
      </div>

      {/* ---- Danger zone ---- */}
      <div className="mt-8 rounded-2xl border border-danger/30 bg-surface p-4">
        <h2 className="font-display text-lg font-bold text-ink">حذف الحساب</h2>

        {loadError ? (
          <p className="mt-2 text-sm text-danger">
            تعذر تحميل بيانات الحساب. تحقق من الاتصال وحدّث الصفحة.
          </p>
        ) : preview && !preview.eligible ? (
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{preview.reason_ar}</p>
        ) : (
          <>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              حذف الحساب نهائي ولا يمكن التراجع عنه. سيتم حذف اسمك، رقم هاتفك، حساب
              إنستقرام، سلة التسوق والإشعارات، ولن تتمكن من تسجيل الدخول مرة أخرى.
            </p>

            {/* The one thing a student must not discover afterwards. Apple allows a
                confirmation step; hiding this would just be a nasty surprise. */}
            {preview && preview.active_orders > 0 && (
              <p className="mt-3 rounded-xl border border-orange/30 bg-beige p-3 text-sm leading-relaxed text-ink">
                لديك{" "}
                <span className="font-bold">
                  {preview.active_orders === 1 ? "طلب واحد" : `${preview.active_orders} طلبات`}
                </span>{" "}
                قيد التنفيذ. حذف الحساب <span className="font-bold">لا يلغي الطلب</span> — سيستمر
                تجهيزه وتسليمه حسب المعلومات المسجّلة عليه، ويحتفظ المتجر بسجل الطلب
                للمحاسبة.
              </p>
            )}

            {!confirming ? (
              <Button
                variant="danger"
                className="mt-4"
                onClick={() => setConfirming(true)}
                disabled={!preview}
              >
                حذف حسابي نهائياً
              </Button>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                <p className="text-sm font-semibold text-ink">
                  أدخل كلمة المرور لتأكيد الحذف
                </p>
                <Input
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  placeholder="كلمة المرور"
                  error={pwError}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPwError(undefined);
                  }}
                />
                <div className="flex flex-wrap gap-2.5">
                  <Button variant="danger" loading={deleting} onClick={handleDelete}>
                    تأكيد الحذف النهائي
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={deleting}
                    onClick={() => {
                      setConfirming(false);
                      setPassword("");
                      setPwError(undefined);
                    }}
                  >
                    تراجع
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
