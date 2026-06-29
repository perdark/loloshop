import Link from "next/link";

type LegalSection = {
  title: string;
  body: string[];
};

type LegalLink = {
  href: string;
  label: string;
};

type LegalPageProps = {
  eyebrow: string;
  title: string;
  updatedAt: string;
  intro: string;
  sections: LegalSection[];
  links?: LegalLink[];
};

export function LegalPage({
  eyebrow,
  title,
  updatedAt,
  intro,
  sections,
  links = [],
}: LegalPageProps) {
  return (
    <main className="min-h-screen bg-cream px-4 py-8 text-ink" dir="rtl" lang="ar">
      <article className="mx-auto max-w-3xl rounded-[2rem] border border-line bg-beige p-6 shadow-card sm:p-8">
        <Link
          href="/"
          className="inline-flex rounded-pill border border-line bg-cream px-4 py-2 text-sm font-semibold text-orange-ink transition hover:border-orange-ink"
        >
          العودة إلى المتجر
        </Link>

        <header className="mt-8 space-y-3">
          <p className="text-sm font-bold text-orange-ink">{eyebrow}</p>
          <h1 className="font-display-ar text-3xl font-bold leading-tight sm:text-4xl">
            {title}
          </h1>
          <p className="text-sm text-muted">آخر تحديث: {updatedAt}</p>
          <p className="max-w-2xl text-base leading-8 text-ink-soft">{intro}</p>
        </header>

        <div className="mt-8 space-y-6">
          {sections.map((section) => (
            <section key={section.title} className="rounded-card border border-line bg-cream/70 p-5">
              <h2 className="font-display-ar text-xl font-bold text-ink">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-ink-soft sm:text-base">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {links.length > 0 ? (
          <nav
            aria-label="روابط مرتبطة"
            className="mt-8 flex flex-wrap gap-3 border-t border-line pt-6"
          >
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-pill border border-line bg-cream px-4 py-2 text-sm font-bold text-orange-ink transition hover:border-orange-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </article>
    </main>
  );
}
