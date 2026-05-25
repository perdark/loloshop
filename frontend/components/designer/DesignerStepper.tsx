interface DesignerStepperProps {
  step: 1 | 2 | 3;
}

const STEPS = [
  { num: 1, label: "اختر اللون" },
  { num: 2, label: "صمم الوشاح" },
  { num: 3, label: "تأكيد التصميم" },
] as const;

export function DesignerStepper({ step }: DesignerStepperProps) {
  return (
    <ol className="flex items-center justify-center gap-2 py-4 sm:gap-4">
      {STEPS.map((s, i) => {
        const active = s.num === step;
        const done = s.num < step;
        return (
          <li key={s.num} className="flex items-center gap-2 sm:gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                done
                  ? "bg-ink text-cream"
                  : active
                  ? "bg-orange text-ink ring-2 ring-orange ring-offset-2 ring-offset-cream"
                  : "bg-ink/10 text-ink/40"
              }`}
            >
              {done ? "✓" : s.num}
            </div>
            <span
              className={`hidden text-sm sm:inline ${
                active ? "font-semibold text-ink" : "text-ink/60"
              }`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="mx-1 h-px w-6 bg-ink/20 sm:w-12" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
