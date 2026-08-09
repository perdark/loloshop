// ───────────────────────────────────────────────────────────────────────────
// Push transport — FCM HTTP v1 (Android) and APNs HTTP/2 (iOS).
//
// ⚠️ NO NEW npm DEPENDENCY, AND THAT IS A DEPLOY REQUIREMENT, NOT A PREFERENCE.
// .github/workflows/ci.yml:22 runs `npm audit --omit=dev --audit-level=moderate` and the
// deploy job needs it green, so ANY package that picks up a moderate advisory stops the
// site from shipping — not just this feature. `firebase-admin` alone pulls ~40 transitive
// packages (google-auth-library, gaxios, protobufjs, …) into that gate forever, to do two
// things Node already does: sign a JWT (crypto) and make an HTTP/2 request (http2).
//
// WHY iOS TALKS TO APPLE DIRECTLY INSTEAD OF GOING THROUGH FIREBASE. Routing iOS pushes
// through FCM requires the Firebase iOS SDK inside the app, and `@capacitor/push-notifications`
// then hands back an FCM token instead of an APNs one. Our iOS project is REGENERATED from
// Capacitor's template on every Codemagic run (`npx cap add ios`), which is the same
// regeneration trap that already forces the privacy strings and the associated-domains
// entitlement to be re-injected by hand each build — adding a Firebase SPM dependency and a
// GoogleService-Info.plist to that list is a third thing to lose silently. Sending straight to
// APNs needs nothing in the app at all: the plugin's stock iOS token IS the APNs token, and
// the .p8 key lives only on the server.
//
// So the owner's Firebase project is used for ANDROID ONLY. The APNs .p8 key goes in the
// backend .env (APNS_KEY_P8), not — or not only — uploaded to Firebase.
//
// Everything here is best-effort: a push that cannot be sent is logged and the notification
// row is marked, never retried into a loop and never allowed to throw into a request handler.
// The in-app notification list stays the source of truth.
// ───────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const fs = require('fs');
const http2 = require('http2');

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const HTTP_TIMEOUT_MS = 10_000;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** Env values pasted from a JSON/PEM file arrive with literal backslash-n. */
function normalizePem(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

function readEnvOrFile(inlineVar, fileVar) {
  const inline = process.env[inlineVar];
  if (inline && inline.trim()) return inline;
  const file = process.env[fileVar];
  if (file && file.trim()) {
    try {
      return fs.readFileSync(file.trim(), 'utf8');
    } catch (err) {
      console.error(`push: cannot read ${fileVar} (${file}):`, err.message);
    }
  }
  return '';
}

// ── FCM (Android) ──────────────────────────────────────────────────────────

let fcmConfig; // undefined = not resolved yet, null = not configured
function getFcmConfig() {
  if (fcmConfig !== undefined) return fcmConfig;
  const raw = readEnvOrFile('FCM_SERVICE_ACCOUNT_JSON', 'FCM_SERVICE_ACCOUNT_FILE');
  if (!raw.trim()) return (fcmConfig = null);
  try {
    const sa = JSON.parse(raw);
    if (!sa.project_id || !sa.client_email || !sa.private_key) {
      throw new Error('service account is missing project_id/client_email/private_key');
    }
    return (fcmConfig = {
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: normalizePem(sa.private_key),
    });
  } catch (err) {
    console.error('push: FCM service account is unusable —', err.message);
    return (fcmConfig = null);
  }
}

let fcmToken = null; // { value, expiresAt }
async function fcmAccessToken() {
  const cfg = getFcmConfig();
  if (!cfg) return null;
  // 60s of slack so a token cannot expire between the check and the send.
  if (fcmToken && Date.now() < fcmToken.expiresAt - 60_000) return fcmToken.value;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: FCM_SCOPE,
      aud: OAUTH_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(cfg.privateKey)
    .toString('base64url');

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // Never log the assertion or the service account — this line goes to PM2 logs.
    throw new Error(`FCM auth failed (${res.status}): ${body.error_description || body.error || 'no access_token'}`);
  }
  fcmToken = {
    value: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
  };
  return fcmToken.value;
}

/**
 * Google's own vocabulary for "this token is dead, stop sending to it".
 * Anything else (429, 5xx, a network blip) is transient and must NOT delete a real device.
 */
function fcmTokenIsDead(status, body) {
  if (status === 404) return true; // UNREGISTERED — app uninstalled
  if (status === 403) return true; // SENDER_ID_MISMATCH — token belongs to another project
  if (status === 400) {
    const details = body?.error?.details || [];
    if (details.some((d) => d.errorCode === 'UNREGISTERED' || d.errorCode === 'INVALID_ARGUMENT')) {
      return true;
    }
    return /registration token|not a valid FCM/i.test(JSON.stringify(body?.error || {}));
  }
  return false;
}

async function sendFcm(token, message) {
  const cfg = getFcmConfig();
  const accessToken = await fcmAccessToken();
  if (!cfg || !accessToken) return { ok: false, dead: false, reason: 'fcm_not_configured' };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body || undefined },
          // Every value must be a string — FCM rejects the whole message otherwise.
          // This is what the tap handler reads to navigate (components/PushRegistrar.tsx).
          data: {
            link: message.link || '',
            type: message.type || '',
            notification_id: message.id || '',
          },
          android: {
            priority: 'HIGH',
            // No channel_id on purpose: naming a channel the app has not created means the
            // notification is dropped silently on Android 8+. Unset falls back to FCM's own
            // channel, which always exists.
            notification: { sound: 'default' },
          },
        },
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    }
  );
  if (res.ok) return { ok: true, dead: false };
  const body = await res.json().catch(() => ({}));
  return {
    ok: false,
    dead: fcmTokenIsDead(res.status, body),
    reason: `fcm_${res.status}:${body?.error?.status || ''}`,
  };
}

// ── APNs (iOS) ─────────────────────────────────────────────────────────────

let apnsConfig;
function getApnsConfig() {
  if (apnsConfig !== undefined) return apnsConfig;
  const key = normalizePem(readEnvOrFile('APNS_KEY_P8', 'APNS_KEY_FILE'));
  const keyId = (process.env.APNS_KEY_ID || '').trim();
  const teamId = (process.env.APNS_TEAM_ID || process.env.IOS_TEAM_ID || '').trim();
  if (!key || !keyId || !teamId) return (apnsConfig = null);
  return (apnsConfig = {
    key,
    keyId,
    teamId,
    topic: (process.env.APNS_BUNDLE_ID || 'com.loloshop96.app').trim(),
    // A production-signed build (App Store or TestFlight) only ever reaches the production
    // host. Set APNS_ENV=sandbox when testing a development build from Xcode.
    host: process.env.APNS_ENV === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com',
  });
}

let apnsJwt = null; // { value, issuedAt }
function apnsBearer() {
  const cfg = getApnsConfig();
  if (!cfg) return null;
  // Apple rejects a token older than 1h AND refuses more than one refresh per 20 minutes
  // (TooManyProviderTokenUpdates). 50 minutes sits safely between the two.
  if (apnsJwt && Date.now() - apnsJwt.issuedAt < 50 * 60_000) return apnsJwt.value;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId, typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: cfg.teamId, iat: now }));
  // ⚠️ `dsaEncoding: 'ieee-p1363'`. Node signs ECDSA as DER by default; JOSE requires the raw
  // r‖s pair. Without this every APNs request comes back 403 InvalidProviderToken, and the
  // signature looks perfectly valid locally.
  const signature = crypto
    .sign('sha256', Buffer.from(`${header}.${claims}`), {
      key: cfg.key,
      dsaEncoding: 'ieee-p1363',
    })
    .toString('base64url');
  apnsJwt = { value: `${header}.${claims}.${signature}`, issuedAt: Date.now() };
  return apnsJwt.value;
}

let apnsSession = null;
function apnsConnect(host) {
  if (apnsSession && !apnsSession.closed && !apnsSession.destroyed) return apnsSession;
  const session = http2.connect(`https://${host}`);
  session.on('error', (err) => {
    console.error('push: APNs session error —', err.message);
    if (apnsSession === session) apnsSession = null;
  });
  session.on('close', () => {
    if (apnsSession === session) apnsSession = null;
  });
  // A pooled connection must never be the reason the API process refuses to exit on SIGTERM.
  session.unref();
  apnsSession = session;
  return session;
}

/** Apple's "this device token is gone" set. Everything else is retryable/transient. */
function apnsTokenIsDead(status, reason) {
  if (status === 410) return true; // Unregistered
  return status === 400 && ['BadDeviceToken', 'DeviceTokenNotForTopic'].includes(reason);
}

function sendApns(token, message) {
  const cfg = getApnsConfig();
  const bearer = cfg && apnsBearer();
  if (!cfg || !bearer) return Promise.resolve({ ok: false, dead: false, reason: 'apns_not_configured' });

  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    let req;
    try {
      req = apnsConnect(cfg.host).request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${bearer}`,
        'apns-topic': cfg.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        // Drop rather than queue forever: a «طلب جديد» from six hours ago is noise.
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
        'content-type': 'application/json',
      });
    } catch (err) {
      return done({ ok: false, dead: false, reason: `apns_connect:${err.message}` });
    }

    let status = 0;
    let raw = '';
    req.setTimeout(HTTP_TIMEOUT_MS, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      done({ ok: false, dead: false, reason: 'apns_timeout' });
    });
    req.on('response', (headers) => {
      status = Number(headers[':status'] || 0);
    });
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('error', (err) => done({ ok: false, dead: false, reason: `apns_error:${err.message}` }));
    req.on('end', () => {
      if (status === 200) return done({ ok: true, dead: false });
      let reason = '';
      try {
        reason = JSON.parse(raw).reason || '';
      } catch { /* Apple returns an empty body on some errors */ }
      done({ ok: false, dead: apnsTokenIsDead(status, reason), reason: `apns_${status}:${reason}` });
    });

    req.end(
      JSON.stringify({
        aps: {
          alert: { title: message.title, body: message.body || undefined },
          sound: 'default',
        },
        link: message.link || '',
        type: message.type || '',
        notification_id: message.id || '',
      })
    );
  });
}

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * Which platforms this process can actually deliver to. Callers use it to stay completely
 * inert before the owner has created the Firebase project / APNs key, rather than marking
 * notifications as failed against a sender that was never set up.
 */
function configured() {
  return { android: Boolean(getFcmConfig()), ios: Boolean(getApnsConfig()) };
}

function isConfigured() {
  const c = configured();
  return c.android || c.ios;
}

/**
 * Deliver one message to one device.
 * @returns {Promise<{ok:boolean, dead:boolean, reason?:string}>}
 *   `dead: true` means the provider says this token will never work again — the caller
 *   deletes the row. It is the ONLY signal that may remove a device.
 */
async function sendToDevice(device, message) {
  try {
    if (device.platform === 'ios') return await sendApns(device.token, message);
    if (device.platform === 'android') return await sendFcm(device.token, message);
    return { ok: false, dead: false, reason: `unknown_platform:${device.platform}` };
  } catch (err) {
    // Auth failures, DNS, TLS — transient by assumption. Never delete a device over these.
    return { ok: false, dead: false, reason: `throw:${err.message}` };
  }
}

/** Test seam: forget the cached credentials/tokens so env changes are picked up. */
function resetForTests() {
  fcmConfig = undefined;
  apnsConfig = undefined;
  fcmToken = null;
  apnsJwt = null;
}

module.exports = {
  configured,
  isConfigured,
  sendToDevice,
  resetForTests,
  // exported for unit tests
  _internals: { fcmTokenIsDead, apnsTokenIsDead, normalizePem, apnsBearer },
};
