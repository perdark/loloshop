-- 098 — اربط أمر الجهاز برقم الموظف، حتى نعرف هل وصل الاسم فعلاً.
--
-- المشكلة: staff_device_pins.push_state ينكتب 'pending' وقت الربط وما يتغيّر أبداً.
-- جدول device_commands عنده دورة حياة كاملة (queued → sent → done/failed) بس ما بيها
-- أي إشارة لأي PIN يخص الأمر، فما كان بالإمكان نرجّع النتيجة للموظف. النتيجة: الشارة
-- الصفراء «بانتظار الإرسال» تظل صفراء للأبد حتى بعد ما الجهاز يستلم الاسم — وهذا خلّى
-- الشاشة تكذب باتجاهين: ما تكدر تقول «وصل»، وما تكدر تقول «فشل».
--
-- ⚠️ nullable عمداً: الأوامر القديمة (وأي أمر مو USERINFO، مثل DATA DELETE) ما إلها PIN،
--    وحذف السطر القديم يعني حذف سجل شنو انرسل للجهاز.
ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS pin INTEGER;

-- نلاحق آخر أمر لكل PIN بسرعة وقت الاستلام (getrequest / devicecmd).
CREATE INDEX IF NOT EXISTS device_commands_pin_ix
  ON device_commands (pin) WHERE pin IS NOT NULL;
