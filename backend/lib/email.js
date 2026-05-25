const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

async function sendPasswordReset(email, token) {
  const link = `${process.env.FRONTEND_URL}/reset-password/${token}`;
  const t = getTransporter();
  if (!t) {
    console.log(`[EMAIL DEV] reset link for ${email}: ${link}`);
    return;
  }
  await t.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'إعادة تعيين كلمة المرور - LoloShop',
    html: `<div dir="rtl" style="font-family:sans-serif">
      <h2>إعادة تعيين كلمة المرور</h2>
      <p>اضغط الرابط التالي لإعادة تعيين كلمة المرور (صالح لمدة ساعة):</p>
      <p><a href="${link}">${link}</a></p>
    </div>`,
  });
}

module.exports = { sendPasswordReset };
