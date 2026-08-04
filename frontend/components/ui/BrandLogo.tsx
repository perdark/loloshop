import Image from "next/image";
import Link from "next/link";

interface BrandMarkProps {
  /** rendered box size in px */
  size?: number;
  className?: string;
  /**
   * Load immediately instead of lazily. Use for the mark in a sidebar/nav header,
   * which is always above the fold.
   *
   * ⚠️ RENAMED FROM `priority` ON PURPOSE, 2026-08-04. `next/image`'s `priority`
   * prop was DEPRECATED IN NEXT 16 and does nothing at all — every call site that
   * passed it has been silently lazy-loading an above-the-fold logo. The rename is
   * the point: it forces each caller to be re-read rather than letting a dead prop
   * keep looking correct. Maps to loading="eager" + fetchPriority="high".
   */
  eager?: boolean;
}

/**
 * Official @lolo_shop96 logo mark — the real PNG asset (public/logo.png),
 * a coral disc with the "lolo shop 96" script. Rendered with object-contain
 * so its built-in padding is preserved at any size.
 */
export function BrandMark({ size = 44, className = "", eager }: BrandMarkProps) {
  return (
    <Image
      src="/logo.png"
      alt="لولو شوب"
      width={size}
      height={size}
      loading={eager ? "eager" : undefined}
      fetchPriority={eager ? "high" : undefined}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

interface BrandLogoProps {
  /** mark box size in px */
  size?: number;
  /** show the Arabic tagline next to the mark */
  withWordmark?: boolean;
  /** wrap in a link to home */
  href?: string;
  className?: string;
  /** See BrandMarkProps.eager — renamed from `priority`, which is dead in Next 16. */
  eager?: boolean;
}

/**
 * Horizontal lockup: official logo mark + Arabic tagline.
 * The PNG already carries the "lolo shop" script wordmark, so only the
 * Arabic sub-line is rendered alongside it (no duplicate Latin wordmark).
 */
export function BrandLogo({
  size = 48,
  withWordmark = true,
  href,
  className = "",
  eager,
}: BrandLogoProps) {
  const content = (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} eager={eager} />
      {withWordmark && (
        <span className="font-display text-sm font-semibold tracking-wide text-ink-soft">
          لولو شوب — أزياء التخرج
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <Link href={href} aria-label="لولو شوب — الصفحة الرئيسية" className="inline-flex">
        {content}
      </Link>
    );
  }
  return content;
}
