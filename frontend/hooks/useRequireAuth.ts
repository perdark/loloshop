"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMe } from "@/lib/auth-api";
import { getToken, setUser, logout } from "@/lib/auth";
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

  // Normalise to an array once so the effect dependency is stable across renders
  const rolesArray = useMemo<UserRole[] | undefined>(() => {
    if (!allowedRoles) return undefined;
    return Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  }, [allowedRoles]);

  useEffect(() => {
    let cancelled = false;

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

        if (rolesArray && !rolesArray.includes(me.role)) {
          router.replace("/login");
          return;
        }
      } catch {
        if (!cancelled) {
          logout();
          router.replace("/login");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [router, rolesArray]);

  return { user, loading };
}
