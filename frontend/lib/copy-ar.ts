import type { Gender } from "./profile";

/**
 * Every second-person string in the storefront, in both genders.
 *
 * Arabic conjugates the second person, so «جاهز ليوم تخرّجك» addresses a woman
 * in the masculine — on a storefront whose buyers are majority women. Keeping
 * all of them in ONE dictionary (rather than inline in markup) is what makes it
 * possible to guarantee that; a hardcoded gendered string in a component is a
 * bug waiting for the next screen.
 *
 * Register is the Iraqi one the house already uses on Instagram (چ for the
 * feminine second person: «وشاحچ», «تخرّجچ») — not MSA, which would read as a
 * bank letter to a graduating student.
 *
 * `neutral` is not a third gender: it is what an anonymous visitor sees BEFORE
 * onboarding answers the question, and it is written to be true either way.
 * Never fall back to the masculine for an unknown visitor.
 */

export interface StorefrontCopy {
  greetSub: string;
  promise: string;
  searchPlaceholder: string;
  why1: { lead: string; rest: string };
  why3: { lead: string; rest: string };
  why4: { lead: string; rest: string };
  vipTitle: string;
  vipLede: string;
  vipCta: string;
  visitTitle: string;
  visitBody: string;
}

/* NOTE ON CLAIMS: the mockup's promise line read
   «... · جاهز خلال 5 أيام · ...». That prep time appears NOWHERE in this repo
   or the database, so it is not printed here. Put it back — in this one place —
   once the real turnaround is confirmed. */

const FEMALE: StorefrontCopy = {
  greetSub: "جاهزة ليوم تخرّجچ؟ خلّينا نجهّز إطلالتچ.",
  promise: "اسمچ وكليتچ مطرّزين بالخيط · مخيوط بورشتنا · الدفع نقداً عند التسليم",
  searchPlaceholder: "دوّري على وشاح، روب، قبعة…",
  why1: {
    lead: "اسمچ مطرّز بالخيط",
    rest: "بالخط العربي، مو طباعة تنمسح بعد غسلة.",
  },
  why3: {
    lead: "محل حقيقي ببغداد",
    rest: "تكدرين تجين تشوفين القماش بعينچ قبل ما تطلبين.",
  },
  why4: {
    lead: "الدفع نقداً عند التسليم",
    rest: "ما تدفعين ولا دينار هسه.",
  },
  vipTitle: "إطلالتچ كاملة، بباقة وحدة",
  vipLede: "روب ووشاح وقبعة — باسمچ وكليتچ، بتطريز كامل وتجهيز بأولوية قبل الحفل.",
  vipCta: "شوفي باقة VIP",
  visitTitle: "تعالي شوفينا",
  visitBody: "محل لولو شوب ببغداد — تعالي شوفي القماش والألوان بعينچ قبل ما تطلبين.",
};

const MALE: StorefrontCopy = {
  greetSub: "جاهز ليوم تخرّجك؟ خلّينا نجهّز إطلالتك.",
  promise: "اسمك وكليتك مطرّزين بالخيط · مخيوط بورشتنا · الدفع نقداً عند التسليم",
  searchPlaceholder: "دوّر على وشاح، روب، قبعة…",
  why1: {
    lead: "اسمك مطرّز بالخيط",
    rest: "بالخط العربي، مو طباعة تنمسح بعد غسلة.",
  },
  why3: {
    lead: "محل حقيقي ببغداد",
    rest: "تكدر تجي تشوف القماش بعينك قبل ما تطلب.",
  },
  why4: {
    lead: "الدفع نقداً عند التسليم",
    rest: "ما تدفع ولا دينار هسه.",
  },
  vipTitle: "إطلالتك كاملة، بباقة وحدة",
  vipLede: "روب ووشاح وقبعة — باسمك وكليتك، بتطريز كامل وتجهيز بأولوية قبل الحفل.",
  vipCta: "شوف باقة VIP",
  visitTitle: "تعال شوفنا",
  visitBody: "محل لولو شوب ببغداد — تعال شوف القماش والألوان بعينك قبل ما تطلب.",
};

/** Gender-free wording for a visitor who hasn't told us yet. */
const NEUTRAL: StorefrontCopy = {
  greetSub: "خلّينا نجهّز إطلالة التخرّج.",
  promise: "الاسم والكلية مطرّزين بالخيط · مخيوط بورشتنا · الدفع نقداً عند التسليم",
  searchPlaceholder: "دوّر على وشاح، روب، قبعة…",
  why1: {
    lead: "الاسم مطرّز بالخيط",
    rest: "بالخط العربي، مو طباعة تنمسح بعد غسلة.",
  },
  why3: {
    lead: "محل حقيقي ببغداد",
    rest: "تعال شوف القماش بعينك قبل الطلب.",
  },
  why4: {
    lead: "الدفع نقداً عند التسليم",
    rest: "ما تدفع ولا دينار هسه.",
  },
  vipTitle: "إطلالة كاملة، بباقة وحدة",
  vipLede: "روب ووشاح وقبعة — بالاسم والكلية، بتطريز كامل وتجهيز بأولوية قبل الحفل.",
  vipCta: "شوف باقة VIP",
  visitTitle: "تعال شوفنا",
  visitBody: "محل لولو شوب ببغداد — شوف القماش والألوان بعينك قبل الطلب.",
};

/** The one line every component calls. Never index the dictionaries directly. */
export function copyFor(gender: Gender | null): StorefrontCopy {
  if (gender === "female") return FEMALE;
  if (gender === "male") return MALE;
  return NEUTRAL;
}

/** «نخيطه بورشتنا» is identical in both genders (third person) — one copy. */
export const WHY_WORKSHOP = {
  lead: "نخيطه بورشتنا",
  rest: "إحنا اللي نفصّل ونطرّز، مو وسيط يشتري ويبيع.",
};

/**
 * Arabic counted nouns: 3–10 take the plural (٥ موديلات), 11+ revert to the
 * singular (١١ موديل). Writing "5 موديل" is an error a native reader sees
 * instantly — this is why the count is never interpolated raw.
 */
export function modelsCount(n: number): string {
  if (n === 1) return "موديل واحد";
  if (n === 2) return "موديلان";
  if (n <= 10) return `${n} موديلات`;
  return `${n} موديل`;
}
