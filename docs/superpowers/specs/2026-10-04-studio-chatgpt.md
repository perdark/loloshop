# «الاستوديو» — ChatGPT داخل لولو شوب (2026-10-04)

Owner: 3–4 design staff each pay for a ChatGPT subscription. Replace with one in-app tool on
SmartAPI (one bill, per-person usage visible to admin).

## Who
Same people as الخط العربي: admin · staff manager/designer/embroiderer (`mayUseTool`) · active
`design_team_members` with role `design_helper`. Reuse `allowCalligraphyUser` logic (move it to
`lib/calligraphyAccess.js` as `allowToolUser` middleware, use in both routers).

## Backend — `/api/studio`
Migration `113_studio.sql` (also appended to `db/schema.sql`, idempotent):
- `studio_conversations(id uuid pk, user_id uuid fk users, title text, model text, created_at, updated_at)`
- `studio_messages(id uuid pk, conversation_id fk cascade, role text check in ('user','assistant'),
  content text not null default '', image_urls text[] not null default '{}', kind text default 'text'
  check in ('text','image'), cost_usd numeric(10,6) default 0, created_at)`
- index on (user_id, updated_at desc), (conversation_id, created_at), (created_at) for spend.

Endpoints (all `authRequired` + `allowToolUser`, owner-only on conversation rows; admin may read any):
- `GET  /conversations` → `[{id,title,model,updated_at}]` (mine, newest 100)
- `POST /conversations` `{model?}` → conversation
- `GET  /conversations/:id` → `{conversation, messages}`
- `PATCH /conversations/:id` `{title}` · `DELETE /conversations/:id`
- `POST /conversations/:id/messages` multipart: `text`, `mode` ('chat'|'image'), up to 4 `images`
  → saves user msg (images to `/uploads/studio/`), calls SmartAPI, saves assistant msg,
  returns `{user, assistant}`. First message auto-titles (first 40 chars).
  · chat: last 20 messages as context, images as `image_url` data URLs (resize ≤1024),
    model `gpt-5.5` («GPT») or `claude-sonnet-5` («Claude») per conversation. max_tokens 4000.
  · image: SmartAPI `/responses` with `image_generation` tool (pattern of
    `smartapi.generateImageFromPrompt`; attached images → input_image for edits), save PNG to
    `/uploads/studio/`, assistant msg kind='image'.
- `GET /usage` (admin only) → per user last 30 days: name, messages, images, cost_usd.
- Caps: per user per day `STUDIO_USER_DAILY_USD` (default 2), shop `STUDIO_DAILY_USD` (default 10)
  — 429 `ERR_STUDIO_CAP` with Arabic message. Rate limit 60 req/15min/user.
- Arabic errors `{error, code}`. Cost: tokens × `SMARTAPI_USD_PER_MTOK`(0.1)/1e6.
- Zero new npm deps (CI audit gate). Tests in `backend/test/studio.test.js` (pure helpers + access).

## Frontend — `components/studio/StudioTool.tsx` + `lib/studio.ts`
Mounted at `/staff/studio`, `/design-support/studio`, `/admin/studio` (thin pages like calligraphy).
Sidebar link «الاستوديو» wherever «الخط العربي» shows; link from `/design-support` page.
- ChatGPT-like: conversation list (drawer on phone, side column ≥lg), thread, composer.
- Composer: textarea (Enter sends on desktop, Shift+Enter newline), attach image(s) with previews,
  toggle «💬 محادثة / 🎨 ولّد صورة», model pill GPT/Claude on new conversation.
- Messages: preserve newlines, `dir="auto"` per bubble, images clickable + download button,
  copy button on assistant text. Loading bubble while waiting (image can take ~60s — say so).
- Admin: «الاستهلاك» panel (GET /usage) table.
- RTL, mobile-first (iPad/phone), brand tokens, 44px tap targets, no h-scroll.
