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
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="h-10 w-10" />
    </div>
  );
}
