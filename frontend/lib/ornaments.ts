/**
 * Vector ornament library for the sash designer (زخارف) — inspired by Arabic
 * calligraphy/decoration apps like محترف الخط.
 *
 * Each ornament is a self-contained SVG string that uses the color token
 * {@link ORNAMENT_COLOR_TOKEN} wherever the thread color should apply. At insert
 * time we substitute the chosen color and turn it into a `data:` URL, then add it
 * to the Fabric canvas as a normal FabricImage. Because it serializes as a
 * standard image with an inline `src`, it round-trips through every pipeline
 * (editor → preview → staff viewer → print export) with no special handling.
 *
 * Geometric ornaments (stars, medallions) are generated procedurally so they are
 * mathematically symmetric; flourishes/florals are hand-authored and made
 * symmetric by mirroring one half.
 */

export const ORNAMENT_COLOR_TOKEN = "__C__";

export interface Ornament {
  id: string;
  /** Arabic label (used as tooltip / aria-label) */
  label: string;
  /** Complete SVG markup with {@link ORNAMENT_COLOR_TOKEN} placeholders */
  svg: string;
}

export interface OrnamentCategory {
  id: string;
  label: string;
  items: Ornament[];
}

/** Build a `data:` URL for an ornament, substituting the chosen thread color. */
export function ornamentDataUrl(svg: string, color: string): string {
  const colored = svg.split(ORNAMENT_COLOR_TOKEN).join(color);
  return "data:image/svg+xml," + encodeURIComponent(colored);
}

/* ───────────────────────── geometry helpers ───────────────────────── */

const C = ORNAMENT_COLOR_TOKEN;
/** Round to 2dp to keep the SVG (and the data URL) compact. */
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Wrap inner markup in an SVG root. A high intrinsic size (3× the viewBox) keeps
 * the ornament crisp when the student enlarges it on the canvas.
 */
function svgRoot(vbW: number, vbH: number, inner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" ` +
    `width="${vbW * 3}" height="${vbH * 3}" fill="none" ` +
    `stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
  );
}

/** N-point star outline as an SVG path `d`, alternating outer/inner radius. */
function starD(
  points: number,
  rOuter: number,
  rInner: number,
  cx = 50,
  cy = 50,
  rot = -Math.PI / 2
): string {
  let d = "";
  const step = Math.PI / points;
  for (let i = 0; i < 2 * points; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rot + i * step;
    d += (i === 0 ? "M" : "L") + r2(cx + r * Math.cos(a)) + " " + r2(cy + r * Math.sin(a));
  }
  return d + "Z";
}

/** Regular polygon path `d`. */
function polyD(sides: number, r: number, cx = 50, cy = 50, rot = -Math.PI / 2): string {
  let d = "";
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    d += (i === 0 ? "M" : "L") + r2(cx + r * Math.cos(a)) + " " + r2(cy + r * Math.sin(a));
  }
  return d + "Z";
}

/** Petals arranged radially around a center — a rosette / شمسة. */
function rosetteD(petals: number, rTip: number, rWaist: number, cx = 50, cy = 50): string {
  let d = "";
  const step = (2 * Math.PI) / petals;
  for (let i = 0; i < petals; i++) {
    const a = -Math.PI / 2 + i * step;
    const tipX = cx + rTip * Math.cos(a);
    const tipY = cy + rTip * Math.sin(a);
    // control points splayed to the sides of the tip direction
    const cAng = step * 0.5;
    const c1x = cx + rWaist * Math.cos(a - cAng);
    const c1y = cy + rWaist * Math.sin(a - cAng);
    const c2x = cx + rWaist * Math.cos(a + cAng);
    const c2y = cy + rWaist * Math.sin(a + cAng);
    d +=
      `M${r2(cx)} ${r2(cy)}` +
      `Q${r2(c1x)} ${r2(c1y)} ${r2(tipX)} ${r2(tipY)}` +
      `Q${r2(c2x)} ${r2(c2y)} ${r2(cx)} ${r2(cy)}Z`;
  }
  return d;
}

const SOLID = `fill="${C}"`;
const LINE = (w = 3) => `fill="none" stroke="${C}" stroke-width="${w}"`;

/* ───────────────────────────── stars ───────────────────────────── */

const stars: Ornament[] = [
  {
    id: "star-8",
    label: "نجمة ثمانية",
    svg: svgRoot(100, 100, `<path d="${starD(8, 46, 19)}" ${SOLID}/>`),
  },
  {
    id: "star-8-line",
    label: "نجمة ثمانية مفرغة",
    svg: svgRoot(100, 100, `<path d="${starD(8, 45, 18)}" ${LINE(4)}/>`),
  },
  {
    id: "star-khatam",
    label: "نجمة الخاتم",
    svg: svgRoot(
      100,
      100,
      `<path d="${polyD(4, 42, 50, 50, -Math.PI / 2)}" ${LINE(4)}/>` +
        `<path d="${polyD(4, 42, 50, 50, -Math.PI / 2 + Math.PI / 4)}" ${LINE(4)}/>`
    ),
  },
  {
    id: "star-12",
    label: "نجمة اثنا عشرية",
    svg: svgRoot(100, 100, `<path d="${starD(12, 46, 26)}" ${SOLID}/>`),
  },
  {
    id: "star-16",
    label: "شمسة ستة عشر",
    svg: svgRoot(100, 100, `<path d="${starD(16, 46, 33)}" ${LINE(2.6)}/>`),
  },
  {
    id: "star-6",
    label: "نجمة سداسية",
    svg: svgRoot(100, 100, `<path d="${starD(6, 46, 18)}" ${SOLID}/>`),
  },
  {
    id: "star-5",
    label: "نجمة خماسية",
    svg: svgRoot(100, 100, `<path d="${starD(5, 46, 19)}" ${SOLID}/>`),
  },
  {
    id: "star-burst",
    label: "وهج",
    svg: svgRoot(100, 100, `<path d="${starD(24, 46, 30)}" ${SOLID}/>`),
  },
];

/* ─────────────────────── medallions / شمسيات ─────────────────────── */

function ringStar(): string {
  return (
    `<circle cx="50" cy="50" r="46" ${LINE(2.5)}/>` +
    `<circle cx="50" cy="50" r="40" ${LINE(1.4)}/>` +
    `<path d="${starD(8, 34, 14)}" ${LINE(2.5)}/>` +
    `<circle cx="50" cy="50" r="5" ${SOLID}/>`
  );
}

const medallions: Ornament[] = [
  { id: "med-ringstar", label: "ميدالية", svg: svgRoot(100, 100, ringStar()) },
  {
    id: "med-rosette8",
    label: "وردة ثمانية",
    svg: svgRoot(
      100,
      100,
      `<path d="${rosetteD(8, 46, 24)}" ${LINE(2.6)}/>` + `<circle cx="50" cy="50" r="6" ${SOLID}/>`
    ),
  },
  {
    id: "med-rosette12",
    label: "وردة اثنا عشرية",
    svg: svgRoot(100, 100, `<path d="${rosetteD(12, 46, 22)}" ${LINE(2.4)}/>`),
  },
  {
    id: "med-scallop",
    label: "شمسة مسننة",
    svg: svgRoot(
      100,
      100,
      `<path d="${starD(20, 46, 39)}" ${LINE(2.4)}/>` +
        `<circle cx="50" cy="50" r="26" ${LINE(2)}/>` +
        `<path d="${starD(8, 20, 8)}" ${SOLID}/>`
    ),
  },
  {
    id: "med-doublering",
    label: "إطار مزدوج",
    svg: svgRoot(
      100,
      100,
      `<circle cx="50" cy="50" r="46" ${LINE(3)}/>` +
        `<circle cx="50" cy="50" r="38" ${LINE(1.4)}/>` +
        `<path d="${rosetteD(12, 33, 14)}" ${SOLID}/>`
    ),
  },
  {
    id: "med-petal8",
    label: "زهرة الحياة",
    svg: svgRoot(
      100,
      100,
      Array.from({ length: 6 }, (_, i) => {
        const a = (i * Math.PI) / 3;
        const x = r2(50 + 18 * Math.cos(a));
        const y = r2(50 + 18 * Math.sin(a));
        return `<circle cx="${x}" cy="${y}" r="18" ${LINE(2)}/>`;
      }).join("") + `<circle cx="50" cy="50" r="18" ${LINE(2)}/>`
    ),
  },
];

/* ─────────────────────── dividers / فواصل ─────────────────────── */
// Wide viewBox (200×60), center at x=100, y=30. Built by drawing the right half
// then mirroring it to the left for guaranteed symmetry.

function divider(rightHalf: string, center: string): string {
  return svgRoot(
    200,
    60,
    `${center}` +
      `<g>${rightHalf}</g>` +
      `<g transform="translate(200,0) scale(-1,1)">${rightHalf}</g>`
  );
}

const dividers: Ornament[] = [
  {
    id: "div-vine",
    label: "فاصل مورق",
    svg: divider(
      `<path d="M104 30 C124 30 134 18 150 18 C168 18 168 36 156 36 C148 36 146 26 156 24" ${LINE(3)}/>` +
        `<path d="M150 18 C150 10 156 6 162 6" ${LINE(3)}/>`,
      `<path d="${starD(4, 14, 5, 100, 30)}" ${SOLID}/>`
    ),
  },
  {
    id: "div-curl",
    label: "فاصل ملتوٍ",
    svg: divider(
      `<path d="M108 30 H150 C168 30 172 14 160 14 C152 14 152 24 162 24" ${LINE(3)}/>`,
      `<circle cx="100" cy="30" r="6" ${SOLID}/>`
    ),
  },
  {
    id: "div-leaf",
    label: "فاصل بأوراق",
    svg: divider(
      `<path d="M106 30 H170" ${LINE(3)}/>` +
        `<path d="M130 30 C130 18 142 16 146 12 C140 22 142 30 130 30Z" ${SOLID}/>` +
        `<path d="M150 30 C150 18 162 16 166 12 C160 22 162 30 150 30Z" ${SOLID}/>`,
      `<path d="${starD(6, 11, 4, 100, 30)}" ${SOLID}/>`
    ),
  },
  {
    id: "div-dots",
    label: "فاصل منقّط",
    svg: divider(
      `<path d="M112 30 H176" ${LINE(2.5)}/>` +
        `<circle cx="124" cy="30" r="3.4" ${SOLID}/>` +
        `<circle cx="148" cy="30" r="3.4" ${SOLID}/>` +
        `<circle cx="172" cy="30" r="3.4" ${SOLID}/>`,
      `<path d="${starD(4, 12, 4.5, 100, 30)}" ${SOLID}/>`
    ),
  },
  {
    id: "div-wave",
    label: "فاصل متموّج",
    svg: divider(
      `<path d="M100 30 C116 14 132 46 148 30 C160 18 172 30 184 24" ${LINE(3)}/>`,
      ""
    ),
  },
  {
    id: "div-diamond",
    label: "فاصل ماسي",
    svg: divider(
      `<path d="M110 30 H184" ${LINE(2.5)}/>` + `<path d="${polyD(4, 7, 130, 30)}" ${LINE(2.5)}/>`,
      `<path d="${polyD(4, 13, 100, 30)}" ${LINE(3)}/>`
    ),
  },
  {
    id: "div-arc",
    label: "فاصل مقوّس",
    svg: divider(
      `<path d="M100 34 C128 6 160 6 188 30" ${LINE(3)}/>` +
        `<circle cx="188" cy="30" r="4" ${SOLID}/>`,
      `<circle cx="100" cy="20" r="4" ${SOLID}/>`
    ),
  },
];

/* ─────────────────────── corners / زوايا ─────────────────────── */
// 100×100, ornament hugs the top-right corner (rotate/flip on canvas for others).

const corners: Ornament[] = [
  {
    id: "corner-curl",
    label: "زاوية ملتوية",
    svg: svgRoot(
      100,
      100,
      `<path d="M8 8 H62 C82 8 92 18 92 38 V92" ${LINE(3)}/>` +
        `<path d="M62 8 C62 22 50 24 46 30 C56 24 62 30 62 18" ${LINE(2.5)}/>` +
        `<path d="M92 38 C78 38 76 50 70 54 C76 44 70 38 82 38" ${LINE(2.5)}/>`
    ),
  },
  {
    id: "corner-bracket",
    label: "زاوية هندسية",
    svg: svgRoot(
      100,
      100,
      `<path d="M10 10 H66 M10 10 V66" ${LINE(3.5)}/>` +
        `<path d="M20 20 H50 M20 20 V50" ${LINE(2)}/>` +
        `<path d="${polyD(4, 7, 12, 12)}" ${SOLID}/>`
    ),
  },
  {
    id: "corner-leaf",
    label: "زاوية مورقة",
    svg: svgRoot(
      100,
      100,
      `<path d="M10 10 C40 10 60 14 78 32 C92 46 90 76 90 90" ${LINE(3)}/>` +
        `<path d="M40 12 C40 28 28 30 22 36 C30 26 26 16 40 16Z" ${SOLID}/>` +
        `<path d="M86 60 C70 60 66 72 60 78 C70 66 62 60 80 60Z" ${SOLID}/>`
    ),
  },
  {
    id: "corner-fan",
    label: "زاوية مروحية",
    svg: svgRoot(
      100,
      100,
      Array.from({ length: 5 }, (_, i) => {
        const a = (i / 4) * (Math.PI / 2);
        const x = r2(12 + 70 * Math.cos(a));
        const y = r2(12 + 70 * Math.sin(a));
        return `<path d="M12 12 L${x} ${y}" ${LINE(2.5)}/>`;
      }).join("") + `<path d="M82 12 A70 70 0 0 1 12 82" ${LINE(2.5)}/>`
    ),
  },
  {
    id: "corner-bloom",
    label: "زاوية مزهرة",
    svg: svgRoot(
      100,
      100,
      `<path d="M10 10 H70 V70 H10Z" ${LINE(2)}/>` +
        `<path d="${rosetteD(6, 16, 7, 10, 10)}" ${SOLID}/>`
    ),
  },
];

/* ─────────────────────── frames / إطارات ─────────────────────── */

const frames: Ornament[] = [
  {
    id: "frame-cartouche",
    label: "خرطوش",
    svg: svgRoot(
      160,
      80,
      `<path d="M40 8 H120 C150 8 150 72 120 72 H40 C10 72 10 8 40 8Z" ${LINE(3)}/>` +
        `<path d="M46 16 H114 C136 16 136 64 114 64 H46 C24 64 24 16 46 16Z" ${LINE(1.4)}/>` +
        `<path d="${polyD(4, 6, 14, 40)}" ${SOLID}/>` +
        `<path d="${polyD(4, 6, 146, 40)}" ${SOLID}/>`
    ),
  },
  {
    id: "frame-arch",
    label: "إطار مقوّس",
    svg: svgRoot(
      100,
      120,
      `<path d="M14 116 V52 C14 22 36 8 50 8 C64 8 86 22 86 52 V116" ${LINE(3.5)}/>` +
        `<path d="M24 116 V52 C24 30 40 18 50 18 C60 18 76 30 76 52 V116" ${LINE(1.5)}/>`
    ),
  },
  {
    id: "frame-oval",
    label: "إطار بيضوي",
    svg: svgRoot(
      120,
      90,
      `<ellipse cx="60" cy="45" rx="54" ry="38" ${LINE(3)}/>` +
        `<ellipse cx="60" cy="45" rx="48" ry="32" ${LINE(1.4)}/>` +
        `<path d="${starD(8, 9, 3.6, 60, 6)}" ${SOLID}/>` +
        `<path d="${starD(8, 9, 3.6, 60, 84)}" ${SOLID}/>`
    ),
  },
  {
    id: "frame-scallop",
    label: "إطار مسنّن",
    svg: svgRoot(
      120,
      90,
      `<path d="${(() => {
        // scalloped rounded rectangle border via small arcs
        const pts: string[] = [];
        const w = 108,
          x0 = 6,
          y0 = 6,
          n = 9,
          rr = 6;
        for (let i = 0; i <= n; i++) {
          const x = x0 + (w * i) / n;
          pts.push(`${i === 0 ? "M" + x0 + " " + y0 : ""}A${rr} ${rr} 0 0 1 ${r2(x)} ${y0}`);
        }
        return pts.join("");
      })()}" ${LINE(2)}/>` +
        `<rect x="14" y="14" width="92" height="62" rx="6" ${LINE(1.5)}/>`
    ),
  },
];

/* ─────────────────────── florals / ورود ─────────────────────── */

const florals: Ornament[] = [
  {
    id: "flo-sprig",
    label: "غصن",
    svg: svgRoot(
      80,
      100,
      `<path d="M40 96 C40 70 40 40 40 12" ${LINE(3)}/>` +
        `<path d="M40 70 C24 66 18 54 18 44 C32 48 40 58 40 70Z" ${SOLID}/>` +
        `<path d="M40 58 C56 54 62 42 62 32 C48 36 40 46 40 58Z" ${SOLID}/>` +
        `<path d="${rosetteD(6, 14, 6, 40, 14)}" ${SOLID}/>`
    ),
  },
  {
    id: "flo-tulip",
    label: "زهرة التوليب",
    svg: svgRoot(
      80,
      100,
      `<path d="M40 96 V46" ${LINE(3)}/>` +
        `<path d="M40 46 C22 46 18 28 24 14 C30 26 38 22 40 36 C42 22 50 26 56 14 C62 28 58 46 40 46Z" ${SOLID}/>` +
        `<path d="M40 72 C28 70 24 62 26 54 C36 56 40 64 40 72Z" ${LINE(2)}/>`
    ),
  },
  {
    id: "flo-blossom",
    label: "زهرة",
    svg: svgRoot(
      100,
      100,
      `<path d="${rosetteD(5, 44, 16)}" ${LINE(3)}/>` + `<circle cx="50" cy="50" r="9" ${SOLID}/>`
    ),
  },
  {
    id: "flo-vine",
    label: "تعريشة",
    svg: svgRoot(
      160,
      70,
      `<path d="M8 50 C40 10 60 60 90 30 C116 6 140 40 152 22" ${LINE(3)}/>` +
        `<path d="M52 36 C52 24 64 22 68 18 C62 28 64 36 52 36Z" ${SOLID}/>` +
        `<path d="M108 38 C108 26 120 24 124 20 C118 30 120 38 108 38Z" ${SOLID}/>` +
        `<circle cx="152" cy="22" r="5" ${SOLID}/>`
    ),
  },
  {
    id: "flo-bouquet",
    label: "باقة",
    svg: svgRoot(
      100,
      100,
      `<path d="M50 96 C50 74 50 60 50 50 M50 70 C36 64 32 54 34 46 C46 50 50 60 50 70 M50 64 C64 58 68 48 66 40 C54 44 50 54 50 64" ${LINE(3)}/>` +
        `<path d="${rosetteD(6, 12, 5, 34, 30)}" ${SOLID}/>` +
        `<path d="${rosetteD(6, 12, 5, 66, 30)}" ${SOLID}/>` +
        `<path d="${rosetteD(6, 14, 6, 50, 18)}" ${SOLID}/>`
    ),
  },
  {
    id: "flo-leafpair",
    label: "ورقتان",
    svg: svgRoot(
      120,
      60,
      `<path d="M60 30 H8" ${LINE(2.5)}/>` +
        `<path d="M60 30 H112" ${LINE(2.5)}/>` +
        `<path d="M40 30 C40 16 52 14 58 8 C50 22 52 30 40 30Z" ${SOLID}/>` +
        `<path d="M80 30 C80 44 68 46 62 52 C70 38 68 30 80 30Z" ${SOLID}/>` +
        `<circle cx="60" cy="30" r="5" ${SOLID}/>`
    ),
  },
];

/* ─────────────────────── symbols / رموز ─────────────────────── */

const symbols: Ornament[] = [
  {
    id: "sym-crescent-star",
    label: "هلال ونجمة",
    svg: svgRoot(
      100,
      100,
      `<path d="M64 14 A38 38 0 1 0 64 86 A30 30 0 1 1 64 14Z" ${SOLID}/>` +
        `<path d="${starD(5, 15, 6, 76, 50)}" ${SOLID}/>`
    ),
  },
  {
    id: "sym-crescent",
    label: "هلال",
    svg: svgRoot(
      100,
      100,
      `<path d="M62 10 A42 42 0 1 0 62 90 A33 33 0 1 1 62 10Z" ${SOLID}/>`
    ),
  },
  {
    id: "sym-lantern",
    label: "فانوس",
    svg: svgRoot(
      70,
      110,
      `<path d="M35 6 V14" ${LINE(3)}/>` +
        `<path d="M20 14 H50 L46 22 H24Z" ${LINE(2.5)}/>` +
        `<path d="M22 24 H48 C54 40 54 72 48 92 H22 C16 72 16 40 22 24Z" ${LINE(3)}/>` +
        `<path d="M22 56 H48" ${LINE(1.6)}/>` +
        `<path d="M28 96 H42 L40 104 H30Z" ${LINE(2.5)}/>` +
        `<path d="${starD(4, 8, 3, 35, 56)}" ${SOLID}/>`
    ),
  },
  {
    id: "sym-ayah",
    label: "علامة آية",
    svg: svgRoot(
      100,
      100,
      `<circle cx="50" cy="50" r="40" ${LINE(3)}/>` +
        `<path d="${starD(12, 40, 30)}" ${LINE(1.6)}/>` +
        `<circle cx="50" cy="50" r="8" ${SOLID}/>`
    ),
  },
  {
    id: "sym-diamond-chain",
    label: "سلسلة ماسية",
    svg: svgRoot(
      180,
      40,
      [30, 70, 110, 150]
        .map((x) => `<path d="${polyD(4, 13, x, 20)}" ${LINE(2.5)}/>`)
        .join("") + `<path d="M8 20 H172" ${LINE(1.4)}/>`
    ),
  },
  {
    id: "sym-heart-leaf",
    label: "قلب مورق",
    svg: svgRoot(
      100,
      100,
      `<path d="M50 86 C20 60 14 38 28 26 C40 16 50 28 50 36 C50 28 60 16 72 26 C86 38 80 60 50 86Z" ${LINE(3)}/>` +
        `<path d="M50 70 V40" ${LINE(1.6)}/>`
    ),
  },
];

/* ───────────────────────────── export ───────────────────────────── */

export const ORNAMENT_CATEGORIES: OrnamentCategory[] = [
  { id: "stars", label: "نجوم", items: stars },
  { id: "medallions", label: "شمسيات", items: medallions },
  { id: "dividers", label: "فواصل", items: dividers },
  { id: "corners", label: "زوايا", items: corners },
  { id: "frames", label: "إطارات", items: frames },
  { id: "florals", label: "ورود", items: florals },
  { id: "symbols", label: "رموز", items: symbols },
];
