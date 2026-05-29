"use client";

/**
 * Root-layout error fallback.
 * Must be a Client Component and must render its own <html>+<body>
 * (root layout is unavailable when this fires).
 *
 * Kept dependency-light: no next/image, no custom font imports.
 * Inline styles bridge the gap since globals.css may not be available.
 * Uses <title> (React 19 hoisting) instead of metadata export (not allowed here).
 */

interface GlobalErrorProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

export default function GlobalError({ error, unstable_retry }: GlobalErrorProps) {
  return (
    <html lang="ar" dir="rtl">
      {/* React 19: title hoisted into <head> automatically */}
      <title>خطأ — لولو شوب</title>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          textAlign: "center",
          backgroundColor: "#faf4ea",
          color: "#1a1a1a",
          fontFamily: "system-ui, sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {/* Minimal brand mark — inline SVG, no asset dependency */}
        <div
          aria-label="لولو شوب"
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #c2410c, #f47b42)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "2rem",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              color: "#fff",
              fontSize: "1.25rem",
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            L
          </span>
        </div>

        <h1
          style={{
            margin: "0 0 1rem",
            fontSize: "clamp(1.375rem, 4vw, 2rem)",
            fontWeight: 700,
            lineHeight: 1.2,
            color: "#1a1a1a",
          }}
        >
          خطأ في التطبيق
        </h1>

        <p
          style={{
            margin: "0 0 2rem",
            fontSize: "1rem",
            lineHeight: 1.7,
            color: "#33302b",
            maxWidth: "44ch",
          }}
        >
          حدث خلل غير متوقع في التطبيق. نعتذر عن الإزعاج.
          يمكنك المحاولة مجدداً.
        </p>

        {error.digest && (
          <p
            style={{
              margin: "0 0 1.5rem",
              fontSize: "0.75rem",
              color: "#6b6356",
              letterSpacing: "0.02em",
            }}
          >
            رقم المرجع: {error.digest}
          </p>
        )}

        <button
          onClick={() => unstable_retry()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 44,
            minWidth: 44,
            borderRadius: 9999,
            background: "#c2410c",
            color: "#fff",
            border: "none",
            padding: "0.875rem 2rem",
            fontSize: "1rem",
            fontWeight: 600,
            cursor: "pointer",
            transition: "background 180ms ease-out",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#1a1a1a";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#c2410c";
          }}
        >
          إعادة المحاولة
        </button>
      </body>
    </html>
  );
}
