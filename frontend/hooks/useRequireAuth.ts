"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMe } from "@/lib/auth-api";
import { getToken, getUser, setUser, logout } from "@/lib/auth";
import type { User, UserRole } from "@/lib/types";

/**
 * Guard the current page to one or more roles.
 *
 * Accepts either a single role string or an array of roles so that
 * mixed-access pages (e.g. staff + admin) can share a layout without
 * duplicating the auth check.
 *
 * Existing single-role callers (`useRequireAuth("admin")`) continue to work
 * unchanged.
 */
export function useRequireAuth(allowedRoles?: UserRole | UserRole[]) {
  const router = useRouter();
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Callers pass an inline array literal (`["staff","admin"]`) — a NEW reference
  // every render. Keying on the reference would re-run the effect on every
  // render → fetchMe → setState → render → infinite loop. Key on the CONTENT
  // (a stable string) instead so the effect only re-runs when the roles change.
  const rolesKey = !allowedRoles
    ? ""
    : Array.isArray(allowedRoles)
      ? allowedRoles.join(",")
      : allowedRoles;

  const rolesArray = useMemo<UserRole[] | undefined>(() => {
    if (!rolesKey) return undefined;
    return rolesKey.split(",") as UserRole[];
  }, [rolesKey]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const MAX_TRANSIENT_RETRIES = 4; // ~12s of /auth/me unreachable with no cached user

    function applyRole(u: User): boolean {
      // Returns true if the page should keep the user; false if it redirected.
      if (rolesArray && !rolesArray.includes(u.role)) {
        router.replace("/login");
        return false;
      }
      return true;
    }

    async function check() {
      const token = getToken();
      if (!token) {
        if (!cancelled) setLoading(false);
        router.replace("/login");
        return;
      }

      try {
        const me = await fetchMe();
        if (cancelled) return;
        setUser(me);
        setUserState(me);
        applyRole(me);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        // The response interceptor tears down the session (clears the token)
        // ONLY on a real /auth/me 401, so a now-missing token means the
        // auth-truth endpoint rejected us → genuinely log out + redirect.
        const sessionTornDown = !getToken();
        if (status === 401 || sessionTornDown) {
          logout();
          router.replace("/login");
          setLoading(false);
          return;
        }
        // Transient failure (network blip / 5xx / Neon cold-start) — do NOT
        // destroy the session. Fall back to the cached user if present, else
        // keep a loading state and retry shortly.
        const cached = getUser();
        if (cached) {
          setUserState(cached);
          applyRole(cached);
          setLoading(false);
          return;
        }
        // No cached user AND the auth-truth endpoint is unreachable. Retry a few
        // times (cold-start recovery), but don't spin forever — after the cap,
        // fall through to /login rather than leaving an indefinite <PageLoader/>.
        attempts += 1;
        if (attempts >= MAX_TRANSIENT_RETRIES) {
          logout();
          router.replace("/login");
          setLoading(false);
          return;
        }
        retryTimer = setTimeout(() => {
          if (!cancelled) check();
        }, 3000);
      }
    }

    check();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // rolesArray is derived from rolesKey; depending on the stable string key
    // keeps this effect from re-firing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, rolesKey]);

  return { user, loading };
}
