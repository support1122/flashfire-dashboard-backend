import express from "express";
import multer from "multer";
import { google } from "googleapis";
import { GmailUser } from "../Schema_Models/GmailUser.js";
import { RecruiterEmailGroup } from "../Schema_Models/RecruiterEmailGroup.js";
import { RecruiterEmailTemplate } from "../Schema_Models/RecruiterEmailTemplate.js";
import { RecruiterEmailAutomation } from "../Schema_Models/RecruiterEmailAutomation.js";
import { GmailSendLog } from "../Schema_Models/GmailSendLog.js";

const router = express.Router();

function normalizeEmailSubject(subject) {
  if (typeof subject !== "string") return "";
  let s = subject.trim();
  if (!s) return "";
  if (/Ã/.test(s)) {
    try {
      const decoded = Buffer.from(s, "latin1").toString("utf8");
      if (!/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(decoded)) s = decoded;
    } catch (_) {}
  }
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}

/**
 * Encode a header value for MIME (RFC 2047) so non-ASCII characters (e.g. em dash "—")
 * display correctly instead of mojibake like "Ã¢Â€Â"".
 * Uses =?UTF-8?B?base64?= and splits into chunks of max 75 chars per encoded-word.
 */
function encodeRfc2047Header(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  const isAscii = /^[\x00-\x7F]*$/.test(value);
  if (isAscii) return value;
  const utf8 = Buffer.from(value, "utf8");
  const maxBytesPerWord = 57;
  const parts = [];
  for (let i = 0; i < utf8.length; i += maxBytesPerWord) {
    const chunk = utf8.subarray(i, i + maxBytesPerWord);
    parts.push(`=?UTF-8?B?${chunk.toString("base64")}?=`);
  }
  return parts.join("\r\n ");
}

async function createSendLog({ ownerEmail, fromEmail, toEmail, subject, status, errorMessage = null, source = "manual" }) {
  try {
    await GmailSendLog.create({
      ownerEmail: ownerEmail.toLowerCase(),
      fromEmail,
      toEmail,
      subject,
      status,
      errorMessage,
      source
    });
  } catch (e) {
    console.error("Failed to write GmailSendLog:", e?.message);
  }
}

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

    const normalizedSubject = normalizeEmailSubject(subject);

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

    const results = [];

    for (const u of users) {
      const perUserErrors = [];

      for (const recipient of rawRecipients) {
        try {
          await sendGmail(u, { to: recipient, subject: normalizedSubject, text, attachment });
          await createSendLog({
            ownerEmail,
            fromEmail: u.email,
            toEmail: recipient,
            subject: normalizedSubject,
            status: "success",
            source: "manual"
          });
        } catch (e) {
          const message = e?.message || "Unknown error";
          console.error(`Error sending from ${u.email} to ${recipient}:`, message);
          perUserErrors.push({ recipient, error: message });
          await createSendLog({
            ownerEmail,
            fromEmail: u.email,
            toEmail: recipient,
            subject: normalizedSubject,
            status: "failed",
            errorMessage: message,
            source: "manual"
          });
        }
      }

      if (perUserErrors.length === 0) {
        results.push({ email: u.email, status: "sent" });
      } else {
        results.push({
          email: u.email,
          status: "error",
          error: `Failed for ${perUserErrors.length} recipient(s): ${perUserErrors
            .map((e) => `${e.recipient} (${e.error})`)
            .join("; ")}`
        });
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

router.post("/logs", async (req, res) => {
  try {
    const { ownerEmail } = req.body || {};
    if (!ownerEmail || !String(ownerEmail).trim()) {
      return res.status(400).json({ error: "ownerEmail is required" });
    }
    const page = Math.max(1, parseInt(req.body.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.body.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const total = await GmailSendLog.countDocuments({ ownerEmail: ownerEmail.toLowerCase().trim() });
    const logs = await GmailSendLog.find({ ownerEmail: ownerEmail.toLowerCase().trim() })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    const totalPages = Math.ceil(total / limit) || 1;
    res.json({
      logs: logs.map((l) => ({
        id: String(l._id),
        fromEmail: l.fromEmail,
        toEmail: l.toEmail,
        subject: l.subject,
        status: l.status,
        errorMessage: l.errorMessage || null,
        source: l.source,
        sentAt: l.createdAt
      })),
      total,
      page,
      limit,
      totalPages
    });
  } catch (error) {
    console.error("Gmail logs error:", error);
    res.status(500).json({ error: "Failed to load logs" });
  }
});

router.get("/templates", async (req, res) => {
  try {
    const templates = await RecruiterEmailTemplate.find({})
      .sort({ createdAt: -1 })
      .select("name subject createdAt updatedAt")
      .lean();
    const result = templates.map((t) => ({
      id: String(t._id),
      name: t.name,
      subject: t.subject,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }));
    res.json({ templates: result });
  } catch (error) {
    res.status(500).json({ error: "Failed to load templates" });
  }
});

router.get("/templates/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const template = await RecruiterEmailTemplate.findById(id).lean();
    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }
    res.json({
      id: String(template._id),
      name: template.name,
      subject: template.subject,
      text: template.text,
      attachmentFilename: template.attachment?.filename || null
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load template" });
  }
});

router.post("/templates", upload.single("attachment"), handleMulterError, async (req, res) => {
  try {
    const { name, subject, text, ownerEmail } = req.body || {};
    if (!name || !name.trim() || !subject || !subject.trim() || !text || !text.trim()) {
      return res.status(400).json({ error: "Name, subject and text are required" });
    }
    let attachment = null;
    if (req.file) {
      attachment = {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        content: req.file.buffer
      };
    }
    const template = await RecruiterEmailTemplate.create({
      name: name.trim(),
      subject: subject.trim(),
      text: text.trim(),
      attachment,
      createdBy: ownerEmail || ""
    });
    res.status(201).json({
      id: String(template._id),
      name: template.name,
      subject: template.subject
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to create template" });
  }
});

router.put("/templates/:id", upload.single("attachment"), handleMulterError, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, subject, text } = req.body || {};
    const template = await RecruiterEmailTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }
    if (name && name.trim()) template.name = name.trim();
    if (subject && subject.trim()) template.subject = subject.trim();
    if (text !== undefined) template.text = String(text).trim();
    if (req.file) {
      template.attachment = {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        content: req.file.buffer
      };
    }
    await template.save();
    res.json({
      id: String(template._id),
      name: template.name,
      subject: template.subject
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update template" });
  }
});

router.post("/automation/config/get", async (req, res) => {
  try {
    const { ownerEmail } = req.body || {};
    if (!ownerEmail || !ownerEmail.trim()) {
      return res.status(400).json({ error: "ownerEmail is required" });
    }
    const doc = await RecruiterEmailAutomation.findOne({
      ownerEmail: ownerEmail.toLowerCase().trim()
    })
      .populate("group")
      .populate("template");
    if (!doc) {
      return res.json({ config: null });
    }
    res.json({
      config: {
        id: String(doc._id),
        ownerEmail: doc.ownerEmail,
        groupId: doc.group ? String(doc.group._id) : null,
        groupName: doc.group ? doc.group.name : null,
        templateId: doc.template ? String(doc.template._id) : null,
        templateName: doc.template ? doc.template.name : null,
        dailyLimit: doc.dailyLimit,
        enabled: doc.enabled
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load automation config" });
  }
});

router.patch("/automation/config", async (req, res) => {
  try {
    const { ownerEmail, enabled } = req.body || {};
    if (!ownerEmail || !ownerEmail.trim()) {
      return res.status(400).json({ error: "ownerEmail is required" });
    }
    const doc = await RecruiterEmailAutomation.findOneAndUpdate(
      { ownerEmail: ownerEmail.toLowerCase().trim() },
      { $set: { enabled: !!enabled } },
      { new: true }
    );
    if (!doc) {
      return res.status(404).json({ error: "No automation config found. Save group, template and limit first." });
    }
    res.json({
      config: {
        id: String(doc._id),
        enabled: doc.enabled
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update automation status" });
  }
});

router.post("/automation/config", async (req, res) => {
  try {
    const { ownerEmail, groupId, templateId, dailyLimit, enabled } = req.body || {};
    if (!ownerEmail || !ownerEmail.trim()) {
      return res.status(400).json({ error: "ownerEmail is required" });
    }
    if (!groupId || !templateId) {
      return res.status(400).json({ error: "groupId and templateId are required" });
    }
    const limitNumber = Number(dailyLimit || 0);
    if (!Number.isFinite(limitNumber) || limitNumber <= 0) {
      return res.status(400).json({ error: "dailyLimit must be greater than zero" });
    }
    const groupExists = await RecruiterEmailGroup.exists({ _id: groupId });
    if (!groupExists) {
      return res.status(400).json({ error: "Invalid groupId" });
    }
    const templateExists = await RecruiterEmailTemplate.exists({ _id: templateId });
    if (!templateExists) {
      return res.status(400).json({ error: "Invalid templateId" });
    }
    const doc = await RecruiterEmailAutomation.findOneAndUpdate(
      { ownerEmail: ownerEmail.toLowerCase().trim() },
      {
        ownerEmail: ownerEmail.toLowerCase().trim(),
        group: groupId,
        template: templateId,
        dailyLimit: limitNumber,
        enabled: !!enabled
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({
      config: {
        id: String(doc._id),
        ownerEmail: doc.ownerEmail,
        groupId: String(doc.group),
        templateId: String(doc.template),
        dailyLimit: doc.dailyLimit,
        enabled: doc.enabled
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to save automation config" });
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
  const encodedSubject = encodeRfc2047Header(subject);

  const lines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${encodedSubject}`,
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

export async function runRecruiterAutomationDailyJob() {
  const automations = await RecruiterEmailAutomation.find({
    enabled: true,
    dailyLimit: { $gt: 0 }
  })
    .populate("group")
    .populate("template");

  for (const automation of automations) {
    if (!automation.group || !automation.template) {
      continue;
    }
    const allEmails = Array.isArray(automation.group.emails) ? automation.group.emails : [];
    if (!allEmails.length) {
      continue;
    }
    const normalizedAll = Array.from(
      new Set(
        allEmails
          .map((v) => v && v.toString().trim().toLowerCase())
          .filter((v) => v)
      )
    );
    if (!normalizedAll.length) {
      continue;
    }
    const alreadySentSet = new Set(
      (automation.sentTo || [])
        .map((v) => v && v.toString().trim().toLowerCase())
        .filter((v) => v)
    );
    let pool = normalizedAll.filter((email) => !alreadySentSet.has(email));
    let resetHistory = false;
    if (pool.length < automation.dailyLimit) {
      pool = normalizedAll;
      resetHistory = true;
    }
    const limit = Math.min(automation.dailyLimit, pool.length);
    const selected = [];
    const poolCopy = [...pool];
    while (selected.length < limit && poolCopy.length > 0) {
      const index = Math.floor(Math.random() * poolCopy.length);
      selected.push(poolCopy[index]);
      poolCopy.splice(index, 1);
    }
    if (!selected.length) {
      continue;
    }
    const gmailUsers = await GmailUser.find({
      ownerEmail: automation.ownerEmail.toLowerCase()
    });
    if (!gmailUsers.length) {
      continue;
    }
    let attachment = null;
    if (automation.template.attachment && automation.template.attachment.content) {
      const bufferContent = Buffer.isBuffer(automation.template.attachment.content)
        ? automation.template.attachment.content
        : Buffer.from(
            automation.template.attachment.content.buffer || automation.template.attachment.content
          );
      attachment = {
        filename: automation.template.attachment.filename,
        mimetype: automation.template.attachment.mimetype,
        content: bufferContent
      };
    }
    const automationSubject = normalizeEmailSubject(automation.template.subject);
    for (const user of gmailUsers) {
      for (const recipient of selected) {
        try {
          await sendGmail(user, {
            to: recipient,
            subject: automationSubject,
            text: automation.template.text,
            attachment
          });
          await createSendLog({
            ownerEmail: automation.ownerEmail,
            fromEmail: user.email,
            toEmail: recipient,
            subject: automationSubject,
            status: "success",
            source: "automation"
          });
        } catch (error) {
          const message = error && error.message ? error.message : "Unknown error";
          console.error(`Automation email error from ${user.email} to ${recipient}: ${message}`);
          await createSendLog({
            ownerEmail: automation.ownerEmail,
            fromEmail: user.email,
            toEmail: recipient,
            subject: automationSubject,
            status: "failed",
            errorMessage: message,
            source: "automation"
          });
        }
      }
    }
    const newHistory = resetHistory ? selected : Array.from(new Set([...alreadySentSet, ...selected]));
    automation.sentTo = newHistory;
    automation.lastRunAt = new Date();
    await automation.save();
  }
}

export default router;

