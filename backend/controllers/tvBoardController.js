// ───────────────────────────────────────────────────────────────────────────
// Admin TV command board ("لوحة المتابعة") — read-only, key-gated data layer.
//
// Served at /api/tv/* behind a secret env key (TV_BOARD_KEY). NO login, NO JWT:
// the key in the URL is the only credential (same fail-closed pattern as the
// staff portal). Wrong/missing key → 404 so the board's existence stays hidden.
//
// Everything here is AGGREGATE + READ-ONLY (no order/business mutations). The one
// write is the board's own config (daily goal / bottleneck threshold / sound),
// persisted to the existing site_settings table under key 'tv_board'.
//
// The whole board reads ONE cached snapshot endpoint (≈2s in-memory cache) so the
// 3s polling fallback + SSE-triggered refetches never hammer Neon. Live push uses
// the shared eventBus (same stream the production console already emits to).
// ───────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const { query } = require('../lib/db');
const { addClient } = require('../lib/eventBus');
const { secretMatches } = require('../lib/secretCompare');

const TZ = 'Asia/Baghdad';
const MANAGER_STAGES = ['design_complete', 'converting', 'embroidery', 'pressing', 'preparing', 'ready'];
const PRESENCE_TTL_SECONDS = 90;
const TOTAL_PROVINCES = 18; // Iraq governorates — the conquest denominator
const OWNER_TITLE_DEFAULT = 'صاحب لولو شوب';

// Owner rank ladder (ego). Climbs on lifetime RETAIL طلب — direct student orders
// (bundles, not pieces), which is the growth the owner is actually chasing. The
// final rung is the stated goal of 3000 retail orders (owner, 2026-07-21).
//
// It used to be fed COUNT(*) pieces, which inflated the rank ~3× and made
// «المتبقّي لرتبة X» a number that was neither orders nor achievable as stated.
const RANKS = [
  { key: 'start', label: 'البداية', min: 0 },
  { key: 'merchant', label: 'تاجر', min: 50 },
  { key: 'trusted', label: 'تاجر موثوق', min: 100 },
  { key: 'lord', label: 'سيّد الأوشحة', min: 250 },
  { key: 'master', label: 'أستاذ التخرّج', min: 500 },
  { key: 'noble', label: 'وجيه الجامعات', min: 750 },
  { key: 'king', label: 'مَلِك التخرّج', min: 1000 },
  { key: 'emperor', label: 'إمبراطور الأوشحة', min: 1500 },
  { key: 'titan', label: 'عملاق الموسم', min: 2000 },
  { key: 'myth', label: 'أيقونة العراق', min: 2500 },
  { key: 'legend', label: 'أسطورة', min: 3000 },
];
function rankFor(total) {
  let cur = RANKS[0];
  let next = null;
  for (let i = 0; i < RANKS.length; i++) {
    if (total >= RANKS[i].min) { cur = RANKS[i]; next = RANKS[i + 1] || null; }
  }
  const floor = cur.min;
  const ceil = next ? next.min : cur.min;
  const progress = next ? Math.min(100, Math.max(0, Math.round(((total - floor) / (ceil - floor)) * 100))) : 100;
  return {
    key: cur.key,
    label: cur.label,
    next_label: next ? next.label : null,
    next_at: next ? next.min : null,
    to_next: next ? Math.max(0, next.min - total) : 0,
    progress,
    total,
  };
}

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
function ymBefore(s) { // 'YYYY-MM-DD' → previous day, all in UTC string-space
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------- key gate ----------
function tvKeyOk(provided) {
  return secretMatches(provided, process.env.TV_BOARD_KEY); // fail closed
}
function keyGate(req, res, next) {
  if (!tvKeyOk(req.query.key)) {
    return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  }
  next();
}

// ---------- money gate ----------
// Money (revenue/profit/any IQD amount) is HIDDEN by default on the board and via
// admin endpoints. It's revealed ONLY by a secret passphrase. Single source of truth
// for the site_settings row + the compare logic lives here (admin controller requires it).
const MONEY_GATE_KEY = 'money_gate';

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// The configured secret hash (sha256 hex), or null when nothing is configured.
// Source of truth: site_settings 'money_gate' → value.secret_hash. Fallback: env
// MONEY_GATE_SECRET (hashed on the fly) — only when the DB row is unset. Fail-safe: null.
async function moneyGateHash() {
  const row = (await query(`SELECT value FROM site_settings WHERE key = '${MONEY_GATE_KEY}'`)).rows[0];
  const stored = row && row.value && typeof row.value.secret_hash === 'string' ? row.value.secret_hash.trim() : '';
  if (stored) return stored;
  const envSecret = process.env.MONEY_GATE_SECRET;
  if (envSecret && String(envSecret).length) return sha256Hex(envSecret);
  return null;
}

// True when `provided` matches the configured passphrase. Fail-safe: false when the
// argument isn't a non-empty string OR no secret is configured anywhere.
async function moneyRevealOk(provided) {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const hash = await moneyGateHash();
  if (!hash) return false;
  let a, b;
  try {
    a = Buffer.from(sha256Hex(provided), 'hex');
    b = Buffer.from(hash, 'hex');
  } catch { return false; }
  if (a.length === 0 || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

// Is any money-gate secret configured (DB row or env fallback)?
async function moneyGateConfigured() {
  return (await moneyGateHash()) !== null;
}

// Hash + UPSERT the passphrase into site_settings. Caller validates length.
async function setMoneyGate(secret) {
  await query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ('${MONEY_GATE_KEY}', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ secret_hash: sha256Hex(secret) })]
  );
}

// Every monetary field on the snapshot (documented for the frontend agents — do NOT
// render any of these when money_visible === false; they arrive as null).
const MONEY_FIELDS = [
  'kpis.revenue_today', 'kpis.revenue_delta', 'kpis.profit_today',
  'graphs.series[].revenue', 'graphs.series[].profit',
  'lifetime.revenue_total', 'lifetime.profit_total',
  'lifetime.revenue_month', 'lifetime.profit_month', 'records.best_day_revenue',
  'growth.this_year_rev', 'growth.last_year_rev',
];

// Return a shallow-cloned snapshot with every monetary field nulled. NEVER mutates
// `data` (the shared 2s cache holds the full, unstripped object).
function stripMoney(data) {
  const out = { ...data, money_visible: false };
  if (data.kpis) out.kpis = { ...data.kpis, revenue_today: null, revenue_delta: null, profit_today: null };
  if (data.lifetime) {
    out.lifetime = {
      ...data.lifetime,
      revenue_total: null, profit_total: null, revenue_month: null, profit_month: null,
    };
  }
  if (data.records) out.records = { ...data.records, best_day_revenue: null };
  if (data.growth) out.growth = { ...data.growth, this_year_rev: null, last_year_rev: null };
  if (data.graphs) {
    out.graphs = {
      ...data.graphs,
      series: Array.isArray(data.graphs.series)
        ? data.graphs.series.map((p) => ({ ...p, revenue: null, profit: null }))
        : data.graphs.series,
    };
  }
  return out;
}

// تجزئة = retail (no wholesaler), جملة = wholesaler. Returns a SQL fragment on `s` (students).
function srcClause(source) {
  if (source === 'retail') return 'AND s.wholesaler_id IS NULL';
  if (source === 'wholesaler') return 'AND s.wholesaler_id IS NOT NULL';
  return '';
}
function normSource(q) {
  return q === 'retail' || q === 'wholesaler' ? q : null;
}

// Iraq governorates (canonical) — text → key normaliser for the conquest map.
const GOV_MATCH = [
  ['baghdad', /بغداد/], ['basra', /بصرة|البصره/], ['nineveh', /نينوى|موصل|الموصل/],
  ['erbil', /اربيل|أربيل|اربل/], ['sulaymaniyah', /سليمانية|السليمانيه/], ['dohuk', /دهوك|دهوگ/],
  ['kirkuk', /كركوك/], ['diyala', /ديالى|ديالي|بعقوبة|بعقوبه/], ['anbar', /الانبار|الأنبار|انبار|رمادي|الرمادي/],
  ['babil', /بابل|الحلة|الحله/], ['karbala', /كربلاء|كربلا/], ['najaf', /النجف|نجف/],
  ['qadisiyah', /القادسية|القادسيه|الديوانية|الديوانيه|ديوانية/], ['muthanna', /المثنى|المثنه|السماوة|السماوه/],
  ['dhiqar', /ذي قار|ذيقار|الناصرية|الناصريه|ناصرية/], ['maysan', /ميسان|العمارة|العماره/],
  ['wasit', /واسط|الكوت|كوت/], ['salahuddin', /صلاح الدين|تكريت|سامراء|سامرا/],
];
function govKey(text) {
  if (!text) return null;
  const t = String(text);
  for (const [key, re] of GOV_MATCH) if (re.test(t)) return key;
  return null;
}

// ---------- legend aggregates (lifetime / records / growth / rank) ----------
// These barely move minute-to-minute and are heavier (full-history scans), so
// they get their OWN 60s cache — independent of the 2s live snapshot — to keep
// Neon load low on an always-on board.
const _legendCache = new Map(); // source → { at, data }
const LEGEND_MS = 60000;
const SETTLED_MONEY_SQL = `(s.wholesaler_id IS NULL OR o.wholesaler_approval = 'approved')`;

async function buildLegend(source) {
  const ck = source || 'all';
  const hit = _legendCache.get(ck);
  if (hit && Date.now() - hit.at < LEGEND_MS) return hit.data;
  const src = srcClause(source);

  const [lifeR, uniR, recDayR, recMonR, datesR, nowR, growR, growSeriesR] = await Promise.all([
    // Lifetime totals.
    query(
      // UNITS (2026-07-21): total_orders is BUNDLES (طلب) — it used to be COUNT(*)
      // pieces under an «طلب» label, which read ~3× the real order count and
      // contradicted /admin. total_pieces is exposed separately as قطعة.
      // retail_orders (bundles from students with no rep) feeds the rank ladder.
      // delivered_total was dropped: 0 rows have ever been delivered, so the panel
      // it fed was a permanent zero (see spec §1.2).
      `SELECT
         COUNT(DISTINCT o.student_id) FILTER (WHERE o.status::text<>'cancelled')::int AS graduates,
         COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id)) FILTER (WHERE o.status::text<>'cancelled')::int AS total_orders,
         COUNT(*) FILTER (WHERE o.status::text<>'cancelled')::int AS total_pieces,
         COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))
           FILTER (WHERE o.status::text<>'cancelled' AND s.wholesaler_id IS NULL)::int AS retail_orders,
         COALESCE(SUM(o.price) FILTER (WHERE o.status::text<>'cancelled' AND ${SETTLED_MONEY_SQL}),0)::bigint AS revenue_total,
         COALESCE(SUM(o.profit) FILTER (WHERE o.status::text<>'cancelled' AND ${SETTLED_MONEY_SQL}),0)::bigint AS profit_total,
         COALESCE(SUM(o.price) FILTER (WHERE o.status::text<>'cancelled' AND ${SETTLED_MONEY_SQL}
           AND date_trunc('month', o.created_at AT TIME ZONE '${TZ}')
             = date_trunc('month', NOW() AT TIME ZONE '${TZ}')),0)::bigint AS revenue_month,
         COALESCE(SUM(o.profit) FILTER (WHERE o.status::text<>'cancelled' AND ${SETTLED_MONEY_SQL}
           AND date_trunc('month', o.created_at AT TIME ZONE '${TZ}')
             = date_trunc('month', NOW() AT TIME ZONE '${TZ}')),0)::bigint AS profit_month
       FROM orders o JOIN students s ON s.id=o.student_id WHERE TRUE ${src}`
    ),
    // Universities served — list (trophy wall) + implicit count.
    query(
      `SELECT s.university_name AS name, COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS c
       FROM orders o JOIN students s ON s.id=o.student_id
       WHERE o.status::text<>'cancelled' AND s.university_name IS NOT NULL AND s.university_name<>'' ${src}
       GROUP BY s.university_name ORDER BY c DESC LIMIT 40`
    ),
    // Best historical DAY (strictly before today) by order count → record to beat.
    query(
      `SELECT d::text AS d, cnt, rev FROM (
         SELECT (o.created_at AT TIME ZONE '${TZ}')::date AS d, COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS cnt,
                COALESCE(SUM(o.price) FILTER (WHERE ${SETTLED_MONEY_SQL}),0)::bigint AS rev
         FROM orders o JOIN students s ON s.id=o.student_id
         WHERE o.status::text<>'cancelled'
           AND (o.created_at AT TIME ZONE '${TZ}')::date < (NOW() AT TIME ZONE '${TZ}')::date ${src}
         GROUP BY d
       ) x ORDER BY cnt DESC, rev DESC LIMIT 1`
    ),
    // Best MONTH by order count.
    query(
      `SELECT to_char(m,'YYYY-MM') AS ym, cnt FROM (
         SELECT date_trunc('month', o.created_at AT TIME ZONE '${TZ}') AS m, COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS cnt
         FROM orders o JOIN students s ON s.id=o.student_id
         WHERE o.status::text<>'cancelled' ${src}
         GROUP BY m
       ) x ORDER BY cnt DESC LIMIT 1`
    ),
    // Distinct order dates (for the streak), newest first.
    query(
      `SELECT DISTINCT (o.created_at AT TIME ZONE '${TZ}')::date::text AS d
       FROM orders o JOIN students s ON s.id=o.student_id
       WHERE o.status::text<>'cancelled' ${src}
       ORDER BY d DESC LIMIT 240`
    ),
    // Today (Baghdad) as text — anchors the streak + current year.
    query(`SELECT (NOW() AT TIME ZONE '${TZ}')::date::text AS today`),
    // Year-over-year TO DATE (same day-of-year cutoff in both years).
    query(
      `WITH t AS (SELECT (NOW() AT TIME ZONE '${TZ}') AS now_local)
       SELECT
         COUNT(DISTINCT z.bkey) FILTER (WHERE z.yr = EXTRACT(YEAR FROM t.now_local))::int AS this_year,
         COUNT(DISTINCT z.bkey) FILTER (WHERE z.yr = EXTRACT(YEAR FROM t.now_local) - 1)::int AS last_year,
         COALESCE(SUM(z.price) FILTER (WHERE z.billable AND z.yr = EXTRACT(YEAR FROM t.now_local)),0)::bigint AS this_year_rev,
         COALESCE(SUM(z.price) FILTER (WHERE z.billable AND z.yr = EXTRACT(YEAR FROM t.now_local) - 1),0)::bigint AS last_year_rev
       FROM (
         SELECT o.price, COALESCE(o.checkout_group_id, o.id) AS bkey,
                EXTRACT(YEAR FROM (o.created_at AT TIME ZONE '${TZ}'))::int AS yr,
                EXTRACT(DOY FROM (o.created_at AT TIME ZONE '${TZ}'))::int AS doy,
                ${SETTLED_MONEY_SQL} AS billable
         FROM orders o JOIN students s ON s.id=o.student_id
         WHERE o.status::text<>'cancelled' ${src}
       ) z CROSS JOIN t
       WHERE z.doy <= EXTRACT(DOY FROM t.now_local)`
    ),
    // Monthly order counts for this year + last year (the climbing-graph series).
    query(
      `SELECT EXTRACT(YEAR FROM (o.created_at AT TIME ZONE '${TZ}'))::int AS yr,
              EXTRACT(MONTH FROM (o.created_at AT TIME ZONE '${TZ}'))::int AS mon,
              COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS cnt
       FROM orders o JOIN students s ON s.id=o.student_id
       WHERE o.status::text<>'cancelled' ${src}
         AND o.created_at >= (date_trunc('year', NOW() AT TIME ZONE '${TZ}') - INTERVAL '1 year')
       GROUP BY yr, mon`
    ),
  ]);

  const lf = lifeR.rows[0] || {};
  const universities = uniR.rows.map((r) => ({ name: r.name, count: r.c }));
  const lifetime = {
    graduates: lf.graduates || 0,
    total_orders: lf.total_orders || 0,   // طلب  (bundles)
    total_pieces: lf.total_pieces || 0,   // قطعة (order rows)
    retail_orders: lf.retail_orders || 0, // طلب تجزئة — feeds the rank ladder
    revenue_total: Number(lf.revenue_total || 0),
    profit_total: Number(lf.profit_total || 0),
    revenue_month: Number(lf.revenue_month || 0),
    profit_month: Number(lf.profit_month || 0),
    universities_count: universities.length,
    universities, // trophy-wall list
  };

  // --- streak: consecutive days with ≥1 order, ending today or yesterday ---
  const today = nowR.rows[0]?.today || null;
  const dateSet = new Set(datesR.rows.map((r) => r.d));
  let streak = 0;
  if (today) {
    let cursor = dateSet.has(today) ? today : (dateSet.has(ymBefore(today)) ? ymBefore(today) : null);
    while (cursor && dateSet.has(cursor)) { streak++; cursor = ymBefore(cursor); }
  }
  const bd = recDayR.rows[0] || null;
  const bm = recMonR.rows[0] || null;
  const records = {
    best_day_orders: bd ? bd.cnt : 0,
    best_day_date: bd ? bd.d : null,
    best_day_revenue: bd ? Number(bd.rev) : 0,
    best_month_orders: bm ? bm.cnt : 0,
    best_month: bm ? bm.ym : null,
    streak,
  };

  // --- growth (YoY to date) + the monthly series ---
  const gr = growR.rows[0] || {};
  const thisYear = today ? Number(today.slice(0, 4)) : new Date().getFullYear();
  const thisArr = Array(12).fill(0);
  const lastArr = Array(12).fill(0);
  growSeriesR.rows.forEach((r) => {
    if (r.yr === thisYear) thisArr[r.mon - 1] = r.cnt;
    else if (r.yr === thisYear - 1) lastArr[r.mon - 1] = r.cnt;
  });
  const lastY = gr.last_year || 0;
  const thisY = gr.this_year || 0;
  const growth = {
    this_year: thisY,
    last_year: lastY,
    this_year_rev: Number(gr.this_year_rev || 0),
    last_year_rev: Number(gr.last_year_rev || 0),
    orders_pct: lastY > 0 ? Math.round(((thisY - lastY) / lastY) * 100) : null, // null = no last-year baseline ("جديد")
    series: MONTHS_AR.map((m, i) => ({ label: m, this_year: thisArr[i], last_year: lastArr[i] })),
  };

  // Rank climbs on RETAIL طلب (owner goal: 3000), not on total pieces.
  const data = { lifetime, records, growth, rank: rankFor(lifetime.retail_orders) };
  _legendCache.set(ck, { at: Date.now(), data });
  return data;
}

// ---------- snapshot (the whole board in one cached payload) ----------
const _cache = new Map(); // `${source}|${range}` → { at, data }
const CACHE_MS = 2000;

async function buildSnapshot(source, range) {
  const src = srcClause(source);
  const days = range === '30' ? 30 : range === '7' ? 7 : 1; // 'today' → 1
  const byHour = days === 1;

  const [kpiR, pipeR, tailorR, staffR, mapR, deadR, spotR, tickR, gIn, gMoney, gProd, gUni, settingsR, audienceR] = await Promise.all([
    // KPIs today vs yesterday (Baghdad-local), source-filtered.
    query(
      `WITH t AS (SELECT (NOW() AT TIME ZONE '${TZ}')::date AS d)
       SELECT
         COUNT(DISTINCT bkey) FILTER (WHERE cl = (SELECT d FROM t))::int AS orders_today,
         COUNT(*) FILTER (WHERE cl = (SELECT d FROM t))::int AS pieces_today,
         COALESCE(SUM(price) FILTER (WHERE cl = (SELECT d FROM t)),0)::bigint AS revenue_today,
         COALESCE(SUM(profit) FILTER (WHERE cl = (SELECT d FROM t)),0)::bigint AS profit_today,
         COUNT(DISTINCT bkey) FILTER (WHERE cl = (SELECT d FROM t) - 1)::int AS orders_yday,
         COALESCE(SUM(revenue_yday_price) ,0)::bigint AS revenue_yday
       FROM (
         SELECT
                COALESCE(o.checkout_group_id, o.id) AS bkey,
                CASE WHEN ${SETTLED_MONEY_SQL} THEN o.price ELSE 0 END AS price,
                CASE WHEN ${SETTLED_MONEY_SQL} THEN o.profit ELSE 0 END AS profit,
                (o.created_at AT TIME ZONE '${TZ}')::date AS cl,
                CASE WHEN ${SETTLED_MONEY_SQL}
                       AND (o.created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date - 1
                     THEN o.price ELSE 0 END AS revenue_yday_price
         FROM orders o JOIN students s ON s.id = o.student_id
         WHERE o.status::text <> 'cancelled' ${src}
       ) x`
    ),
    // Pipeline WIP per stage.
    query(
      `SELECT o.status::text AS status, COUNT(*)::int AS count
       FROM orders o JOIN students s ON s.id = o.student_id
       WHERE o.status::text = ANY($1) ${src}
       GROUP BY o.status`,
      [MANAGER_STAGES]
    ),
    // الفصال (tailor) parallel track — retail-only, pending.
    query(
      `SELECT COUNT(*)::int AS c
       FROM orders o JOIN students s ON s.id = o.student_id JOIN products p ON p.id = o.product_id
       WHERE o.tailor_status = 'pending' AND s.wholesaler_id IS NULL
         AND o.status::text NOT IN ('delivered','cancelled') AND p.type = 'sash'`
    ),
    // Staff live watch + today output.
    query(
      `SELECT u.id, u.name, u.staff_type, u.staff_types,
              ar.status AS att_status, ar.check_in_at, ar.late_minutes,
              COALESCE(us.attendance_required, TRUE) AS att_required,
              wo.order_id AS working_order, wo.wstatus AS working_status,
              COALESCE(dn.cnt, 0)::int AS done_today,
              CASE WHEN la.last_at IS NULL THEN NULL
                   ELSE ROUND(EXTRACT(EPOCH FROM (NOW() - la.last_at)) / 60)::int END AS idle_minutes
       FROM users u
       LEFT JOIN staff_attendance_records ar
              ON ar.user_id = u.id AND ar.work_date = (NOW() AT TIME ZONE '${TZ}')::date
       LEFT JOIN staff_attendance_user_settings us ON us.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT o.id AS order_id, o.status::text AS wstatus
         FROM orders o JOIN students s ON s.id = o.student_id
         WHERE o.working_staff_id = u.id
           AND o.working_since > NOW() - INTERVAL '${PRESENCE_TTL_SECONDS} seconds' ${src}
         ORDER BY o.working_since DESC LIMIT 1
       ) wo ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS cnt
         FROM audit_log a
         ${src ? 'JOIN orders o ON o.id = a.entity_id AND a.entity = \'order\' JOIN students s ON s.id = o.student_id' : ''}
         WHERE a.actor_id = u.id AND a.action = 'status_change'
           AND (a.created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date ${src}
       ) dn ON TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(a.created_at) AS last_at FROM audit_log a WHERE a.actor_id = u.id
       ) la ON TRUE
       WHERE u.role = 'staff'
       ORDER BY done_today DESC, u.name ASC`
    ),
    // Conquest map — orders per governorate.
    query(
      `SELECT cg.governorate, COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS c
       FROM orders o JOIN students s ON s.id = o.student_id
       JOIN checkout_groups cg ON cg.id = o.checkout_group_id
       WHERE cg.governorate IS NOT NULL AND o.status::text <> 'cancelled' ${src}
       GROUP BY cg.governorate`
    ),
    // Deadline wall (source-agnostic — batches are cohort-level).
    query(
      `SELECT b.id, b.name_ar, b.deadline,
              COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))
                FILTER (WHERE o.status::text NOT IN ('delivered','cancelled'))::int AS open_orders
       FROM batches b
       LEFT JOIN orders o ON o.batch_id = b.id
       WHERE b.deadline IS NOT NULL
       GROUP BY b.id, b.name_ar, b.deadline
       HAVING b.deadline > NOW() - INTERVAL '3 days'
       ORDER BY b.deadline ASC LIMIT 12`
    ),
    // Design spotlight — latest finished artwork.
    // SOURCE FIXED 2026-07-21: this read `orders.final_design_url`, a DEAD field since
    // FinalDesignUpload was deleted (2026-07-15) — only 5 orders carry one, so the wall
    // cycled the same 5 stale images forever. The real artwork now lives per-zone on
    // order_items.customer_image_url (784 orders). DISTINCT ON the image so the same
    // photo reused across zones doesn't fill the gallery with duplicates.
    query(
      `SELECT * FROM (
         SELECT DISTINCT ON (oi.customer_image_url)
                o.id, oi.customer_image_url AS final_design_url,
                u.name AS student_name, s.university_name, o.updated_at
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN students s ON s.id = o.student_id
         JOIN users u ON u.id = s.user_id
         WHERE oi.customer_image_url IS NOT NULL AND oi.customer_image_url <> ''
           AND o.status::text <> 'cancelled' ${src}
         ORDER BY oi.customer_image_url, o.updated_at DESC
       ) z ORDER BY z.updated_at DESC LIMIT 24`
    ),
    // Ticker seed — recent order events.
    query(
      `SELECT a.id, a.action, a.created_at, a.details,
              us.name AS actor_name, su.name AS student_name,
              p.name_ar AS product_name, o.status::text AS status,
              CASE WHEN s.wholesaler_id IS NULL THEN 'retail' ELSE 'wholesaler' END AS source
       FROM audit_log a
       LEFT JOIN users us ON us.id = a.actor_id
       LEFT JOIN orders o ON o.id = a.entity_id AND a.entity = 'order'
       LEFT JOIN students s ON s.id = o.student_id
       LEFT JOIN users su ON su.id = s.user_id
       LEFT JOIN products p ON p.id = o.product_id
       WHERE a.entity = 'order'
       ORDER BY a.created_at DESC LIMIT 25`
    ),
    // Graph: orders-in vs delivered, bucketed.
    query(
      // الطلبات الواردة, counted in BUNDLES (طلب). The old query also emitted a
      // 'done' series keyed on delivered_at — permanently empty (0 rows have ever
      // been delivered), so it was dropped rather than shipped as a flat zero line.
      `SELECT bucket, kind, COUNT(DISTINCT bkey)::int AS c FROM (
         SELECT 'in' AS kind, COALESCE(o.checkout_group_id, o.id) AS bkey, ${byHour
        ? `to_char(o.created_at AT TIME ZONE '${TZ}','YYYY-MM-DD"T"HH24:00')`
        : `(o.created_at AT TIME ZONE '${TZ}')::date::text`} AS bucket
         FROM orders o JOIN students s ON s.id = o.student_id
         WHERE o.status::text <> 'cancelled'
           AND o.created_at >= (NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '${days - 1} days' ${src}
       ) z GROUP BY bucket, kind`
    ),
    // Graph: revenue / profit, bucketed (on created_at).
    query(
      `SELECT ${byHour
        ? `to_char(o.created_at AT TIME ZONE '${TZ}','YYYY-MM-DD"T"HH24:00')`
        : `(o.created_at AT TIME ZONE '${TZ}')::date::text`} AS bucket,
              COALESCE(SUM(o.price),0)::bigint AS revenue,
              COALESCE(SUM(o.profit),0)::bigint AS profit
       FROM orders o JOIN students s ON s.id = o.student_id
       WHERE o.status::text <> 'cancelled'
         AND ${SETTLED_MONEY_SQL}
         AND o.created_at >= (NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '${days - 1} days' ${src}
       GROUP BY bucket`
    ),
    // Graph: team productivity (status_change actions), bucketed.
    query(
      `SELECT ${byHour
        ? `to_char(a.created_at AT TIME ZONE '${TZ}','YYYY-MM-DD"T"HH24:00')`
        : `(a.created_at AT TIME ZONE '${TZ}')::date::text`} AS bucket, COUNT(*)::int AS c
       FROM audit_log a
       WHERE a.action = 'status_change'
         AND a.created_at >= (NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '${days - 1} days'
       GROUP BY bucket`
    ),
    // Graph: top universities by volume in range.
    query(
      `SELECT s.university_name AS name, COUNT(*)::int AS c
       FROM orders o JOIN students s ON s.id = o.student_id
       WHERE s.university_name IS NOT NULL AND s.university_name <> ''
         AND o.status::text <> 'cancelled'
         AND o.created_at >= (NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '${days - 1} days' ${src}
       GROUP BY s.university_name ORDER BY c DESC LIMIT 8`
    ),
    // Board settings.
    query(`SELECT value FROM site_settings WHERE key = 'tv_board'`),
    // Live audience — distinct storefront sessions in the last 30 min (NOT source-
    // filtered; visits aren't tied to retail/wholesale). Labeled «الآن» on the board.
    query(`SELECT COUNT(DISTINCT session_id)::int AS c
            FROM site_visits WHERE created_at > now() - INTERVAL '30 minutes'`),
  ]);

  // --- shape KPIs + deltas ---
  const k = kpiR.rows[0] || {};
  const pct = (now, prev) => (prev > 0 ? Math.round(((now - prev) / prev) * 100) : now > 0 ? 100 : 0);
  const kpis = {
    orders_today: k.orders_today || 0,
    orders_delta: pct(k.orders_today || 0, k.orders_yday || 0),
    revenue_today: Number(k.revenue_today || 0),
    revenue_delta: pct(Number(k.revenue_today || 0), Number(k.revenue_yday || 0)),
    profit_today: Number(k.profit_today || 0),
    pieces_today: k.pieces_today || 0,
  };

  // --- pipeline + bottleneck ---
  const wip = {};
  MANAGER_STAGES.forEach((st) => (wip[st] = 0));
  pipeR.rows.forEach((r) => (wip[r.status] = r.count));
  const settings = settingsR.rows[0]?.value || {};
  const threshold = Number(settings.bottleneck_threshold) || 20;
  let bottleneck = null;
  let maxWip = 0;
  MANAGER_STAGES.forEach((st) => {
    if (wip[st] > maxWip) { maxWip = wip[st]; bottleneck = st; }
  });
  const bottleneckActive = maxWip >= threshold;

  // --- staff ---
  const staff = staffR.rows.map((r) => {
    const exempt = r.att_required === false;
    let presence = 'absent';
    if (exempt) presence = 'exempt';
    else if (r.att_status === 'late') presence = 'late';
    else if (r.att_status === 'present' || r.att_status === 'missing_checkout' || r.att_status === 'overridden') presence = 'present';
    return {
      id: r.id,
      name: r.name,
      role: Array.isArray(r.staff_types) && r.staff_types.length ? r.staff_types : [r.staff_type].filter(Boolean),
      presence,
      check_in_at: r.check_in_at,
      late_minutes: r.late_minutes || 0,
      working_order: r.working_order || null,
      working_status: r.working_status || null,
      done_today: r.done_today || 0,
      idle_minutes: r.idle_minutes,
    };
  });

  // --- map ---
  const gov = {};
  mapR.rows.forEach((r) => {
    const key = govKey(r.governorate);
    if (key) gov[key] = (gov[key] || 0) + r.c;
  });

  // --- graphs: fill buckets ---
  const buckets = [];
  if (byHour) {
    for (let h = 0; h < 24; h++) buckets.push(String(h).padStart(2, '0'));
  } else {
    // last `days` dates ending today (Baghdad) — computed in JS from server clock is unsafe across TZ,
    // so derive labels from the data union below instead.
  }
  const inMap = {}, revMap = {}, profMap = {}, prodMap = {};
  gIn.rows.forEach((r) => {
    const label = byHour ? r.bucket.slice(11, 13) : r.bucket;
    if (r.kind === 'in') inMap[label] = r.c;
  });
  gMoney.rows.forEach((r) => {
    const label = byHour ? r.bucket.slice(11, 13) : r.bucket;
    revMap[label] = Number(r.revenue); profMap[label] = Number(r.profit);
  });
  gProd.rows.forEach((r) => {
    const label = byHour ? r.bucket.slice(11, 13) : r.bucket;
    prodMap[label] = r.c;
  });
  // Date axis when not hourly: union of all date keys, sorted.
  const labels = byHour
    ? buckets
    : Array.from(new Set([
        ...Object.keys(inMap), ...Object.keys(revMap), ...Object.keys(prodMap),
      ])).sort();
  const series = labels.map((lb) => ({
    label: lb,
    orders_in: inMap[lb] || 0,
    revenue: revMap[lb] || 0,
    profit: profMap[lb] || 0,
    productivity: prodMap[lb] || 0,
  }));

  // --- goal ---
  const dailyGoal = Number(settings.daily_goal) > 0 ? Number(settings.daily_goal) : null;

  // --- legend (own 60s cache) + live audience ---
  const legend = await buildLegend(source);
  const audienceNow = audienceR.rows[0]?.c || 0;

  return {
    generated_at: new Date().toISOString(),
    source: source || 'all',
    range: String(days === 1 ? 'today' : days),
    kpis,
    pipeline: { wip, stages: MANAGER_STAGES, tailor_pending: tailorR.rows[0]?.c || 0,
                bottleneck, bottleneck_active: bottleneckActive, threshold },
    staff,
    leaderboard: [...staff].sort((a, b) => b.done_today - a.done_today).slice(0, 10),
    map: { gov, home: 'diyala', target: 'baghdad', reached: Object.keys(gov).length, total: TOTAL_PROVINCES },
    audience: { now: audienceNow },
    lifetime: legend.lifetime,
    records: legend.records,
    growth: legend.growth,
    rank: legend.rank,
    deadlines: deadR.rows.map((r) => ({
      id: r.id, name: r.name_ar, deadline: r.deadline, open_orders: r.open_orders,
    })),
    spotlight: spotR.rows.map((r) => ({
      id: r.id, image: r.final_design_url, student_name: r.student_name, university: r.university_name,
    })),
    ticker: tickR.rows.map((r) => ({
      id: r.id, action: r.action, at: r.created_at, status: r.status,
      actor: r.actor_name, student: r.student_name, product: r.product_name, source: r.source,
    })),
    graphs: { byHour, series, universities: gUni.rows.map((r) => ({ name: r.name, count: r.c })) },
    // done_today = قطع أُنجزت اليوم (status_change actions), NOT deliveries: 0 orders
    // have ever been marked مُسلَّم, so the old delivered-based bar could never move.
    goal: { target: dailyGoal, done_today: staff.reduce((n, r) => n + (r.done_today || 0), 0) },
    settings: {
      daily_goal: dailyGoal,
      bottleneck_threshold: threshold,
      sound: settings.sound !== false, // default on
      owner_title: (typeof settings.owner_title === 'string' && settings.owner_title.trim()) || OWNER_TITLE_DEFAULT,
    },
  };
}

async function snapshot(req, res) {
  const source = normSource(req.query.source);
  const range = ['today', '7', '30'].includes(req.query.range) ? req.query.range : 'today';
  // Money is hidden unless a correct passphrase rides in. It is sent as the
  // `x-tv-reveal` header (preferred — keeps it out of access logs); the `?reveal=`
  // query is still accepted for back-compat (e.g. admin curl). The 2s cache holds
  // the FULL (unstripped) snapshot; we derive the response per-request so a
  // money-revealed payload is never served to a non-revealed request (or vice-versa).
  const reveal = req.headers['x-tv-reveal'] || req.query.reveal;
  const revealed = await moneyRevealOk(reveal);
  const shape = (full) => (revealed ? { ...full, money_visible: true } : stripMoney(full));
  const ckey = `${source || 'all'}|${range}`;
  const hit = _cache.get(ckey);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return res.json({ data: shape(hit.data), cached: true });
  }
  try {
    const data = await buildSnapshot(source, range);
    _cache.set(ckey, { at: Date.now(), data });
    res.json({ data: shape(data) });
  } catch (err) {
    console.error('TV snapshot failed:', err.message);
    res.status(500).json({ error: 'تعذّر تحميل اللوحة', code: 'ERR_SERVER' });
  }
}

// ---------- SSE (key-gated live push; reuses the production event bus) ----------
function events(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const remove = addClient(res);
  req.on('close', () => remove());
}

// ---------- settings write (board config only — the lone allowed mutation) ----------
async function updateSettings(req, res) {
  const cur = (await query(`SELECT value FROM site_settings WHERE key = 'tv_board'`)).rows[0]?.value || {};
  const next = { ...cur };
  const b = req.body || {};
  if (b.daily_goal !== undefined) {
    const g = parseInt(b.daily_goal, 10);
    next.daily_goal = Number.isFinite(g) && g > 0 ? g : null;
  }
  if (b.bottleneck_threshold !== undefined) {
    const t = parseInt(b.bottleneck_threshold, 10);
    if (Number.isFinite(t) && t >= 1) next.bottleneck_threshold = t;
  }
  if (b.sound !== undefined) next.sound = !!b.sound;
  if (b.owner_title !== undefined) {
    const t = String(b.owner_title || '').trim().slice(0, 40);
    next.owner_title = t || null; // null → snapshot falls back to the default
  }
  await query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('tv_board', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = now()`,
    [JSON.stringify(next)]
  );
  _cache.clear();
  res.json({ data: next });
}

module.exports = {
  keyGate, snapshot, events, updateSettings,
  // money-gate helpers (shared with adminController; do NOT expose money themselves)
  moneyRevealOk, moneyGateConfigured, setMoneyGate, MONEY_GATE_KEY,
  // rank ladder — shared so /admin shows the SAME rung as the TV (owner, 2026-07-21)
  RANKS, rankFor,
};
