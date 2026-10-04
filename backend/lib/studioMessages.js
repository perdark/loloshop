// backend/lib/studioMessages.js — pure helpers for shaping an الاستوديو chat call.
// Split out from the controller so the conversation-history/content-parts shape is testable
// without a database or a network call (test/studio.test.js).

const SYSTEM_PROMPT = [
  'أنت مساعد ذكي داخل «الاستوديو» لفريق التصميم في لولو شوب (أوشحة وروبات تخرج، خط عربي، تطريز).',
  'جاوب بلغة ولهجة المستخدم نفسها، بأسلوب بسيط ومباشر ومفيد. لا تخترع معلومات عن المحل أو الطلبات.',
].join('\n');

/** First-message auto-title: trimmed, collapsed whitespace, first 40 chars. */
function firstTitle(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  return t.slice(0, 40) || null;
}

/**
 * Build the [{role, content}] array for one chat call: system prompt, the conversation's own
 * last-N turns (plain text), then the new user turn — as a plain string when it carries no
 * images, or an OpenAI-style content-part array (text + image_url parts) when it does.
 *
 * `history` is oldest-first [{role, content}]. `imageDataUrls` are already-resized data: URLs
 * for the images attached to THIS message (lib/studioAi.toChatDataUrl).
 */
function buildChatMessages({ history = [], text, imageDataUrls = [] }) {
  const userContent = imageDataUrls.length
    ? [
      { type: 'text', text: String(text || '') },
      ...imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
    ]
    : String(text || '');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userContent },
  ];
}

module.exports = { SYSTEM_PROMPT, firstTitle, buildChatMessages };
