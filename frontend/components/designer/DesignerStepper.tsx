interface DesignerStepperProps {
  step: 1 | 2 | 3;
}

const STEPS = [
  { num: 1, label: "الخيارات والسعر", shortLabel: "الخيارات" },
  { num: 2, label: "صمّم الوشاح", shortLabel: "التصميم" },
  { num: 3, label: "معاينة وتأكيد", shortLabel: "التأكيد" },
] as const;

export function DesignerStepper({ step }: DesignerStepperProps) {
  return (
    <ol className="flex items-center justify-center gap-1 py-4 sm:gap-4" aria-label="خطوات التصميم">
      {STEPS.map((s, i) => {
        const active = s.num === step;
        const done = s.num < step;
        return (
          <li
            key={s.num}
            className="flex flex-col items-center gap-1 sm:flex-row sm:gap-3"
            aria-current={active ? "step" : undefined}
          >
            <div className="flex items-center gap-2">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-all duration-300 ${
                  done
                    ? "bg-ink text-cream scale-100"
                    : active
                    ? "bg-orange-ink text-cream ring-2 ring-orange-ink ring-offset-2 ring-offset-cream scale-105"
                    : "bg-surface-sink text-muted scale-100"
                }`}
              >
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                ) : s.num}
              </div>
              {i < STEPS.length - 1 && (
                <span
                  className={`hidden h-px w-4 transition-colors duration-500 sm:inline sm:w-8 ${done ? "bg-orange-ink" : "bg-line"}`}
                  aria-hidden
                />
              )}
            </div>
            <span
              className={`text-center text-xs leading-tight sm:text-sm ${
                active ? "font-semibold text-ink" : done ? "text-ink-soft" : "text-muted"
              }`}
            >
              <span className="sm:hidden">{s.shortLabel}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
