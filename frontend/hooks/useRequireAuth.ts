"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMe } from "@/lib/auth-api";
import { getToken, setUser, logout } from "@/lib/auth";
import type { User, UserRole } from "@/lib/types";

export function useRequireAuth(allowedRole?: UserRole) {
  const router = useRouter();
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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

        if (allowedRole && me.role !== allowedRole) {
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
  }, [router, allowedRole]);

  return { user, loading };
}
