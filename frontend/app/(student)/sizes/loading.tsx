import { GradCapLoader } from "@/components/ui/GradCapLoader";

export default function Loading() {
  return (
    <div
      dir="rtl"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4"
    >
      <GradCapLoader size={72} />
      <p className="text-xs font-medium tracking-wide text-[var(--shop-muted)]">
        جارٍ التحميل…
      </p>
    </div>
  );
}
