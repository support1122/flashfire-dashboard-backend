import express from "express";
import multer from "multer";
import { google } from "googleapis";
import { GmailUser } from "../Schema_Models/GmailUser.js";

const router = express.Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/jpeg",
      "image/png",
      "image/gif"
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed. Please upload PDF, DOC, DOCX, or image files.`));
    }
  }
});

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File size exceeds 25MB limit" });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

router.get("/auth/google", (req, res) => {
  const ownerEmail = typeof req.query.email === "string" ? req.query.email : "";
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly"
    ],
    prompt: "consent",
    state: ownerEmail ? encodeURIComponent(ownerEmail) : undefined
  });
  res.redirect(url);
});

router.get("/auth/google/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send("Missing code");
  try {
    const { tokens } = await oauth2Client.getToken(code);
    const email = await getEmail(tokens.access_token);
    const ownerEmail = typeof state === "string" ? decodeURIComponent(state) : undefined;
    await GmailUser.findOneAndUpdate(
      { email },
      {
        email,
        refreshToken: tokens.refresh_token,
        ...(ownerEmail ? { ownerEmail } : {})
      },
      { upsert: true, new: true }
    );
    res.send(`✅ ${email} connected. You can close this tab.`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Google OAuth error");
  }
});

router.post("/status", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ connected: false, error: "Email is required" });
    }
    const existing = await GmailUser.exists({ ownerEmail: email.toLowerCase() });
    return res.json({ connected: !!existing });
  } catch (error) {
    console.error("Gmail status error:", error);
    return res.status(500).json({ connected: false, error: "Failed to check Gmail status" });
  }
});

router.post("/accounts", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    const users = await GmailUser.find({ ownerEmail: email.toLowerCase() })
      .select("email createdAt")
      .sort({ createdAt: -1 });
    return res.json({ accounts: users });
  } catch (error) {
    console.error("Gmail accounts error:", error);
    return res.status(500).json({ error: "Failed to load Gmail accounts" });
  }
});

router.post("/send", upload.single("attachment"), handleMulterError, async (req, res) => {
  try {
    const { ownerEmail, to, subject, text } = req.body || {};

    if (!ownerEmail || !to || !subject || !text) {
      return res.status(400).json({ error: "ownerEmail, to, subject, text required" });
    }

    const rawRecipients = String(to)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (!rawRecipients.length) {
      return res.status(400).json({ error: "At least one recipient email is required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const r of rawRecipients) {
      if (!emailRegex.test(r)) {
        return res.status(400).json({ error: `Invalid recipient email: ${r}` });
      }
    }

    const attachment = req.file
      ? {
          filename: req.file.originalname,
          content: req.file.buffer,
          mimetype: req.file.mimetype
        }
      : null;

    let fromEmails = req.body.fromEmails;
    if (fromEmails && !Array.isArray(fromEmails)) {
      fromEmails = [fromEmails];
    }

    let users;
    if (fromEmails && fromEmails.length > 0) {
      users = await GmailUser.find({
        ownerEmail: ownerEmail.toLowerCase(),
        email: { $in: fromEmails }
      });
    } else {
      users = await GmailUser.find({ ownerEmail: ownerEmail.toLowerCase() });
    }

    if (!users.length) {
      return res.status(404).json({ error: "No connected Gmail accounts for this user" });
    }

    const toHeader = rawRecipients.join(", ");
    const results = [];

    for (const u of users) {
      try {
        await sendGmail(u, { to: toHeader, subject, text, attachment });
        results.push({ email: u.email, status: "sent" });
      } catch (e) {
        console.error(`Error sending from ${u.email}:`, e.message);
        results.push({ email: u.email, status: "error", error: e.message });
      }
    }

    return res.json({
      results,
      total: results.length,
      sent: results.filter((r) => r.status === "sent").length,
      attachment: attachment ? attachment.filename : null
    });
  } catch (error) {
    console.error("Send email error:", error);
    return res.status(500).json({ error: error.message || "Failed to send emails" });
  }
});

async function getEmail(accessToken) {
  const tmpAuth = new google.auth.OAuth2();
  tmpAuth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: tmpAuth });
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress;
}

function encodeFilename(filename) {
  if (/[^\x00-\x7F]/.test(filename)) {
    return `=?UTF-8?B?${Buffer.from(filename).toString("base64")}?=`;
  }
  if (/[()<>@,;:\\"\/\[\]?=]/.test(filename)) {
    return `"${filename.replace(/"/g, '\\"')}"`;
  }
  return filename;
}

function createMimeMessage(from, to, subject, text, attachment = null) {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const lines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`
  ];

  if (attachment) {
    const encodedFilename = encodeFilename(attachment.filename);
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit");
    lines.push("");
    lines.push(text);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${attachment.mimetype}; name=${encodedFilename}`);
    lines.push(`Content-Disposition: attachment; filename=${encodedFilename}`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    const base64Content = attachment.content.toString("base64");
    for (let i = 0; i < base64Content.length; i += 76) {
      lines.push(base64Content.substr(i, 76));
    }
    lines.push("");
    lines.push(`--${boundary}--`);
  } else {
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit");
    lines.push("");
    lines.push(text);
  }

  return lines.join("\r\n");
}

async function sendGmail(user, { to, subject, text, attachment = null }) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  client.setCredentials({ refresh_token: user.refreshToken });
  const gmail = google.gmail({ version: "v1", auth: client });

  const mimeMessage = createMimeMessage(user.email, to, subject, text, attachment);
  const raw = Buffer.from(mimeMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw }
  });
}

export default router;

