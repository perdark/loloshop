"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui/Spinner";

/**
 * The wholesaler-student package form now lives at /package (shared with retail).
 * This page redirects there so any existing links or bookmarks keep working.
 */
export default function WholesalerPackageRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/package");
  }, [router]);

  return <PageLoader />;
}
