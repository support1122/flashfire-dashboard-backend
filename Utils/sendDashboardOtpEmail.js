import sgMail from "@sendgrid/mail";

const SENDGRID_API_KEY =
  process.env.SENDGRID_API_KEY_1 || process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || "noreply@flashfirehq.com";
const FROM_NAME = process.env.SENDGRID_FROM_NAME || "FlashFire Dashboard";

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

export async function sendDashboardOtpEmail(toEmail, otp, name) {
  if (!SENDGRID_API_KEY) {
    console.log(`[Dashboard OTP] ${toEmail} -> ${otp} (SendGrid not configured)`);
    return;
  }

  const displayName = name || toEmail.split("@")[0] || "User";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;">
  <div style="max-width:480px;margin:0 auto;padding:24px;">
    <div style="background:#1f2937;border-radius:12px 12px 0 0;padding:20px 24px;">
      <div style="color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">FLASHFIRE DASHBOARD</div>
      <div style="color:#fff;font-size:20px;font-weight:700;margin-top:4px;">One-time login code</div>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
      <p style="margin:0 0 16px;color:#374151;font-size:16px;">Hi ${displayName},</p>
      <p style="margin:0 0 20px;color:#374151;font-size:16px;">Use this OTP to log in. It expires in <strong>5 minutes</strong>.</p>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px 24px;text-align:center;margin-bottom:20px;">
        <span style="font-size:28px;font-weight:700;color:#ea580c;letter-spacing:4px;">${otp}</span>
      </div>
      <p style="margin:0;color:#6b7280;font-size:14px;">If you didn't request this code, ignore this email.</p>
    </div>
    <div style="text-align:center;padding:16px 0;">
      <span style="color:#9ca3af;font-size:12px;">© 2026 FlashFire</span>
    </div>
  </div>
</body>
</html>
`;

  const msg = {
    to: toEmail,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: "Your FlashFire Dashboard login code",
    html,
  };

  await sgMail.send(msg);
}
