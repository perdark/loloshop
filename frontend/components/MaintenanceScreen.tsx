"use client";

/**
 * Full-page maintenance notice shown on "/" when admin enables maintenance mode.
 * RTL Arabic-first, mobile-first, on the warm brand canvas.
 */
export function MaintenanceScreen({ message }: { message: string }) {
  return (
    <div
      dir="rtl"
      lang="ar"
      className="flex min-h-[80svh] flex-col items-center justify-center gap-7 px-6 py-16 text-center"
    >
      {/* Brand wordmark */}
      <p className="font-script text-5xl leading-none text-orange-ink">lolo shop</p>

      {/* Maintenance glyph */}
      <span
        aria-hidden
        className="flex h-20 w-20 items-center justify-center rounded-full bg-orange/10 text-orange-ink"
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </span>

      <h1 className="text-balance font-display-ar text-[clamp(1.6rem,6vw,2.5rem)] font-bold leading-tight text-ink">
        {message}
      </h1>

      <p className="max-w-[36ch] text-sm leading-relaxed text-ink-soft">
        نعمل على تحسين الموقع — سنعود قريباً. تابعونا على إنستغرام{" "}
        <a
          href="https://instagram.com/lolo_shop96"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-orange-ink underline underline-offset-2"
        >
          @lolo_shop96
        </a>
      </p>
    </div>
  );
}
