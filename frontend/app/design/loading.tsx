import { GradCapLoader } from "@/components/ui/GradCapLoader";

export default function Loading() {
  return (
    <div
      dir="rtl"
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream"
    >
      <GradCapLoader size={72} />
      <p className="text-xs font-medium tracking-wide text-ink/45">
        جارٍ التحميل…
      </p>
    </div>
  );
}
