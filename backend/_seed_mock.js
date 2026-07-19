// Mock seed: 100 approved students under the test rep (referral TESTREP), each with a
// FULL طقم order (sash/robe/cap + full info), distributed across ALL production phases
// so every staff queue / rep status is populated. Bulk multi-row inserts in ONE tx
// (client-generated UUIDs) → fast over Neon. All mock rows are tagged by phone prefix
// `0772` so they are easy to find and fully removable.
//   node _seed_mock.js          → (re)seed (cleans prior 0772 mocks first)
//   node _seed_mock.js --clean  → remove ALL 0772 mocks and exit
require('dotenv/config');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { query, tx } = require('./lib/db');

// Per-run throwaway password for seeded accounts, printed once by the caller.
let __seedPw = null;
function seedPassword() {
  if (!__seedPw) {
    __seedPw = process.env.SEED_PASSWORD || require('crypto').randomBytes(9).toString('base64url');
    console.log(`[seed] account password for this run: ${__seedPw}`);
  }
  return __seedPw;
}


const REP_CODE = 'TESTREP';
const PREFIX = '0772';
const N = 100;
// Every order_status phase except the terminal `cancelled`.
const PHASES = ['pending_approval', 'designing', 'design_complete', 'converting', 'embroidery',
  'pressing', 'preparing', 'staff_review', 'printing', 'ready', 'delivered'];

const FIRST = ['أحمد', 'محمد', 'علي', 'حسين', 'مصطفى', 'يوسف', 'عمر', 'كرار', 'حسن', 'زيد',
  'مرتضى', 'سيف', 'حيدر', 'منتظر', 'أمير', 'حمزة', 'عباس', 'زينب', 'فاطمة', 'نور',
  'مريم', 'رقية', 'زهراء', 'آية', 'رغد', 'شهد', 'تبارك', 'بنين', 'إسراء', 'هبة'];
const FAMILY = ['أحمد', 'محمد', 'علي', 'حسين', 'كاظم', 'جبار', 'عبد', 'صالح', 'مهدي', 'حميد',
  'رحيم', 'كريم', 'فاضل', 'ستار', 'عبدالله', 'ناصر', 'سلمان', 'جاسم', 'حسن', 'قاسم'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const uuid = () => crypto.randomUUID();
const phoneFor = (i) => PREFIX + String(i).padStart(7, '0'); // 11 digits, e.g. 07720000001

async function cleanMocks() {
  const u = await query(`SELECT id FROM users WHERE phone LIKE $1`, [PREFIX + '%']);
  const uids = u.rows.map((r) => r.id);
  if (!uids.length) return 0;
  const s = await query(`SELECT id FROM students WHERE user_id = ANY($1::uuid[])`, [uids]);
  const sids = s.rows.map((r) => r.id);
  if (sids.length) await query(`DELETE FROM orders WHERE student_id = ANY($1::uuid[])`, [sids]); // cascades order_items
  await query(`DELETE FROM checkout_groups WHERE phone_primary LIKE $1`, [PREFIX + '%']);
  await query(`DELETE FROM notifications WHERE user_id = ANY($1::uuid[])`, [uids]);
  if (sids.length) await query(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [sids]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [uids]);
  return uids.length;
}

(async () => {
  const cleanOnly = process.argv.includes('--clean');
  const removed = await cleanMocks();
  console.log(`cleaned ${removed} prior mock user(s)`);
  if (cleanOnly) { console.log('clean-only done ✓'); process.exit(0); }

  const rep = (await query(
    `SELECT id, university_name, department FROM wholesalers WHERE referral_code = $1`, [REP_CODE]
  )).rows[0];
  if (!rep) { console.error(`rep ${REP_CODE} not found`); process.exit(1); }

  let batch = (await query(`SELECT id FROM batches WHERE wholesaler_id = $1 ORDER BY created_at DESC LIMIT 1`, [rep.id])).rows[0];
  if (!batch) batch = (await query(`INSERT INTO batches (name_ar, wholesaler_id) VALUES ('دفعة تجريبية', $1) RETURNING id`, [rep.id])).rows[0];

  const pkg = (await query(
    `SELECT id, name_ar, price FROM packages WHERE active = TRUE AND is_full_set = TRUE ORDER BY sort, created_at LIMIT 1`
  )).rows[0];
  if (!pkg) { console.error('no active full-set package'); process.exit(1); }

  // Resolve sash/robe/cap product ids exactly like fullSetOrder (package-pinned wins).
  const byType = {};
  for (const p of (await query(
    `SELECT p.id, p.type FROM package_products pl JOIN products p ON p.id = pl.product_id
     WHERE pl.package_id = $1 AND p.active = TRUE AND p.type IN ('sash','robe','cap')`, [pkg.id]
  )).rows) byType[p.type] = p.id;
  for (const p of (await query(
    `SELECT id, type FROM products WHERE type IN ('sash','robe','cap') AND active = TRUE
     ORDER BY type, featured DESC, sort, created_at`
  )).rows) if (!byType[p.type]) byType[p.type] = p.id;
  if (!byType.sash || !byType.robe || !byType.cap) { console.error('package products incomplete'); process.exit(1); }

  // No shipped default: dev and prod share one database, so a seeded password IS a
  // production credential. Generated per run and printed once. (LS-10)
  const hash = await bcrypt.hash(seedPassword(), 10);
  const users = [], students = [], cgs = [], orders = [], items = [];
  const phaseCounts = {};

  for (let i = 1; i <= N; i++) {
    const first = pick(FIRST);
    const name = `${first} ${pick(FAMILY)} ${pick(FAMILY)}`;
    const phone = phoneFor(i);
    const phase = PHASES[(i - 1) % PHASES.length];
    phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
    const delivered = phase === 'delivered' ? new Date() : null;

    const uid = uuid(), sid = uuid(), cgId = uuid();
    const sashOid = uuid(), robeOid = uuid(), capOid = uuid();
    const meas = JSON.stringify({
      robe_length_cm: 100 + Math.floor(Math.random() * 30),
      sleeve_length_cm: 55 + Math.floor(Math.random() * 15),
      shoulder_cm: 40 + Math.floor(Math.random() * 15),
    });
    const sashType = Math.random() < 0.5 ? 'عادي' : 'ملكي';
    const capType = Math.random() < 0.5 ? 'عادي' : 'ملكي';
    const pleat = Math.random() < 0.5;
    const shawl = Math.random() < 0.3;
    const capEmb = Math.random() < 0.4;
    const notes = Math.random() < 0.2 ? 'طلب تجريبي' : null;

    users.push([uid, name, phone, hash, 'retail', true]);
    students.push([sid, uid, rep.id, name, rep.university_name, rep.department, i % 2 ? 'morning' : 'evening', `mock_${i}`, 'approved']);
    cgs.push([cgId, name, phone, notes]);

    // has_embroidery=TRUE on every piece → visible in every stage queue incl. the
    // designer's design-less filter; needs_pressing=TRUE so the pressing queue fills too.
    orders.push([sashOid, sid, byType.sash, batch.id, pkg.id, cgId, Number(pkg.price), phase, true, true, null, notes, delivered]);
    orders.push([robeOid, sid, byType.robe, batch.id, pkg.id, cgId, 0, phase, true, true, meas, notes, delivered]);
    orders.push([capOid, sid, byType.cap, batch.id, pkg.id, cgId, 0, phase, true, true, null, notes, delivered]);

    // order_items: [order_id, group_id, option_id, label, price, qty, image, text]
    items.push([sashOid, null, null, `طقم: ${pkg.name_ar}`, Number(pkg.price), 1, null, null]);
    items.push([sashOid, null, null, 'نوع الوشاح', 0, 1, null, sashType]);
    if (shawl) items.push([sashOid, null, null, 'شال امريكي', 0, 1, '/uploads/images/mock-shawl.jpg', 'نعم']);
    items.push([sashOid, null, null, 'تطريز الوشاح من الأمام', 0, 1, null, first]);
    items.push([robeOid, null, null, `ضمن طقم: ${pkg.name_ar}`, 0, 1, null, null]);
    items.push([robeOid, null, null, 'كسرة الكتف', 0, 1, null, pleat ? 'نعم' : 'لا']);
    items.push([capOid, null, null, `ضمن طقم: ${pkg.name_ar}`, 0, 1, null, null]);
    items.push([capOid, null, null, 'نوع القبعة', 0, 1, null, capType]);
    if (capEmb) items.push([capOid, null, null, 'تطريز القبعة من الجانب', 0, 1, null, first]);
  }

  const ins = async (client, table, cols, rows, ncols) => {
    const per = Math.max(1, Math.floor(60000 / ncols));
    for (let off = 0; off < rows.length; off += per) {
      const chunk = rows.slice(off, off + per);
      let p = 1;
      const vals = chunk.map((r) => '(' + r.map(() => '$' + (p++)).join(',') + ')').join(',');
      await client.query(`INSERT INTO ${table} (${cols}) VALUES ${vals}`, chunk.flat());
    }
  };

  await tx(async (client) => {
    await ins(client, 'users', 'id, name, phone, password_hash, role, phone_verified', users, 6);
    await ins(client, 'students', 'id, user_id, wholesaler_id, full_name_third, university_name, department, study_type, instagram_username, status', students, 9);
    await ins(client, 'checkout_groups', 'id, customer_name, phone_primary, notes', cgs, 4);
    await ins(client, 'orders', 'id, student_id, product_id, batch_id, package_id, checkout_group_id, price, status, has_embroidery, needs_pressing, measurements, notes, delivered_at', orders, 13);
    await ins(client, 'order_items', 'order_id, group_id, option_id, label_snapshot, price_snapshot, qty, customer_image_url, customer_text', items, 8);
  });

  console.log('phase distribution (طقم orders):', JSON.stringify(phaseCounts));
  const byStatus = (await query(
    `SELECT o.status, COUNT(*)::int n FROM orders o JOIN students s ON s.id = o.student_id
     WHERE s.wholesaler_id = $1 GROUP BY o.status ORDER BY o.status`, [rep.id]
  )).rows;
  console.log('underlying orders by status:', JSON.stringify(byStatus));
  const stu = (await query(`SELECT COUNT(*)::int n FROM students WHERE wholesaler_id = $1`, [rep.id])).rows[0].n;
  console.log(`done ✓ rep students: ${stu} | ${N} طقم orders × 3 pieces = ${N * 3} underlying`);
  process.exit(0);
})().catch((e) => { console.error('SEED ERR', e); process.exit(1); });
