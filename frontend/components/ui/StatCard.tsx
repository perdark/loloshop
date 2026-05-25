interface StatCardProps {
  label: string;
  value: string;
  accent?: "default" | "profit";
}

export function StatCard({ label, value, accent = "default" }: StatCardProps) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
      <p className="text-sm text-ink/60">{label}</p>
      <p
        className={`mt-1 font-display text-2xl font-bold lg:text-3xl ${
          accent === "profit" ? "text-emerald-700" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
