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
import {
  getUser,
  isAuthenticated,
  logout,
  logoutAndForgetDevice,
  loginHref,
} from "@/lib/auth";
import type { User } from "@/lib/types";
import { PageLoader } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ProfilePreferences } from "@/components/student/ProfilePreferences";
import {
  GraduateFemaleIcon,
  GraduateMaleIcon,
} from "@/components/student/GraduateIcons";
import { firstName, getProfile, PROFILE_CHANGED_EVENT, type Gender } from "@/lib/profile";
import { NotificationPrefs } from "@/components/NotificationPrefs";
import { DeviceNotificationPrefs } from "@/components/DeviceNotificationPrefs";

/** Row used for the account's navigation entries — icon · label · chevron. */
function AccountRow({
  href,
  label,
  hint,
  icon,
}: {
  href: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="btn-press flex items-center gap-3 rounded-[16px] border border-line bg-surface px-4 py-3.5 shadow-[var(--shadow-soft)] [-webkit-tap-highlight-color:transparent] hover:border-orange/40"
    >
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange/10 text-orange-ink"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-extrabold text-ink">{label}</span>
        <span className="block truncate text-[12.5px] text-[var(--shop-muted)]">{hint}</span>
      </span>
      {/* Points to the page edge in RTL — flipped with the logical direction. */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0 text-[var(--shop-muted)] rtl:rotate-180"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Link>
  );
}

const IconBag = (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

const IconReturn = (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7v6h6" />
    <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
  </svg>
);

/**
 * The account avatar. Reuses the onboarding graduate figures so the gender answer
 * becomes something the student SEES as themselves, not a buried setting.
 * Falls back to the brand mark when the question was skipped — a neutral disc is
 * better than picking one of the two on a visitor's behalf.
 */
function Avatar({ gender }: { gender: Gender | null }) {
  return (
    <span
      aria-hidden
      className="flex h-[58px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-beige ring-1 ring-ink/10"
    >
      {gender === "female" ? (
        <GraduateFemaleIcon size={54} />
      ) : gender === "male" ? (
        <GraduateMaleIcon size={54} />
      ) : (
        <span className="font-script text-[26px] leading-none text-orange-ink">lolo</span>
      )}
    </span>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Auth is resolved after mount — reading localStorage during render would
  // mismatch the server-rendered HTML.
  const [authed, setAuthed] = useState<boolean | null>(null);
  // Device profile — drives the avatar and the greeting. Read after mount (see the
  // note on `authed`), and re-read on change so editing «تفضيلاتي» updates the
  // header on this very screen instead of needing a reload.
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileGender, setProfileGender] = useState<Gender | null>(null);

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

  useEffect(() => {
    const sync = () => {
      const p = getProfile();
      setProfileName(firstName(p.name));
      setProfileGender(p.gender);
    };
    sync();
    window.addEventListener(PROFILE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PROFILE_CHANGED_EVENT, sync);
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

  // Signed out is NOT an empty screen: the device preferences onboarding
  // collected are editable here, which is what makes its «تنعدّل بأي وقت من
  // حسابي» true for a visitor who never made an account.
  if (!authed) {
    return (
      <section className="animate-fade-page-in py-2">
        <h1 className="font-display text-2xl font-bold text-ink">حسابي</h1>

        {/* The signed-out screen is not a login wall with a form on it. A visitor who
            already went through onboarding has a name and a register — greeting them
            with it is the difference between "an account page" and "your page". */}
        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-soft)]">
          <div className="flex items-center gap-3.5 bg-orange/[0.07] px-4 py-5">
            <Avatar gender={profileGender} />
            <div className="min-w-0">
              <p className="text-[17px] font-extrabold text-ink">
                {profileName ? `أهلاً ${profileName}` : "أهلاً بك"}
              </p>
              <p className="mt-0.5 text-[13px] text-[var(--shop-muted)]">
                {profileName ? "سجّل الدخول لتتابع طلباتك" : "سجّل الدخول أو أنشئ حساباً"}
              </p>
            </div>
          </div>

          <div className="px-4 py-4">
            <ul className="space-y-2">
              {[
                "تابع حالة طلبك خطوة بخطوة",
                "احفظ تصاميمك وسلّتك",
                "اطلب لنفسك أو لدفعتك كاملة",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-[13.5px] text-ink">
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    className="mt-[3px] h-4 w-4 shrink-0 text-orange-ink"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m20 6-11 11-5-5" />
                  </svg>
                  {line}
                </li>
              ))}
            </ul>

            <Link href={loginHref("/account")} className="mt-5 block">
              <Button fullWidth size="lg">
                تسجيل الدخول
              </Button>
            </Link>
            <Link href="/register" className="mt-2.5 block">
              <Button variant="ghost" fullWidth>
                إنشاء حساب جديد
              </Button>
            </Link>
          </div>
        </div>

        <ProfilePreferences />

        {/* ⚠️ THE SIGNED-OUT OPT-OUT, AND IT IS A STORE REQUIREMENT (migration 095). Since a
            handset can receive promotional push without ever having an account, Apple 4.5.4's
            «a way to opt out from inside the app» has to be reachable by someone who has no
            account to sign into. It renders nothing unless this phone actually has a device
            row, so a browser sees no stray switch. */}
        <DeviceNotificationPrefs />
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

      {/* Identity card — the avatar is the same graduate figure the gender question
          uses, so the answer a student gave in onboarding visibly becomes *them*
          rather than a setting filed away somewhere. */}
      <div className="mt-5 flex items-center gap-3.5 rounded-2xl border border-line bg-surface px-4 py-4 shadow-[var(--shadow-soft)]">
        <Avatar gender={profileGender} />
        <div className="min-w-0">
          <p className="truncate text-[17px] font-extrabold text-ink">{user?.name || "—"}</p>
          {user?.phone && (
            <p className="mt-0.5 text-[13.5px] text-[var(--shop-muted)]" dir="ltr">
              {user.phone}
            </p>
          )}
        </div>
      </div>

      {/* Was two ghost pills side by side, which read as actions rather than places.
          Rows with an icon and a chevron say "this goes somewhere", and give each
          destination a line of explanation. */}
      <div className="mt-4 grid gap-2.5">
        <AccountRow
          href="/my-order"
          label="طلباتي"
          hint="تابع حالة كل طلب"
          icon={IconBag}
        />
        <AccountRow
          href="/returned-orders"
          label="الطلبات المُعادة"
          hint="الطلبات التي رجعت للتعديل"
          icon={IconReturn}
        />
      </div>

      <ProfilePreferences />

      {/* Logout lives here now. It used to sit in the storefront header, which
          the tab bar replaced — without this there would be no way to sign out. */}
      <button
        type="button"
        onClick={() => {
          logout();
          router.push("/login");
        }}
        className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-pill border border-line bg-surface text-sm font-bold text-ink-soft transition-colors hover:border-orange-ink/30 hover:text-orange-ink"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
        تسجيل الخروج
      </button>

      {/* «شنو تريد يوصلك؟» — sits ABOVE the danger zone deliberately: a student looking for a
          way to stop notifications must find this before they find «حذف الحساب». Apple 4.5.4
          requires the opt-out to exist in the app; putting it after account deletion would
          satisfy the letter of that and none of its point. */}
      <NotificationPrefs />

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
