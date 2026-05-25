import { Suspense } from "react";
import { PageLoader } from "@/components/ui/Spinner";
import { VerifyOtpForm } from "@/components/auth/VerifyOtpForm";

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <VerifyOtpForm />
    </Suspense>
  );
}
