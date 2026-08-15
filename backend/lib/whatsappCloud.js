// WhatsApp Cloud API — the OFFICIAL Meta sender for OTP codes.
//
// Why this exists: the Zentramsg path in lib/otp.js drives a real WhatsApp *account* with
// automation, which Meta bans periodically. Every guard around it (the 4-device fleet, the 12h
// cooldown, OTP_DEGRADED_UNTIL) is damage control for a sender that is expected to die. The
// Cloud API is a first-party API with an API key — it cannot be "banned" mid-flight, so once it
// is configured it becomes the primary and Zentramsg drops to a fallback.
//
// ── What is DIFFERENT from Zentramsg, and why the code looks like this ──────────────────────
//
//  * You cannot send free text. An OTP must go out as an approved **authentication template**
//    with the code as a parameter — Meta rejects free-form "رمز التحقق: 123456" outright, and
//    sending auth content through a non-auth template is a template-quality violation. So the
//    body is a template reference (WHATSAPP_OTP_TEMPLATE), not a message string.
//  * The code is passed TWICE: once as the body parameter (the visible digits) and once as the
//    button parameter (what the copy-code / one-tap-autofill button hands the app). Meta requires
//    both on an authentication template; omitting the button parameter is error 132000.
//  * "Accepted" means accepted, not delivered. A 200 with a `wamid` says Meta queued it. The
//    only fully-negative signal we get synchronously is an `error` object — which is genuinely
//    more than Zentramsg gives us, where a banned device also returns HTTP 200.
//
// ── The recipient-vs-sender distinction, which the Zentramsg path CANNOT make ────────────────
//
// lib/otp.js has a long comment explaining that it cannot tell a banned device from a bad number
// by reading Zentramsg's error, so it only ever cools a device down when ANOTHER device proved
// the recipient was fine. The Cloud API tells us directly (error 131026 = this number cannot
// receive WhatsApp). That matters for one decision: when Meta says the RECIPIENT is the problem,
// retrying through Zentramsg is guaranteed waste — Zentramsg delivers over the same WhatsApp
// network, so a number with no WhatsApp has no WhatsApp there either. We return immediately and
// let the caller stop, rather than spending a Zentramsg send (and the ban risk that carries) to
// learn the same thing.
//
// No new npm packages, deliberately: CI runs `npm audit --omit=dev --audit-level=moderate` and a
// dependency carrying an advisory blocks the whole deploy. Native fetch only.

// Meta retires a Graph version roughly two years after release, and an expired version starts
// failing every send at once. Both the version and the whole URL are env-overridable so a
// version bump is `pm2 restart loloshop-api --update-env`, not a deploy.
const DEFAULT_API_VERSION = 'v23.0';
const SEND_TIMEOUT_MS = 15000;

function apiUrl() {
  const override = (process.env.WHATSAPP_CLOUD_API_URL || '').trim();
  if (override) return override;
  const version = (process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION).trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  return `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
}

// Configured means "we have all three of the things a send needs". Anything less and the caller
// must fall through to Zentramsg — a half-configured Cloud API that 401s on every send would
// otherwise silently take the whole OTP flow down while looking enabled.
function isConfigured() {
  return Boolean(
    (process.env.WHATSAPP_TOKEN || '').trim() &&
    (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim() &&
    (process.env.WHATSAPP_OTP_TEMPLATE || '').trim()
  );
}

// Meta error codes that mean THE RECIPIENT cannot be reached, as opposed to something wrong on
// our side. Only these justify skipping the Zentramsg fallback (see the header). Everything else
// — expired token, rate limit, template problem, network — is our problem and Zentramsg may well
// still deliver, so it is treated as transient and falls through.
//   131026 message undeliverable (no WhatsApp account / cannot receive)
//   131051 unsupported message type for this recipient
//   131052 media download error — not recipient, but never fixed by a retry
const RECIPIENT_PERMANENT = new Set([131026, 131051, 131052]);

/**
 * Send one OTP code via the WhatsApp Cloud API.
 *
 * @param {string} intlDigits recipient in international digits, no '+' (e.g. 9647712345678).
 *                            Callers must normalise AND validate before calling — this function
 *                            trusts the number, exactly like postToDevice does.
 * @param {string} code       the plaintext OTP code
 * @returns {Promise<{success:boolean, wamid?:string, code?:number, recipientPermanent?:boolean,
 *                    error?:string, details?:string}>}
 */
async function send(intlDigits, code) {
  const token = (process.env.WHATSAPP_TOKEN || '').trim();
  const template = (process.env.WHATSAPP_OTP_TEMPLATE || '').trim();
  // Template languages are exact: a template approved as 'ar' is NOT reachable as 'ar_AR', and
  // the mismatch surfaces as 132001 ("template does not exist") rather than a language error.
  const language = (process.env.WHATSAPP_OTP_TEMPLATE_LANG || 'ar').trim();

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: intlDigits,
    type: 'template',
    template: {
      name: template,
      language: { code: language },
      components: [
        // The visible digits in the message body.
        { type: 'body', parameters: [{ type: 'text', text: String(code) }] },
        // The same digits again for the copy-code / one-tap button. sub_type is 'url' for BOTH
        // authentication button styles — that is Meta's spec, not a copy-paste error, and
        // omitting this component fails the send with 132000 (parameter count mismatch).
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: String(code) }],
        },
      ],
    },
  };

  try {
    const res = await fetch(apiUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // Without a timeout a hung Meta connection holds the HTTP request that is waiting on the
      // OTP open until the client gives up, and the user sees a spinner rather than an error
      // they can act on.
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON (proxy/HTML error page) — keep raw */ }

    if (res.ok && parsed && Array.isArray(parsed.messages) && parsed.messages.length) {
      return { success: true, wamid: parsed.messages[0].id };
    }

    const err = parsed && parsed.error ? parsed.error : null;
    const errCode = err && Number.isFinite(err.code) ? err.code : null;
    const recipientPermanent = errCode != null && RECIPIENT_PERMANENT.has(errCode);

    // 190 is an expired/invalid access token. It routes every future send back to Zentramsg
    // while looking configured, so it gets its own loud line rather than blending into the
    // generic rejection log.
    if (errCode === 190 || res.status === 401) {
      console.error(
        '[OTP][cloud] ACCESS TOKEN REJECTED — every OTP is falling back to Zentramsg until ' +
        'WHATSAPP_TOKEN is replaced. Generate a System User token (they do not expire) rather ' +
        'than a 24h test token.'
      );
    } else {
      console.error(
        `[OTP][cloud] send rejected: HTTP ${res.status} code=${errCode ?? '?'} ` +
        `${err?.message ?? text}`,
        err?.error_data?.details ?? ''
      );
    }

    return {
      success: false,
      code: errCode,
      recipientPermanent,
      error: err?.message || `HTTP ${res.status}`,
      details: text,
    };
  } catch (e) {
    // Network error / timeout. Never recipient-permanent — we have no evidence about the
    // recipient at all, so the caller should still try Zentramsg.
    console.error(`[OTP][cloud] transport error: ${e.name}: ${e.message}`);
    return { success: false, recipientPermanent: false, error: e.message, details: e.stack };
  }
}

// Read-only view for the admin gateway panel. Reports configuration only — there is no per-device
// health to track here, which is the entire point of moving to it.
function status() {
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  return {
    configured: isConfigured(),
    // The phone number id is an account identifier that reaches an admin screen, so it is masked
    // the same way device uuids are.
    phone_number_id: phoneNumberId ? `${phoneNumberId.slice(0, 6)}…` : null,
    template: (process.env.WHATSAPP_OTP_TEMPLATE || '').trim() || null,
    api_version: (process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION).trim(),
  };
}

module.exports = { send, isConfigured, status };
