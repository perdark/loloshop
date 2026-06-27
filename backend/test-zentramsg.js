require('dotenv').config();
const { toIntlDigits } = require('./lib/otp');

// ───────────────────────────────────────────────────────────────────────────
// One-shot Zentramsg WhatsApp test. Sends a real message to a phone you pass,
// using the SAME creds + request shape the OTP flow uses.
//
//   node test-zentramsg.js 07712345678
//   node test-zentramsg.js 07712345678 "custom message"
//
// Needs in env: ZENTRAMSG_API_KEY (x-api-token), ZENTRAMSG_DEVICE_UUID,
// optionally ZENTRAMSG_API_URL (defaults to https://api.zentramsg.com/v1/messages).
// ───────────────────────────────────────────────────────────────────────────

const URL = process.env.ZENTRAMSG_API_URL || 'https://api.zentramsg.com/v1/messages';

async function main() {
  const phone = process.argv[2];
  const msg = process.argv[3] || 'رمز التحقق LoloShop: 123456 (اختبار)';
  const token = process.env.ZENTRAMSG_API_KEY;
  const device = process.env.ZENTRAMSG_DEVICE_UUID;

  if (!phone) { console.error('Usage: node test-zentramsg.js <phone> [message]'); process.exit(1); }
  if (!token || !device) {
    console.error('Missing env: ZENTRAMSG_API_KEY and/or ZENTRAMSG_DEVICE_UUID');
    process.exit(1);
  }

  const ids = toIntlDigits(phone);
  console.log(`→ POST ${URL}`);
  console.log(`  device_uuid=${device}`);
  console.log(`  ids=${ids}  (from "${phone}")`);

  const form = new FormData();
  form.append('device_uuid', device);
  form.append('text_message', msg);
  form.append('type_message', 'text');
  form.append('type_contact', 'numbers');
  form.append('ids', ids);

  try {
    const res = await fetch(URL, { method: 'POST', headers: { 'x-api-token': token }, body: form });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    console.log(`\nHTTP ${res.status}`);
    console.log(text);
    // Same contract the OTP flow uses: delivered only when the BODY confirms it.
    // HTTP 200 with success:false means the device is banned/expired (message pending).
    const accepted = res.ok && json && json.success === true && json.msg === 'MESSAGE_CREATED';
    console.log(accepted ? '\n✅ MESSAGE_CREATED — accepted by Zentramsg' : '\n❌ NOT accepted (check device/subscription/ban)');
    process.exit(accepted ? 0 : 1);
  } catch (e) {
    console.error('Request failed:', e.message);
    process.exit(1);
  }
}

main();
