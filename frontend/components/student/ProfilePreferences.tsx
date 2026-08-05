"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { copyFor } from "@/lib/copy-ar";
import { getProfile, saveProfile, type Gender } from "@/lib/profile";
import { GraduateFemaleIcon, GraduateMaleIcon } from "./GraduateIcons";
import { GenderRow } from "./Onboarding";

/**
 * «تفضيلاتي» — the edit screen for the two answers onboarding collects.
 *
 * It renders for signed-OUT visitors too, and that is the point: onboarding
 * tells the visitor «تنعدّل بأي وقت من حسابي», and a guest who taps حسابي used
 * to get nothing but a login wall — which would have made that sentence a lie.
 * These preferences live on the device, so they are editable without an account.
 *
 * ⚠️ WHY THE GENDER PICKER IS COLLAPSED BY DEFAULT (owner report, 2026-08-04:
 * «why shows the gender again and we choice it?»)
 *
 * This screen used to render the two gender rows permanently expanded — the exact
 * same control onboarding asks with. The intent was consistency, but the effect was
 * that a student who had ALREADY answered opened «حسابي» and was met with
 * «طالب لو طالبة؟» and two empty-looking options, which reads as *being asked
 * again* rather than *being shown their answer*. An answered question and an
 * unanswered one must not look identical.
 *
 * So: once answered, the screen SHOWS the answer as a settled summary row with a
 * «تغيير» affordance, and only reveals the picker on demand. When there is no
 * answer yet (a visitor who skipped onboarding) the picker opens straight away,
 * because then it genuinely is an open question.
 */
export function ProfilePreferences() {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editingGender, setEditingGender] = useState(false);

  // localStorage is client-only — read after mount, never during render.
  useEffect(() => {
    const p = getProfile();
    setName(p.name ?? "");
    setGender(p.gender);
    // Unanswered → open the picker; answered → show it settled.
    setEditingGender(p.gender === null);
    setLoaded(true);
  }, []);

  if (!loaded) return null;

  function save() {
    saveProfile({ name: name.trim() || null, gender, seen: true });
    setDirty(false);
    setEditingGender(gender === null);
    toast.success("تم الحفظ");
  }

  const genderLabel = gender === "female" ? "طالبة" : gender === "male" ? "طالب" : null;
  const GenderIcon = gender === "female" ? GraduateFemaleIcon : GraduateMaleIcon;

  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]">
      <h2 className="font-display text-lg font-bold text-ink">تفضيلاتي</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--shop-muted)]">
        تُستخدم لعرض الخيارات والمقاسات الصحيحة ولمخاطبتك بالشكل الصحيح — محفوظة
        على هذا الجهاز.
      </p>

      <label className="mt-4 block text-[13px] font-bold text-ink" htmlFor="pref-name">
        الاسم
      </label>
      <input
        id="pref-name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setDirty(true);
        }}
        placeholder="مثال: سارة أحمد"
        autoComplete="off"
        className="mt-2 min-h-12 w-full rounded-[12px] border border-line bg-beige px-4 text-base font-semibold text-ink transition-colors placeholder:font-medium placeholder:text-[var(--shop-muted)] focus-visible:border-orange-ink focus-visible:outline-none"
      />

      {gender !== null && !editingGender ? (
        /* SETTLED — this is the answer, not the question. */
        <div className="mt-4">
          <span className="block text-[13px] font-bold text-ink">المخاطبة</span>
          <div className="mt-2 flex items-center gap-3 rounded-[14px] border border-line bg-beige px-3 py-2.5">
            <GenderIcon size={44} />
            <div className="min-w-0">
              <p className="text-[15px] font-extrabold text-ink">{genderLabel}</p>
              <p className="truncate text-[12px] text-[var(--shop-muted)]">
                {copyFor(gender).greetSub}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditingGender(true)}
              className="ms-auto min-h-11 shrink-0 rounded-pill px-3 text-[13px] font-bold text-orange-ink transition-colors hover:bg-orange/10"
            >
              تغيير
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <span className="block text-[13px] font-bold text-ink" id="pref-sex">
            طالب لو طالبة؟
          </span>
          {/* The same rows onboarding asks with, deliberately — this edits that exact
              answer, and a different-looking control for one field is how a visitor
              ends up unsure whether they already answered it. */}
          <div className="mt-2 flex flex-col gap-2.5" role="group" aria-labelledby="pref-sex">
            <GenderRow
              label="طالبة"
              active={gender === "female"}
              onClick={() => {
                setGender("female");
                setDirty(true);
              }}
              icon={<GraduateFemaleIcon size={58} />}
            />
            <GenderRow
              label="طالب"
              active={gender === "male"}
              onClick={() => {
                setGender("male");
                setDirty(true);
              }}
              icon={<GraduateMaleIcon size={58} />}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={!dirty}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-pill bg-orange-ink px-5 text-sm font-bold text-white transition-[opacity,transform] duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
      >
        حفظ التفضيلات
      </button>
    </section>
  );
}
