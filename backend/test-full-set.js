// End-to-end smoke test for POST /orders/configure-full-set using the real DM-form
// sample order (سيف الدين مهند ضياء). Run with the API up on :4000: node test-full-set.js
require('dotenv').config();
const { query, pool } = require('./lib/db');
const { signToken } = require('./middleware/auth');

const API = 'http://localhost:4000/api';

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function pick(groups, groupName, optionLabel, extra = {}) {
  const g = groups.find((x) => x.name_ar === groupName);
  if (!g) throw new Error(`group not found: ${groupName}`);
  const o = g.options.find((x) => x.label_ar === optionLabel);
  if (!o) throw new Error(`option not found: ${groupName} → ${optionLabel}`);
  return { group_id: g.id, option_id: o.id, ...extra };
}

// optional group — admin may have removed it from the catalog; skip silently
function pickIf(groups, groupName, optionLabel, extra = {}) {
  try { return pick(groups, groupName, optionLabel, extra); } catch { return null; }
}

(async () => {
  let failures = 0;
  const check = (name, cond, detail = '') => {
    console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!cond) failures++;
  };

  // mint a retail token (middleware re-loads the user from DB)
  const u = await query(
    `SELECT u.id FROM users u JOIN students s ON s.user_id = u.id
     WHERE u.role = 'retail' AND s.wholesaler_id IS NULL LIMIT 1`
  );
  const token = signToken({ id: u.rows[0].id, role: 'retail' });
  const admin = await query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  const adminToken = signToken({ id: admin.rows[0].id, role: 'admin' });

  // resolve the 3 products + their groups
  const prods = await query(
    `SELECT id, type FROM products WHERE type IN ('sash','robe','cap') AND active = TRUE
     ORDER BY type, featured DESC, sort, created_at`
  );
  const byType = {};
  for (const p of prods.rows) if (!byType[p.type]) byType[p.type] = p.id;
  const full = {};
  for (const t of ['robe', 'cap', 'sash']) {
    const r = await api(`/catalog/products/${byType[t]}/full`, { token });
    full[t] = r.json.data;
  }
  const groupsOf = (t) => (full[t].groups || full[t].optionGroups || []).map((g) => ({
    id: g.id, name_ar: g.name_ar || g.nameAr,
    options: (g.options || []).map((o) => ({ id: o.id, label_ar: o.label_ar || o.labelAr })),
  }));

  const payload = {
    package_id: null, // filled below
    robe: {
      selections: [
        pick(groupsOf('robe'), 'لون الروب', 'أسود'),
        pick(groupsOf('robe'), 'قماش الروب', 'كوبرا اندنوسي'),
        pick(groupsOf('robe'), 'فصال الروب', 'ملكي'),
        pick(groupsOf('robe'), 'ردن الروب', 'سادة'),
      ],
      measurements: { shoulder_cm: '٤٨', robe_length_cm: 115, sleeve_length_cm: 60 },
    },
    cap: {
      selections: [
        pick(groupsOf('cap'), 'لون القبعة', 'أسود'),
        pick(groupsOf('cap'), 'الشكل', 'مثلثة'),
        pick(groupsOf('cap'), 'القبعة من الجانب', 'سادة'),
        pick(groupsOf('cap'), 'القبعة من الأعلى', 'بكتابة', { customer_text: '{وَمَا تَوْفِيقِي إِلَّا بِاللَّه}' }),
      ],
    },
    sash: {
      selections: [
        pick(groupsOf('sash'), 'اللون', 'برتقالي'),
        pick(groupsOf('sash'), 'نوع الوشاح', 'ملكي'),
        pickIf(groupsOf('sash'), 'عرض الوشاح', '١٤ سم'),
        pick(groupsOf('sash'), 'لون التطريز', 'أسود'),
      ].filter(Boolean),
      zones: {
        right_text: 'المهندس سيف مهند ضياء',
        left_mode: 'logo_year',
        left_logo_url: '/uploads/logos/test-college.png',
        left_text: 'شعار الكلية — سنة التخرج 2026',
        back_text: 'كل الديون تُقضى الا دين الاهل من يقواه...',
      },
    },
    delivery: {
      customer_name: 'سيف الدين مهند ضياء',
      instagram_username: '@su3_.5',
      phone_primary: '٠٧٨٣١٢٦٢٥٥٧',
      phone_secondary: '0778 372 9548',
      governorate: 'ديالى',
      area_details: 'الخالص هبهب الناحية / قرب جامع عمار بن ياسر',
    },
    event_date: '2027-03-22',
    notes: 'يفضل ان يكون عرض الوشاح ١٤-١٥ سم',
  };

  const pkgRes = await api('/catalog/packages?full_set=1');
  payload.package_id = pkgRes.json.data[0].id;
  check('full-set package listed publicly', pkgRes.status === 200 && pkgRes.json.data.length > 0);

  // negative: bad phone
  const bad = await api('/orders/configure-full-set', {
    method: 'POST', token,
    body: { ...payload, delivery: { ...payload.delivery, phone_primary: '12345' } },
  });
  check('rejects invalid phone', bad.status === 400, JSON.stringify(bad.json));

  // negative: missing sash name
  const noName = await api('/orders/configure-full-set', {
    method: 'POST', token,
    body: { ...payload, sash: { ...payload.sash, zones: { ...payload.sash.zones, right_text: '' } } },
  });
  check('rejects missing graduate name', noName.status === 400, JSON.stringify(noName.json));

  // negative: insane measurement
  const badMeas = await api('/orders/configure-full-set', {
    method: 'POST', token,
    body: { ...payload, robe: { ...payload.robe, measurements: { shoulder_cm: 48, robe_length_cm: 999, sleeve_length_cm: 60 } } },
  });
  check('rejects out-of-range measurement', badMeas.status === 400, JSON.stringify(badMeas.json));

  // happy path
  const ok = await api('/orders/configure-full-set', { method: 'POST', token, body: payload });
  check('creates full-set bundle', ok.status === 201, JSON.stringify(ok.json).slice(0, 300));
  const data = ok.json.data || {};
  // expected: 95000 (طقم) + 5000 (وشاح ملكي) + 3000 (قبعة أعلى بكتابة) = 103000
  check('total = 103000', data.total === 103000, `got ${data.total}`);
  check('3 orders created', data.orders && data.orders.sash && data.orders.robe && data.orders.cap);

  // staff/admin detail shows intake + measurements + zone texts
  const det = await api(`/production/orders/${data.orders.sash}`, { token: adminToken });
  const o = det.json.data || {};
  check('intake present on sash order', !!o.order?.intake, JSON.stringify(o.order?.intake || {}));
  check('intake phone normalized', o.order?.intake?.phone_primary === '07831262557', o.order?.intake?.phone_primary);
  check('intake instagram stripped @', o.order?.intake?.instagram_username === 'su3_.5', o.order?.intake?.instagram_username);
  check('intake event date saved', String(o.order?.intake?.event_date || '').startsWith('2027-03-22'), String(o.order?.intake?.event_date));
  const labels = (o.items || []).map((i) => i.label_snapshot).join(' | ');
  check('sash zone lines present', labels.includes('الجهة اليمنى') && labels.includes('شعار الكلية') && labels.includes('من الخلف'), labels);
  check('sash status design_complete', o.order?.status === 'design_complete', o.order?.status);

  const robeDet = await api(`/production/orders/${data.orders.robe}`, { token: adminToken });
  const ro = robeDet.json.data || {};
  check('robe measurements saved (48/115/60)',
    ro.order?.measurements?.shoulder_cm === 48 && ro.order?.measurements?.robe_length_cm === 115 && ro.order?.measurements?.sleeve_length_cm === 60,
    JSON.stringify(ro.order?.measurements));
  check('robe plain sleeves → preparing', ro.order?.status === 'preparing', ro.order?.status);

  const capDet = await api(`/production/orders/${data.orders.cap}`, { token: adminToken });
  check('cap with top text → design_complete + embroidery flag',
    capDet.json.data?.order?.status === 'design_complete' && capDet.json.data?.order?.has_embroidery === true,
    capDet.json.data?.order?.status);

  // admin bundle view carries intake
  const bundles = await api('/admin/orders?group=bundle', { token: adminToken });
  const myBundle = (bundles.json.data?.bundles || []).find((b) => b.checkout_group_id === data.checkout_group_id);
  check('admin bundle has intake + totals', !!myBundle?.intake && myBundle.total_price === 103000,
    JSON.stringify({ total: myBundle?.total_price, intake: !!myBundle?.intake }));

  // admin records the deposit (٢٥ واصل)
  const dep = await api(`/admin/checkout-groups/${data.checkout_group_id}`, {
    method: 'PATCH', token: adminToken, body: { deposit: 25000 },
  });
  check('admin records deposit 25000', dep.status === 200 && Number(dep.json.data?.deposit) === 25000, JSON.stringify(dep.json));

  // re-submission reuses orders + intake row (no duplicates)
  const again = await api('/orders/configure-full-set', { method: 'POST', token, body: payload });
  check('re-submission idempotent (same orders)',
    again.status === 201 && again.json.data?.orders?.sash === data.orders.sash &&
    again.json.data?.checkout_group_id === data.checkout_group_id,
    JSON.stringify(again.json.data?.orders));

  const cgCount = await query(`SELECT COUNT(*)::int AS n FROM checkout_groups`);
  console.log(`checkout_groups rows: ${cgCount.rows[0].n}`);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS ✓');
  process.exitCode = failures ? 1 : 0;
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
