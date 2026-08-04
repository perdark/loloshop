"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
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
 */
export function ProfilePreferences() {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);

  // localStorage is client-only — read after mount, never during render.
  useEffect(() => {
    const p = getProfile();
    setName(p.name ?? "");
    setGender(p.gender);
    setLoaded(true);
  }, []);

  if (!loaded) return null;

  function save() {
    saveProfile({ name: name.trim() || null, gender, seen: true });
    setDirty(false);
    toast.success("تم الحفظ");
  }

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
        className="mt-2 min-h-12 w-full rounded-[12px] border border-line bg-beige px-4 text-base font-semibold text-ink placeholder:font-medium placeholder:text-[var(--shop-muted)] focus-visible:border-orange-ink focus-visible:outline-none"
      />

      <span className="mt-4 block text-[13px] font-bold text-ink" id="pref-sex">
        طالب لو طالبة؟
      </span>
      {/* The same rows onboarding asks with, deliberately — this screen edits
          that exact answer, and a different-looking control for one field is how
          a visitor ends up unsure whether they already answered it. */}
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

      <button
        type="button"
        onClick={save}
        disabled={!dirty}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-pill bg-orange-ink px-5 text-sm font-bold text-white transition-opacity disabled:pointer-events-none disabled:opacity-40"
      >
        حفظ التفضيلات
      </button>
    </section>
  );
}
