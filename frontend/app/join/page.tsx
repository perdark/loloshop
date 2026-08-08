"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { getJoinRepresentatives, type JoinRepresentative } from "@/lib/auth-api";

/**
 * «ادخل مع ممثلك» — the way in for a student who never got, or lost, their rep's link.
 *
 * WHY THIS PAGE EXISTS AT ALL. A referral link is the only door into a rep's cohort, and it
 * arrives on WhatsApp, where it is one message among hundreds. When it is gone the student had
 * no recovery: `referral_code` is an admin-typed Latin slug that nobody can be asked to type
 * from memory on an Arabic keyboard, and there is no deferred deep linking on iOS, so "install
 * the app and it will remember" is not available either
 * (docs/superpowers/specs/2026-08-07-app-entry-deeplinks-gps.md).
 *
 * So: one list, one tap, then hand off to the real /join/[code] flow — which still owns signup,
 * validation and the rep's one-by-one approval. This page only resolves a choice to a code; it
 * grants nothing.
 *
 * ⚠️ ONE GROUPED <select>, NOT جامعة→قسم IN TWO STEPS. This was built as two dependent
 * dropdowns first and the live data killed it: `university_name` is admin free text, and the 12
 * real rows spell one university three ways («بلاد الرافدين» · «بلاد الرفدين» · «كلية بلاد
 * الرافدين»; same for «جامعة ديالى» · «ديالى» · «جامعة ديالى كلية العلوم»). With two steps a
 * student who picks the wrong spelling gets an empty/foreign قسم list and concludes their rep
 * is not registered — a dead end with no error to report. One flat list grouped by <optgroup>
 * shows every rep on one screen, so a mis-spelled twin is visible instead of hidden, and the
 * قسم + الممثل on each row is enough to find yourself. Fix the data too, but the UI must not
 * depend on it being clean.
 *
 * NATIVE <select> ON PURPOSE. A custom listbox costs JS, focus management and a scroll trap on
 * a screen whose whole audience is students on low-end Android. The OS picker is faster, is
 * already RTL, already handles a long list, and is the control they use everywhere else.
 */
export default function JoinPickerPage() {
  const router = useRouter();
  const [reps, setReps] = useState<JoinRepresentative[] | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    // getJoinRepresentatives resolves [] instead of throwing, so a directory outage lands in
    // the empty state below rather than an unhandled rejection.
    getJoinRepresentatives().then((list) => {
      if (!cancelled) setReps(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Reps bucketed under their university, both ordered for a reader of Arabic. */
  const groups = useMemo(() => {
    const byUniversity = new Map<string, JoinRepresentative[]>();
    for (const rep of reps || []) {
      const list = byUniversity.get(rep.university_name);
      if (list) list.push(rep);
      else byUniversity.set(rep.university_name, [rep]);
    }
    // localeCompare with "ar": the default sort is by UTF-16 code unit, which orders Arabic
    // arbitrarily to anyone actually reading it.
    return [...byUniversity.entries()].sort((a, b) => a[0].localeCompare(b[0], "ar"));
  }, [reps]);

  const loading = reps === null;
  const empty = reps !== null && reps.length === 0;

  return (
    <AuthCard
      title="ادخل مع ممثلك"
      subtitle={empty ? undefined : "اختر ممثل جامعتك للانتقال إلى صفحة التسجيل"}
    >
      <div className="flex flex-1 flex-col">
        {loading && <div className="h-[4.4rem] animate-pulse rounded-xl bg-ink/5" aria-busy="true" />}

        {empty && (
          <p className="rounded-xl border border-line bg-beige px-3.5 py-3 text-sm leading-relaxed text-ink-soft">
            لا توجد قائمة ممثلين متاحة الآن. اطلب من ممثل جامعتك أن يرسل لك رابط التسجيل الخاص
            به.
          </p>
        )}

        {!loading && !empty && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="representative" className="text-sm font-medium text-ink">
              الجامعة والقسم
            </label>
            <select
              id="representative"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="min-h-12 rounded-xl border border-line bg-beige px-3.5 text-base text-ink shadow-[var(--shadow-soft)] outline-none transition-colors focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
            >
              <option value="">اختر من القائمة</option>
              {groups.map(([university, list]) => (
                <optgroup key={university} label={university}>
                  {list.map((rep) => (
                    // القسم — الممثل. The rep's name is what separates two rows of the same
                    // department, and reassures a student who was told a name but not a link.
                    <option key={rep.referral_code} value={rep.referral_code}>
                      {rep.department || "بدون قسم"} — {rep.wholesaler_name.trim()}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-xs leading-relaxed text-ink-soft">
              لا تجد قسمك؟ اطلب من ممثلك رابط التسجيل مباشرة.
            </p>
          </div>
        )}

        <div className="mt-auto space-y-4 pt-8">
          {!empty && (
            <button
              type="button"
              disabled={!code}
              onClick={() => router.push(`/join/${encodeURIComponent(code)}`)}
              className="inline-flex min-h-13 w-full items-center justify-center rounded-pill bg-orange-ink px-4 text-base font-semibold text-white shadow-[var(--shadow-soft)] transition-[background-color,transform] duration-200 ease-out hover:bg-ink active:translate-y-px disabled:opacity-50 disabled:hover:bg-orange-ink"
            >
              متابعة
            </button>
          )}
          <p className="text-center text-sm text-ink-soft">
            لديك حساب بالفعل؟{" "}
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center px-1 font-medium text-orange-ink underline-offset-4 hover:underline"
            >
              تسجيل الدخول
            </Link>
          </p>
        </div>
      </div>
    </AuthCard>
  );
}
