// backend/controllers/studioController.js — «الاستوديو»: ChatGPT-like tool for design staff.
// See docs/superpowers/specs/2026-10-04-studio-chatgpt.md for the full spec.
const sharp = require('sharp');
const { query, tx } = require('../lib/db');
const { saveBufferToUploads } = require('../lib/upload');
const studioAi = require('../lib/studioAi');
const studioCaps = require('../lib/studioCaps');
const { firstTitle, buildChatMessages } = require('../lib/studioMessages');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(res, msg, code = 'ERR_VALIDATION', status = 400) {
  return res.status(status).json({ error: msg, code });
}
function fail(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  e.expose = true;
  return e;
}

async function loadConversation(id) {
  const { rows } = await query(`SELECT * FROM studio_conversations WHERE id = $1`, [id]);
  return rows[0] || null;
}

/**
 * Owner-only for writes; owner OR admin for reads — "admin may read any" per the spec.
 * `conv` is expected to already be the result of loadConversation (404s if missing).
 */
function assertAccess(conv, user, { ownerOnly = false } = {}) {
  if (!conv) throw fail(404, 'ERR_NOT_FOUND', 'المحادثة غير موجودة');
  if (conv.user_id === user.id) return;
  if (!ownerOnly && user.role === 'admin') return;
  throw fail(403, 'ERR_FORBIDDEN', 'ممنوع');
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_DIMENSION = 2000;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

/**
 * Validate + re-encode one multer memoryStorage file (jpg/png/webp only, ≤10MB), and store it
 * under /uploads/studio/ with a random hex name (lib/upload.js's saveBufferToUploads). Returns
 * `{ url, buffer }` — the re-encoded buffer, kept in memory so the same image can also be
 * attached to the SmartAPI call (as a chat data URL or an image-edit input) with no extra disk
 * read. Throws an Arabic ERR_INVALID_IMAGE on anything that fails to parse as one of the three
 * allowed formats — never trusts the client-supplied mimetype alone.
 */
async function saveStudioUpload(req, file) {
  if (!file || !file.buffer || !file.buffer.length) {
    throw fail(400, 'ERR_INVALID_IMAGE', 'ملف الصورة غير صالح');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw fail(400, 'ERR_INVALID_IMAGE', 'حجم الصورة أكبر من 10 ميجابايت');
  }
  let metadata;
  try {
    metadata = await sharp(file.buffer, { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw fail(400, 'ERR_INVALID_IMAGE', 'ملف الصورة غير صالح');
  }
  if (!ALLOWED_FORMATS.has(metadata.format)) {
    throw fail(400, 'ERR_INVALID_IMAGE', 'نوع الصورة غير مدعوم (JPG, PNG, WEBP فقط)');
  }
  const keepAlpha = Boolean(metadata.hasAlpha);
  const pipeline = sharp(file.buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: MAX_UPLOAD_DIMENSION,
      height: MAX_UPLOAD_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });
  const buffer = keepAlpha
    ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
    : await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  const saved = saveBufferToUploads(req, 'studio', buffer, keepAlpha ? 'png' : 'jpg');
  return { url: saved.url, buffer };
}

/** The last `limit` messages of a conversation, oldest-first, excluding one id (the turn
 * about to be answered, already inserted by the time this is called). Plain {role, content}
 * — attachments on PAST turns are not replayed as images into later calls; only the images on
 * the CURRENT turn are (see sendMessage). */
async function loadHistory(conversationId, excludeId, limit = 20) {
  const { rows } = await query(
    `SELECT role, content FROM studio_messages
      WHERE conversation_id = $1 AND id <> $2
      ORDER BY created_at DESC
      LIMIT $3`,
    [conversationId, excludeId, limit]
  );
  return rows.reverse();
}

// GET /conversations — mine, newest first, capped at 100 (this is a sidebar list, not an
// archive browser).
async function listConversations(req, res) {
  const { rows } = await query(
    `SELECT id, title, model, updated_at
       FROM studio_conversations
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT 100`,
    [req.user.id]
  );
  res.json({ data: rows });
}

// POST /conversations {model?} → a new, empty conversation.
async function createConversation(req, res) {
  const model = req.body && req.body.model === 'claude' ? 'claude' : 'gpt';
  const { rows } = await query(
    `INSERT INTO studio_conversations (user_id, model) VALUES ($1, $2) RETURNING *`,
    [req.user.id, model]
  );
  res.status(201).json({ data: rows[0] });
}

// GET /conversations/:id → { conversation, messages }. Owner or admin.
async function getConversation(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return bad(res, 'المحادثة غير صحيحة');
  const conv = await loadConversation(id);
  assertAccess(conv, req.user);
  const { rows: messages } = await query(
    `SELECT id, role, content, image_urls, kind, cost_usd, created_at
       FROM studio_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC`,
    [id]
  );
  res.json({ data: { conversation: conv, messages } });
}

// PATCH /conversations/:id {title} — rename. Owner only.
async function updateConversation(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return bad(res, 'المحادثة غير صحيحة');
  const conv = await loadConversation(id);
  assertAccess(conv, req.user, { ownerOnly: true });
  const title = String((req.body && req.body.title) || '').trim().slice(0, 200);
  if (!title) return bad(res, 'العنوان مطلوب');
  const { rows } = await query(
    `UPDATE studio_conversations SET title = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, title]
  );
  res.json({ data: rows[0] });
}

// DELETE /conversations/:id — owner only. Cascades to its messages.
async function deleteConversation(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return bad(res, 'المحادثة غير صحيحة');
  const conv = await loadConversation(id);
  assertAccess(conv, req.user, { ownerOnly: true });
  await query(`DELETE FROM studio_conversations WHERE id = $1`, [id]);
  res.json({ data: { ok: true } });
}

// POST /conversations/:id/messages — multipart: text, mode ('chat'|'image'), up to 4 images.
// Owner only. Saves the user's turn FIRST (so a failed model call never loses their text or
// attachments), then calls SmartAPI, then saves the assistant's reply.
async function sendMessage(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return bad(res, 'المحادثة غير صحيحة');
  const conv = await loadConversation(id);
  assertAccess(conv, req.user, { ownerOnly: true });

  const mode = req.body && req.body.mode === 'image' ? 'image' : 'chat';
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return bad(res, 'اكتب رسالة');
  if (text.length > 4000) return bad(res, 'الرسالة طويلة جداً (الحد 4000 حرف)');

  const files = Array.isArray(req.files) ? req.files.slice(0, 4) : [];

  // Cap check before spending anything: the ledger it reads (studio_messages.cost_usd) only
  // ever grows from a call that actually happened, so checking first is what makes the cap
  // mean anything.
  const budget = await studioCaps.checkBudget(req.user.id);
  if (!budget.allowed) {
    return res.status(budget.error.status).json({ error: budget.error.message, code: budget.error.code });
  }

  const saved = [];
  for (const f of files) saved.push(await saveStudioUpload(req, f));
  const imageUrls = saved.map((s) => s.url);

  // Step 1 (tx): persist the user's turn + auto-title (first message only) + bump
  // updated_at, all before the network call — never holding a DB transaction open across the
  // SmartAPI round trip (same reserve/settle split as lib/aiChat.js).
  const { userMsg } = await tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO studio_messages (conversation_id, role, content, image_urls, kind)
       VALUES ($1, 'user', $2, $3, 'text') RETURNING *`,
      [id, text, imageUrls]
    );
    const title = conv.title || firstTitle(text);
    await client.query(
      `UPDATE studio_conversations SET title = $2, updated_at = now() WHERE id = $1`,
      [id, title]
    );
    return { userMsg: rows[0] };
  });

  let assistantRow;
  if (mode === 'image') {
    const gen = await studioAi.generateImage({ prompt: text, images: saved.map((s) => s.buffer) });
    const out = saveBufferToUploads(req, 'studio', gen.buffer, 'png');
    const { rows } = await query(
      `INSERT INTO studio_messages (conversation_id, role, content, image_urls, kind, cost_usd)
       VALUES ($1, 'assistant', '', $2, 'image', $3) RETURNING *`,
      [id, [out.url], gen.costUsd]
    );
    assistantRow = rows[0];
  } else {
    const history = await loadHistory(id, userMsg.id, 20);
    const imageDataUrls = await Promise.all(
      saved.map((s) => studioAi.toChatDataUrl(s.buffer, 1024))
    );
    const messages = buildChatMessages({ history, text, imageDataUrls });
    const result = await studioAi.chat({ uiModel: conv.model, messages, maxTokens: 4000 });
    const { rows } = await query(
      `INSERT INTO studio_messages (conversation_id, role, content, image_urls, kind, cost_usd)
       VALUES ($1, 'assistant', $2, '{}', 'text', $3) RETURNING *`,
      [id, result.text, result.costUsd]
    );
    assistantRow = rows[0];
  }
  await query(`UPDATE studio_conversations SET updated_at = now() WHERE id = $1`, [id]);

  res.json({ data: { user: userMsg, assistant: assistantRow } });
}

// GET /usage — admin only. Per-user spend over the last 30 days.
async function getUsage(req, res) {
  const { rows } = await query(
    `SELECT u.id AS user_id, u.name,
            COUNT(*) FILTER (WHERE m.role = 'assistant')::int AS messages,
            COUNT(*) FILTER (WHERE m.role = 'assistant' AND m.kind = 'image')::int AS images,
            COALESCE(SUM(m.cost_usd) FILTER (WHERE m.role = 'assistant'), 0) AS cost_usd
       FROM studio_messages m
       JOIN studio_conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = c.user_id
      WHERE m.created_at > NOW() - INTERVAL '30 days'
      GROUP BY u.id, u.name
      ORDER BY cost_usd DESC`
  );
  res.json({ data: rows.map((r) => ({ ...r, cost_usd: Number(r.cost_usd) })) });
}

module.exports = {
  listConversations, createConversation, getConversation, updateConversation,
  deleteConversation, sendMessage, getUsage,
  _internals: { saveStudioUpload, loadHistory, assertAccess, loadConversation },
};
