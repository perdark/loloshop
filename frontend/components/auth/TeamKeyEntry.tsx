"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { getStaffPortalMembers } from "@/lib/auth-api";
import { getWorkshopPortalMembers } from "@/lib/workshop";
import { getDesignTeamPortalMembers } from "@/lib/design-team";

/**
 * In-app entrance for the three secret-key portals.
 *
 * WHY THIS EXISTS: staff without a phone (so no WhatsApp OTP), the Syrian workshop workers,
 * and the design team all log in by typing a SECRET URL — /s/<key>, /w/<key>, /d/<key>.
 * The native app is a webview with NO ADDRESS BAR, so those three groups literally cannot
 * reach their own login screen inside the app. This moves the secret from the URL bar into a
 * field.
 *
 * It deliberately does NOT reimplement login: it resolves which portal the key belongs to and
 * routes to the existing, already-verified portal page, which owns the member list + password
 * step. Zero duplicated auth logic.
 *
 * Security note: typing the key here is STRICTER than the URL it replaces — URLs leak through
 * browser history, WhatsApp link previews and referrer headers; a password field does not. The
 * backend is untouched and still answers a neutral 404 for a wrong key, so this is the same
 * oracle the URL already was, behind the same rate limiter.
 */

const PORTALS = [
  { path: "s", probe: getStaffPortalMembers },
  { path: "w", probe: getWorkshopPortalMembers },
  { path: "d", probe: getDesignTeamPortalMembers },
] as const;

/**
 * Accepts either a bare key or a whole pasted link. Staff were originally handed full URLs
 * over WhatsApp, so pasting one has to work — and when it matches, it names the portal
 * outright and we can skip probing entirely.
 */
function parseInput(raw: string): { key: string; path?: string } {
  const value = raw.trim();
  const fromUrl = value.match(/\/(s|w|d)\/([^/?#\s]+)/);
  if (fromUrl) return { key: fromUrl[2], path: fromUrl[1] };
  return { key: value.replace(/^\/+|\/+$/g, "") };
}

export function TeamKeyEntry() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { key: parsed, path } = parseInput(key);
    if (!parsed) {
      setError("الرمز مطلوب");
      return;
    }

    setError("");
    setLoading(true);
    try {
      // A pasted link already told us the portal — no need to probe the other two.
      if (path) {
        router.push(`/${path}/${encodeURIComponent(parsed)}`);
        return;
      }

      // Otherwise ask each portal in turn; a wrong key is a 404 on all three.
      for (const portal of PORTALS) {
        try {
          await portal.probe(parsed);
          router.push(`/${portal.path}/${encodeURIComponent(parsed)}`);
          return;
        } catch {
          // Wrong portal for this key — try the next one.
        }
      }
      setError("الرمز غير صحيح");
    } finally {
      setLoading(false);
    }
  }

  // Collapsed by default. This used to render its field unconditionally, so every student
  // arriving at /login was shown a secret-key box meant for staff, workshop and the design
  // team — three groups no student belongs to. It is now one quiet line at the very bottom.
  if (!open) {
    return (
      <p className="text-center text-sm">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center px-3 text-[var(--shop-muted)] underline-offset-4 transition-colors hover:text-orange-ink hover:underline"
        >
          فريق العمل؟
        </button>
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t border-line pt-5">
      <Input
        label="رمز الفريق"
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        error={error}
        autoComplete="off"
        autoFocus
      />
      <p className="text-xs text-[var(--shop-muted)]">
        للموظفين وعمّال الورشة وفريق التصميم — الرمز يعطيك إياه المدير.
      </p>
      <button
        type="submit"
        disabled={loading}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-pill bg-ink px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-200 ease-out hover:bg-orange-ink active:translate-y-px disabled:opacity-50"
      >
        {loading ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            <span>جارٍ التحقق…</span>
          </>
        ) : (
          "متابعة"
        )}
      </button>
      <p className="text-center text-sm">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-medium text-ink-soft underline-offset-2 hover:underline"
        >
          رجوع
        </button>
      </p>
    </form>
  );
}
