import Image from "next/image";
import Link from "next/link";

interface BrandMarkProps {
  /** rendered box size in px */
  size?: number;
  className?: string;
  priority?: boolean;
}

/**
 * Official @loloshop96 logo mark — the real PNG asset (public/logo.png),
 * a coral disc with the "lolo shop 96" script. Rendered with object-contain
 * so its built-in padding is preserved at any size.
 */
export function BrandMark({ size = 44, className = "", priority }: BrandMarkProps) {
  return (
    <Image
      src="/logo.png"
      alt="لولو شوب"
      width={size}
      height={size}
      priority={priority}
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
  priority?: boolean;
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
  priority,
}: BrandLogoProps) {
  const content = (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} priority={priority} />
      {withWordmark && (
        <span className="font-display text-sm font-semibold tracking-wide text-ink/75">
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
