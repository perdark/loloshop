"use client";

import { useRouter } from "next/navigation";
import { logout } from "@/lib/auth";

export function StudentHeader() {
  const router = useRouter();

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <header className="border-b border-ink/10 bg-beige px-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-script text-2xl text-orange-ink">lolo shop</p>
          <p className="font-display text-sm font-semibold text-ink">لولو شوب</p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm font-medium text-ink/70 hover:bg-ink/5 active:bg-ink/10"
        >
          تسجيل الخروج
        </button>
      </div>
    </header>
  );
}
