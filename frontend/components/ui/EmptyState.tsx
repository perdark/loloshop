interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink/15 bg-white/50 py-12 px-4 text-center">
      <p className="text-ink/60">{message}</p>
    </div>
  );
}
