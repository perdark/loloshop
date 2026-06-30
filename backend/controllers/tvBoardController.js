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
const { query } = require('../lib/db');
const { addClient } = require('../lib/eventBus');

const TZ = 'Asia/Baghdad';
const MANAGER_STAGES = ['design_complete', 'converting', 'embroidery', 'pressing', 'preparing', 'ready'];
const PRESENCE_TTL_SECONDS = 90;

// ---------- key gate ----------
function tvKeyOk(provided) {
  const key = process.env.TV_BOARD_KEY;
  return !!key && typeof provided === 'string' && provided === key; // fail closed
}
function keyGate(req, res, next) {
  if (!tvKeyOk(req.query.key)) {
    return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  }
  next();
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

// ---------- snapshot (the whole board in one cached payload) ----------
const _cache = new Map(); // `${source}|${range}` → { at, data }
const CACHE_MS = 2000;

async function buildSnapshot(source, range) {
  const src = srcClause(source);
  const days = range === '30' ? 30 : range === '7' ? 7 : 1; // 'today' → 1
  const byHour = days === 1;

  const [kpiR, pipeR, tailorR, staffR, mapR, deadR, spotR, tickR, gIn, gMoney, gProd, gUni, settingsR] = await Promise.all([
    // KPIs today vs yesterday (Baghdad-local), source-filtered.
    query(
      `WITH t AS (SELECT (NOW() AT TIME ZONE '${TZ}')::date AS d)
       SELECT
         COUNT(*) FILTER (WHERE cl = (SELECT d FROM t))::int AS orders_today,
         COALESCE(SUM(price) FILTER (WHERE cl = (SELECT d FROM t)),0)::bigint AS revenue_today,
         COALESCE(SUM(profit) FILTER (WHERE cl = (SELECT d FROM t)),0)::bigint AS profit_today,
         COUNT(*) FILTER (WHERE cl = (SELECT d FROM t) - 1)::int AS orders_yday,
         COALESCE(SUM(revenue_yday_price) ,0)::bigint AS revenue_yday,
         COUNT(*) FILTER (WHERE dl = (SELECT d FROM t))::int AS delivered_today,
         COUNT(*) FILTER (WHERE dl = (SELECT d FROM t) - 1)::int AS delivered_yday
       FROM (
         SELECT o.price, o.profit,
                (o.created_at AT TIME ZONE '${TZ}')::date AS cl,
                (o.delivered_at AT TIME ZONE '${TZ}')::date AS dl,
                CASE WHEN (o.created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date - 1 THEN o.price ELSE 0 END AS revenue_yday_price
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
      `SELECT cg.governorate, COUNT(*)::int AS c
       FROM orders o JOIN students s ON s.id = o.student_id
       JOIN checkout_groups cg ON cg.id = o.checkout_group_id
       WHERE cg.governorate IS NOT NULL AND o.status::text <> 'cancelled' ${src}
       GROUP BY cg.governorate`
    ),
    // Deadline wall (source-agnostic — batches are cohort-level).
    query(
      `SELECT b.id, b.name_ar, b.deadline,
              COUNT(o.id) FILTER (WHERE o.status::text NOT IN ('delivered','cancelled'))::int AS open_orders
       FROM batches b
       LEFT JOIN orders o ON o.batch_id = b.id
       WHERE b.deadline IS NOT NULL
       GROUP BY b.id, b.name_ar, b.deadline
       HAVING b.deadline > NOW() - INTERVAL '3 days'
       ORDER BY b.deadline ASC LIMIT 12`
    ),
    // Design spotlight — latest finished artwork.
    query(
      `SELECT o.id, o.final_design_url, u.name AS student_name, s.university_name
       FROM orders o JOIN students s ON s.id = o.student_id JOIN users u ON u.id = s.user_id
       WHERE o.final_design_url IS NOT NULL ${src}
       ORDER BY o.updated_at DESC LIMIT 12`
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
      `SELECT bucket, kind, COUNT(*)::int AS c FROM (
         SELECT 'in' AS kind, ${byHour
        ? `to_char(o.created_at AT TIME ZONE '${TZ}','YYYY-MM-DD"T"HH24:00')`
        : `(o.created_at AT TIME ZONE '${TZ}')::date::text`} AS bucket
         FROM orders o JOIN students s ON s.id = o.student_id
         WHERE o.status::text <> 'cancelled'
           AND o.created_at >= (NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '${days - 1} days' ${src}
         UNION ALL
         SELECT 'done' AS kind, ${byHour
        ? `to_char(o.delivered_at AT TIME ZONE '${TZ}','YYYY-MM-DD"T"HH24:00')`
        : `(o.delivered_at AT TIME ZONE '${TZ}')::date::text`} AS bucket
         FROM orders o JOIN students s ON s.id = o.student_id
         WHERE o.delivered_at IS NOT NULL
           AND o.delivered_at >= (NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '${days - 1} days' ${src}
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
    delivered_today: k.delivered_today || 0,
    delivered_delta: pct(k.delivered_today || 0, k.delivered_yday || 0),
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
  const inMap = {}, doneMap = {}, revMap = {}, profMap = {}, prodMap = {};
  gIn.rows.forEach((r) => {
    const label = byHour ? r.bucket.slice(11, 13) : r.bucket;
    if (r.kind === 'in') inMap[label] = r.c; else doneMap[label] = r.c;
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
        ...Object.keys(inMap), ...Object.keys(doneMap), ...Object.keys(revMap), ...Object.keys(prodMap),
      ])).sort();
  const series = labels.map((lb) => ({
    label: lb,
    orders_in: inMap[lb] || 0,
    done: doneMap[lb] || 0,
    revenue: revMap[lb] || 0,
    profit: profMap[lb] || 0,
    productivity: prodMap[lb] || 0,
  }));

  // --- goal ---
  const dailyGoal = Number(settings.daily_goal) > 0 ? Number(settings.daily_goal) : null;

  return {
    generated_at: new Date().toISOString(),
    source: source || 'all',
    range: String(days === 1 ? 'today' : days),
    kpis,
    pipeline: { wip, stages: MANAGER_STAGES, tailor_pending: tailorR.rows[0]?.c || 0,
                bottleneck, bottleneck_active: bottleneckActive, threshold },
    staff,
    leaderboard: [...staff].sort((a, b) => b.done_today - a.done_today).slice(0, 10),
    map: { gov, home: 'diyala', target: 'baghdad', reached: Object.keys(gov).length },
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
    goal: { target: dailyGoal, done_today: kpis.delivered_today },
    settings: {
      daily_goal: dailyGoal,
      bottleneck_threshold: threshold,
      sound: settings.sound !== false, // default on
    },
  };
}

async function snapshot(req, res) {
  const source = normSource(req.query.source);
  const range = ['today', '7', '30'].includes(req.query.range) ? req.query.range : 'today';
  const ckey = `${source || 'all'}|${range}`;
  const hit = _cache.get(ckey);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return res.json({ data: hit.data, cached: true });
  }
  try {
    const data = await buildSnapshot(source, range);
    _cache.set(ckey, { at: Date.now(), data });
    res.json({ data });
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
  await query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('tv_board', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = now()`,
    [JSON.stringify(next)]
  );
  _cache.clear();
  res.json({ data: next });
}

module.exports = { keyGate, snapshot, events, updateSettings };
