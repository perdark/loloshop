// backend/lib/anonSession.js — HMAC-signed identities for signed-out assistant users.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────
// The assistant's anonymous allowance used to be keyed on a `sessionKey` the CLIENT generated
// and sent in the request body. Two things were wrong with trusting it, both measured:
//
//   1. THE CAP WAS FREE TO BYPASS. 25 requests carrying 25 freshly generated keys were all
//      granted. So the 10/day anon cap bounded honest visitors and nobody else — the worst
//      shape a limit can have.
//   2. IT WAS ALSO A READ. lib/aiChat.js → recentTurns rebuilds an anonymous caller's history
//      with `WHERE user_id IS NULL AND session_key = $1`. Supplying somebody else's key
//      therefore loaded THEIR last two hours into your prompt, and «شنو سألتك قبل شوية؟» reads
//      it back out. A v4 UUID is unguessable in practice, so this was low risk, not no risk —
//      and it was an unauthenticated read keyed on an unauthenticated identifier.
//
// Both come from the same root cause: an identity nobody signed. So the server issues it now.
// A token is `v1.<id>.<issuedAt>.<sig>`, and the id is only trusted once the signature checks
// out. Forging one requires JWT_SECRET; wearing someone else's requires having seen their
// token, which never leaves their own device.
//
// ── WHY NOT A COOKIE, AND WHY NOT A JWT ────────────────────────────────────────────────────
// A cookie would be the textbook answer and is the wrong one here: the storefront also runs
// inside the Capacitor WebView shells, where third-party/partitioned cookie behaviour differs
// per platform and per OS version, and it would drag CORS credentials into a request that is
// otherwise plainly public. A bearer string the client keeps in localStorage behaves the same
// everywhere and reuses the transport the rest of the API already uses.
//
// It is not a JWT because it carries no claims, has no audience and must never be mistaken for
// one by middleware/auth.js — the `v1.` prefix and a distinct HMAC context string guarantee a
// token from here can never validate as an access token, and vice versa.
//
// ZERO new npm packages, deliberately — CI runs `npm audit` before deploying, so a dependency
// carrying an advisory blocks the deploy. Node's own crypto is enough. Same rule as push.js.

const crypto = require('node:crypto');

// Domain separator. Mixed into the key so a signature from this file cannot be replayed
// anywhere else that signs with JWT_SECRET, even if the payloads ever collide.
const CONTEXT = 'loloshop:anon-session:v1';

// How long a minted identity stays valid. Long enough that a returning student keeps their
// allowance and their 2-hour conversation window across visits, short enough that a leaked
// token stops being useful. The daily caps are per rolling 24h regardless, so a long-lived
// token is not a long-lived allowance.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is required to sign anonymous assistant sessions');
  return crypto.createHash('sha256').update(`${CONTEXT}:${s}`).digest();
}

function sign(id, issuedAt) {
  return crypto
    .createHmac('sha256', secret())
    .update(`${id}.${issuedAt}`)
    .digest('base64url');
}

/** A fresh signed identity. The id itself is random and meaningless — it names nobody. */
function mint() {
  const id = crypto.randomBytes(16).toString('base64url');
  const issuedAt = Date.now();
  return `v1.${id}.${issuedAt}.${sign(id, issuedAt)}`;
}

/**
 * The id inside a token, or null if the token is absent, malformed, expired or unsigned.
 *
 * Returning null is never an error the caller has to handle specially: it just means "this
 * request has no anonymous identity", and the controller mints a new one. So a visitor whose
 * token expired or who cleared storage self-heals instead of seeing a failure.
 */
function verify(token) {
  if (typeof token !== 'string') return null;
  // Bound the work before doing any: a signed token is ~90 chars.
  if (token.length > 200) return null;

  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [version, id, issuedAtRaw, sig] = parts;
  if (version !== 'v1' || !id || !sig) return null;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return null;
  // A future issue date means a tampered or clock-skewed token; a day of slack absorbs the
  // second without accepting the first.
  if (issuedAt > Date.now() + 24 * 60 * 60 * 1000) return null;
  if (Date.now() - issuedAt > MAX_AGE_MS) return null;

  let expected;
  try {
    expected = sign(id, issuedAtRaw);
  } catch {
    return null; // JWT_SECRET missing — fail closed rather than trusting the id.
  }

  // Constant-time: the comparison is against an attacker-supplied string, so a length-aware
  // early return would leak how much of a forged signature was right.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  return id;
}

module.exports = { mint, verify, MAX_AGE_MS, _internals: { CONTEXT } };
