// backend/lib/calligraphyProvider.js — which company draws the calligraphy and reads the orders.
//
// Owner, 2026-09-26: «I want it all on smartapi». So SmartAPI is the PRIMARY for all three
// calligraphy jobs — understanding the student's words, reading their photo, drawing the plate —
// and OpenRouter is the automatic FALLBACK, because SmartAPI was measured rate-limiting at ~5
// concurrent requests and going `upstream_unavailable` mid-session. A shop that stops drawing
// every time a reseller hiccups is worse than one that pays OpenRouter prices for that hour.
//
//   CALLIG_PROVIDER = smartapi (default) | openrouter   — who goes first
//   CALLIG_FALLBACK = none (default) | openrouter       — who catches a SmartAPI failure
//
// Owner, 2026-09-29: «smartapi وبس». The fallback is now OFF unless explicitly set, so a
// SmartAPI outage leaves plates PENDING (the outage codes in lib/smartapi.js) instead of quietly
// spending OpenRouter credit. `CALLIG_FALLBACK=openrouter` in .env brings the old safety net back.
//
// Every caller gets `{ …, provider }` back so the spend ledger and the logs say who was paid.
// The storefront assistant («لولو», lib/aiChat.js) is NOT routed here and stays on OpenRouter.
const smartapi = require('./smartapi');
const openrouter = require('./openrouter');
const { complete: openrouterComplete } = require('./aiChat');
const { buildSmartApiPrompt, buildSmartApiOrnamentPrompt, buildSinglePrompt, buildReferencePrompt } = require('./calligraphyPrompt');
const { cropSheet } = require('./sheetCrop');

const promptVariant = (v) => (v === 'cap_side' ? 'cap' : v);

function primary() {
  return process.env.CALLIG_PROVIDER === 'openrouter' ? 'openrouter' : 'smartapi';
}
function fallbackAllowed() {
  return process.env.CALLIG_FALLBACK === 'openrouter';
}
/** One sheet of several names only exists on OpenRouter; SmartAPI draws every name alone. */
function drawsSolo() {
  return primary() === 'smartapi';
}

async function withFallback(label, first, second) {
  try {
    return await first();
  } catch (err) {
    if (!second || !fallbackAllowed()) throw err;
    console.warn(`calligraphy ${label}: SmartAPI failed (${err.code || err.message}) — falling back to OpenRouter`);
    return second();
  }
}

/** Text model for the understanding layer and the photo reader. Same contract as aiChat.complete. */
async function completeText(opts) {
  if (primary() === 'openrouter') return { ...(await openrouterComplete(opts)), provider: 'openrouter' };
  return withFallback('text',
    async () => ({ ...(await smartapi.chat(opts)), provider: 'smartapi' }),
    async () => ({ ...(await openrouterComplete(opts)), provider: 'openrouter' }));
}

async function openrouterPlate({ text, variant, ornament, element, style, reference, model }) {
  const v = promptVariant(variant);
  const gen = reference
    ? await openrouter.generateImageWithReference({ model, prompt: buildReferencePrompt(text, v, element, ornament), reference, resolution: '1K', aspectRatio: '1:1' })
    : await openrouter.generateImage({ model, prompt: buildSinglePrompt(text, v, element, style, ornament), resolution: '1K', aspectRatio: '1:1' });
  let buffer = gen.buffer;
  try { const { plates } = await cropSheet(gen.buffer, 1); if (plates[0]) buffer = plates[0]; } catch { /* keep full */ }
  return { buffer, cost: gen.cost, provider: 'openrouter' };
}

/**
 * ONE plate for ONE name. `reference` is the student's own photo (a Buffer) when they asked for
 * it, else null. Returns `{ buffer, cost, provider }`.
 */
async function generatePlate({ text, variant = 'front', ornament = null, element = null, style = null, reference = null, model = openrouter.MODELS.standard }) {
  const args = { text, variant, ornament, element, style, reference, model };
  if (primary() === 'openrouter') return openrouterPlate(args);
  return withFallback('plate',
    async () => {
      const gen = await smartapi.generatePlate({
        text,
        prompt: buildSmartApiPrompt({ style, studentReference: !!reference }),
        ornamentPrompt: buildSmartApiOrnamentPrompt({ variant: promptVariant(variant), ornament, element, shopRefs: !reference }),
        styleReference: reference,
      });
      return { ...gen, provider: 'smartapi' };
    },
    () => openrouterPlate(args));
}

/** A motif image from a prompt (the workbench's «element» tool). */
async function generateElement({ prompt, model = openrouter.MODELS.standard }) {
  const viaOpenRouter = async () => ({ ...(await openrouter.generateImage({ model, prompt, resolution: '1K', aspectRatio: '1:1' })), provider: 'openrouter' });
  if (primary() === 'openrouter') return viaOpenRouter();
  return withFallback('element', async () => ({ ...(await smartapi.generateImageFromPrompt({ prompt })), provider: 'smartapi' }), viaOpenRouter);
}

module.exports = { primary, drawsSolo, completeText, generatePlate, generateElement };
