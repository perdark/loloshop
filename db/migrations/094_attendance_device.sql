-- Migration 094: جهاز البصمة (ZKTeco K40 Pro) عبر ADMS.
--
-- الجهاز يتصل بالخادم من جهته (ADMS push)، فما نحتاج فتح منفذ براوتر المحل
-- ولا IP ثابت ولا حاسبة شغّالة بالمحل.
--
-- ⚠️ punch_raw سجل الحقيقة: يُضاف فقط وما ينكتب فوكه أبداً. الاشتقاق
--    (lib/attendanceDevice.js) دالة يُعاد تشغيلها، فتصليح القاعدة يصلّح
--    التاريخ كله. هذا الدرس مأخوذ من grandlayan/027.
--
-- ⚠️ بخلاف grandlayan، جدول الحضور عدنا (staff_attendance_records) **مو**
--    ذاكرة مؤقتة: بي late_minutes مجمّدة وقت الكتابة، وارتباط الاستراحات
--    (staff_attendance_breaks.attendance_id)، وتعديلات المديرين. فالاشتقاق
--    يعمل UPSERT ولا مرة DELETE، وما يلمس صفاً status='overridden'.
CREATE TABLE IF NOT EXISTS attendance_devices (
  serial_number   TEXT PRIMARY KEY,
  label_ar        TEXT NOT NULL DEFAULT 'جهاز البصمة',
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at    TIMESTAMPTZ,
  last_ip         TEXT,
  firmware_note   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS punch_raw (
  id            BIGSERIAL PRIMARY KEY,
  device_sn     TEXT NOT NULL,
  -- رقم التسجيل داخل الجهاز، نص كما وصل. مو user_id: الربط وقت الاشتقاق،
  -- فنبضة موظف مو مربوط تنخزن بدل ما تنرفض وتضيع.
  device_pin    TEXT NOT NULL,
  -- ساعة الجهاز نفسه بلا منطقة زمنية — هي وقت المحل اللي يشوفه الموظف.
  device_ts     TIMESTAMP NOT NULL,
  -- نفس اللحظة محسوبة بـAsia/Baghdad. الاشتقاق يشتغل على هذا العمود.
  punched_at    TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_status    SMALLINT,
  raw_verify    SMALLINT,
  raw_line      TEXT,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  attendance_id UUID REFERENCES staff_attendance_records(id) ON DELETE SET NULL,
  ignored_reason TEXT
);

-- المفتاح الوحيد اللي يخلي الاستقبال idempotent. الجهاز **يعيد الإرسال**:
-- إذا انقطع الإنترنت يخزن داخلياً ويكب كل شي مرة وحدة لمّا يرجع.
-- ⚠️ `nulls not distinct` ضرورية: raw_status يجي NULL من بعض الإصدارات،
--    وبالسلوك الافتراضي كل NULL «مميّزة» فنفس النبضة تعدّي مرتين.
CREATE UNIQUE INDEX IF NOT EXISTS punch_raw_dedupe_ux
  ON punch_raw (device_sn, device_pin, device_ts, raw_status) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS punch_raw_pin_ts_ix ON punch_raw (device_pin, device_ts);
CREATE INDEX IF NOT EXISTS punch_raw_unmapped_ix
  ON punch_raw (device_sn, device_pin) WHERE user_id IS NULL;

-- الجهاز يعيد إرسال الدفعة للأبد لحد ما تاخذ 200. لو رفضنا الدفعة كاملة
-- بسبب صف واحد خربان، كل النبضات وراه تتجمّد بصمت. فالصف الخربان ينعزل هنا.
CREATE TABLE IF NOT EXISTS punch_reject (
  id         BIGSERIAL PRIMARY KEY,
  device_sn  TEXT,
  raw_line   TEXT,
  reason     TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS punch_reject_at_ix ON punch_reject (at DESC);

-- الربط: رقم الجهاز ← موظف. نحن اللي نوزّع الأرقام وندزّها للجهاز (§4).
CREATE TABLE IF NOT EXISTS staff_device_pins (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin         INTEGER NOT NULL UNIQUE CHECK (pin BETWEEN 1 AND 65534),
  pushed_name TEXT,
  push_state  TEXT NOT NULL DEFAULT 'pending'
                CHECK (push_state IN ('pending', 'sent', 'confirmed', 'failed')),
  enrolled_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- طابور الأوامر نحو الجهاز — يسحبها بـGET /iclock/getrequest.
CREATE TABLE IF NOT EXISTS device_commands (
  id          BIGSERIAL PRIMARY KEY,
  device_sn   TEXT NOT NULL,
  body        TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'queued'
                CHECK (state IN ('queued', 'sent', 'done', 'failed')),
  result_code TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at     TIMESTAMPTZ,
  done_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS device_commands_queue_ix
  ON device_commands (device_sn, id) WHERE state = 'queued';
