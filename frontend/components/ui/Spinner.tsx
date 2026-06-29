export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`h-8 w-8 animate-spin rounded-full border-2 border-orange border-t-transparent ${className}`}
      role="status"
      aria-label="جاري التحميل"
    />
  );
}

export function PageLoader() {
  return (
    <div
      className="flex min-h-[40vh] flex-col items-center justify-center gap-4"
      suppressHydrationWarning
    >
      <Spinner className="h-12 w-12" />
      <p className="text-xs font-medium tracking-wide text-[var(--shop-muted)]" suppressHydrationWarning>
        جارٍ التحميل…
      </p>
    </div>
  );
}
