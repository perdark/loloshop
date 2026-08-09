"use client";

/**
 * The visitor profile — the two things onboarding asks for, kept on the device.
 *
 * Why this exists at all: a browsing visitor has no account, but the storefront
 * still needs to know
 *   · الاسم  — so the app greets a person instead of a session, and
 *   · طالب/طالبة — which is NOT decoration. Products carry `genderRestriction`,
 *     and the backend's priceSelections() refuses gender-restricted options when
 *     the student's gender is null. Guessing it is how the 2026-07-26 session
 *     silently built the WRONG order after Chrome autofilled a <select>.
 *
 * Deliberately localStorage and NOT the account: this is asked before anyone has
 * signed up. For a signed-in student the DB is the source of truth and the
 * onboarding never runs (see hasAccountProfile in the Onboarding component).
 */

export type Gender = "male" | "female";

export interface VisitorProfile {
  name: string | null;
  gender: Gender | null;
  /** true once the visitor has SEEN onboarding — including skipping it. */
  seen: boolean;
}

const KEY = "loloshop_profile";

/** Same-tab notification. The native `storage` event only fires in OTHER tabs,
 *  so without this the nav greeting would not react to its own form. */
export const PROFILE_CHANGED_EVENT = "loloshop:profile-changed";

const EMPTY: VisitorProfile = { name: null, gender: null, seen: false };

export function getProfile(): VisitorProfile {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<VisitorProfile>;
    const gender =
      parsed.gender === "male" || parsed.gender === "female" ? parsed.gender : null;
    const name =
      typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null;
    return { name, gender, seen: parsed.seen === true };
  } catch {
    // Corrupt or unavailable storage (private mode, quota) must never break the
    // storefront — the visitor just gets the neutral copy.
    return EMPTY;
  }
}

export function saveProfile(next: Partial<VisitorProfile>): VisitorProfile {
  const merged: VisitorProfile = { ...getProfile(), ...next };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(merged));
      window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
    } catch {
      /* ignore — see getProfile */
    }
  }
  return merged;
}

/** Onboarding shows only when it has never been seen. Skipping counts as seen:
 *  a visitor who declined must not be asked again on every visit. */
export function hasSeenOnboarding(): boolean {
  return getProfile().seen;
}

export function clearProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

/** First name only — «أهلاً سارة أحمد الكاظمي» reads like a form receipt. */
export function firstName(name: string | null): string | null {
  if (!name) return null;
  return name.trim().split(/\s+/)[0] || null;
}
