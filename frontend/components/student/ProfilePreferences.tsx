"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getProfile, saveProfile, type Gender } from "@/lib/profile";

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
      <div className="mt-2 grid grid-cols-2 gap-2.5" role="group" aria-labelledby="pref-sex">
        {(
          [
            ["female", "طالبة"],
            ["male", "طالب"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={gender === value}
            onClick={() => {
              setGender(value);
              setDirty(true);
            }}
            className={`min-h-12 rounded-pill border text-sm font-bold transition-colors ${
              gender === value
                ? "border-orange-ink bg-orange/10 text-orange-ink"
                : "border-line bg-beige text-ink-soft"
            }`}
          >
            {label}
          </button>
        ))}
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
