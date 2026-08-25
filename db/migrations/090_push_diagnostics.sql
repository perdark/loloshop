-- Migration 090 — why does iOS register no push tokens?
--
-- On 2026-08-26 prod held **145 Android device tokens and 0 iOS**, while `app_opens` showed 22
-- signed-in iOS users opening the app the previous day. Everything checkable from the repo was
-- ruled out (entitlement, plugin, client path, APNs key, platform detection), and the two
-- surviving explanations cannot be told apart from any data the system currently keeps:
--
--   A. those iPhones are still on 1.0.3, which has no `aps-environment` and therefore CANNOT
--      register — the beacon reports the PLATFORM, never the app version, so a pre-push build
--      is indistinguishable from a current one;
--   B. registration is reaching Apple and failing — a provisioning profile without the push
--      capability signs a build whose entitlements file is perfect and whose runtime
--      `register()` still errors, silently, with a green build and a passed review.
--
-- Each column below kills one of those.
--
-- ⚠️ NEITHER IS TELEMETRY FOR ITS OWN SAKE, and neither should outlive the question. When iOS
-- tokens appear, `push_register_errors` stops receiving rows on its own; revisit whether it is
-- still worth keeping rather than letting it grow forever.

-- (A) Which build is actually running. NULL for web sessions and for any client older than this
-- deploy — an old shell simply does not send it, which is itself the answer for those rows.
ALTER TABLE app_opens ADD COLUMN IF NOT EXISTS app_version TEXT;

-- (B) The reason a device gave for refusing to register.
--
-- ⚠️ THIS EXISTS BECAUSE THE REASON CURRENTLY DIES IN A CONSOLE NOBODY CAN READ.
-- PushRegistrar's `registrationError` listener console.warn()s and stops, which is invisible on
-- a student's phone in Baghdad. iOS says exactly why it refused; capturing it server-side turns
-- a session of theorising into one row.
CREATE TABLE IF NOT EXISTS push_register_errors (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  platform    TEXT,
  app_version TEXT,
  -- Whatever the OS handed the plugin. Capped by the controller, not here, so a runaway client
  -- cannot fill the table with one enormous string.
  message     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_register_errors_at ON push_register_errors(created_at DESC);
