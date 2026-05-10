import express from "express";
import multer from "multer";
import { google } from "googleapis";
import { GmailUser } from "../Schema_Models/GmailUser.js";
import { InboxThread } from "../Schema_Models/InboxThread.js";
import { InboxMessage } from "../Schema_Models/InboxMessage.js";
import { uploadFile } from "../Utils/storageService.js";
import { getPresignedUrl } from "../Utils/r2Storage.js";

const router = express.Router();

const composeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 }
});

function encodeRfc2047(value) {
  if (typeof value !== "string" || /^[\x00-\x7F]*$/.test(value)) return value;
  const utf8 = Buffer.from(value, "utf8");
  const out = [];
  for (let i = 0; i < utf8.length; i += 57) {
    out.push(`=?UTF-8?B?${utf8.subarray(i, i + 57).toString("base64")}?=`);
  }
  return out.join("\r\n ");
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

function buildComposeMime({ from, to, cc, bcc, subject, html, text, attachments, inReplyTo, references }) {
  const mixedBoundary = `=_FFmix_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const altBoundary = `=_FFalt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeRfc2047(subject)}`,
    "MIME-Version: 1.0"
  ];
  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);

  const altPart = (() => {
    const p = [];
    p.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    p.push("");
    if (text) {
      p.push(`--${altBoundary}`);
      p.push("Content-Type: text/plain; charset=UTF-8");
      p.push("Content-Transfer-Encoding: 7bit");
      p.push("");
      p.push(text);
      p.push("");
    }
    if (html) {
      p.push(`--${altBoundary}`);
      p.push("Content-Type: text/html; charset=UTF-8");
      p.push("Content-Transfer-Encoding: 7bit");
      p.push("");
      p.push(html);
      p.push("");
    }
    p.push(`--${altBoundary}--`);
    return p.join("\r\n");
  })();

  if (attachments && attachments.length) {
    headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    const lines = [headers.join("\r\n"), "", `--${mixedBoundary}`, altPart];
    for (const att of attachments) {
      const fname = encodeFilename(att.filename || "attachment");
      lines.push(`--${mixedBoundary}`);
      lines.push(`Content-Type: ${att.mimetype || "application/octet-stream"}; name=${fname}`);
      lines.push(`Content-Disposition: attachment; filename=${fname}`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      const b64 = att.content.toString("base64");
      for (let i = 0; i < b64.length; i += 76) lines.push(b64.substr(i, 76));
      lines.push("");
    }
    lines.push(`--${mixedBoundary}--`);
    return lines.join("\r\n");
  }

  return headers.join("\r\n") + "\r\n" + altPart;
}

// =========================
// Auth helpers
// =========================
function gmailClientForUser(user) {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth.setCredentials({ refresh_token: user.refreshToken });
  return google.gmail({ version: "v1", auth: oauth });
}

async function resolveGmailUser(ownerEmail, gmailEmail) {
  const owner = (ownerEmail || "").toLowerCase().trim();
  if (!owner) return null;
  if (gmailEmail) {
    return GmailUser.findOne({
      ownerEmail: owner,
      email: gmailEmail.toLowerCase().trim()
    });
  }
  return GmailUser.findOne({ ownerEmail: owner }).sort({ createdAt: -1 });
}

// =========================
// Body / header parsing
// =========================
function decodeBase64Url(b64) {
  if (!b64) return Buffer.alloc(0);
  const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? "" : "=".repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, "base64");
}

function pickHeader(headers, name) {
  if (!Array.isArray(headers)) return "";
  const lc = name.toLowerCase();
  const h = headers.find((x) => (x.name || "").toLowerCase() === lc);
  return h ? String(h.value || "") : "";
}

function splitAddresses(value) {
  if (!value) return [];
  // Naive split — Gmail comma-separates address lists, commas inside quoted display names need handling.
  const out = [];
  let buf = "";
  let depth = 0;
  let inQ = false;
  for (const ch of value) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && (ch === "(" || ch === "<")) depth++;
    else if (!inQ && (ch === ")" || ch === ">")) depth--;
    if (!inQ && depth === 0 && ch === ",") {
      out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function walkParts(payload, accumulator) {
  if (!payload) return;
  const mime = (payload.mimeType || "").toLowerCase();
  const filename = payload.filename || "";
  const body = payload.body || {};
  const parts = payload.parts || [];

  if (filename && body.attachmentId) {
    // Named file attachment
    accumulator.attachments.push({
      attachmentId: body.attachmentId,
      filename,
      mimetype: payload.mimeType || "application/octet-stream",
      size: Number(body.size || 0)
    });
  } else if (!filename && body.attachmentId) {
    // Gmail stores large body parts (> ~2 MB) as anonymous attachments.
    // body.data is absent; we must fetch via messages.attachments.get.
    accumulator.inlineBodyParts.push({
      attachmentId: body.attachmentId,
      mimeType: mime,
      size: Number(body.size || 0)
    });
  } else if (mime === "text/plain" && body.data) {
    accumulator.text += decodeBase64Url(body.data).toString("utf8");
  } else if (mime === "text/html" && body.data) {
    accumulator.html += decodeBase64Url(body.data).toString("utf8");
  }

  for (const p of parts) walkParts(p, accumulator);
}

function extractBodies(payload) {
  const acc = { text: "", html: "", attachments: [], inlineBodyParts: [] };
  walkParts(payload, acc);
  return acc;
}

function normalizeMessageMeta(gmailMsg) {
  const headers = gmailMsg.payload?.headers || [];
  const from = pickHeader(headers, "From");
  const to = splitAddresses(pickHeader(headers, "To"));
  const cc = splitAddresses(pickHeader(headers, "Cc"));
  const bcc = splitAddresses(pickHeader(headers, "Bcc"));
  const replyTo = pickHeader(headers, "Reply-To");
  const subject = pickHeader(headers, "Subject");
  const dateHdr = pickHeader(headers, "Date");
  const rfcMessageId = pickHeader(headers, "Message-ID");
  const inReplyTo = pickHeader(headers, "In-Reply-To");
  const references = pickHeader(headers, "References");
  const internalDate = gmailMsg.internalDate ? new Date(Number(gmailMsg.internalDate)) : (dateHdr ? new Date(dateHdr) : null);
  const labels = gmailMsg.labelIds || [];
  return {
    from,
    to,
    cc,
    bcc,
    replyTo,
    subject,
    rfcMessageId,
    inReplyTo,
    referencesHeader: references,
    date: internalDate,
    labels,
    isUnread: labels.includes("UNREAD")
  };
}

// =========================
// R2 helpers (tagged folder per user/gmail)
// =========================
async function uploadInboxBody({ ownerEmail, gmailEmail, messageId, kind, content }) {
  if (!content) return null;
  const buffer = Buffer.from(content, "utf8");
  const folder = `inbox/${ownerEmail.replace(/[^a-z0-9._-]/gi, "_")}/${gmailEmail.replace(/[^a-z0-9._-]/gi, "_")}/bodies`;
  const filename = `${messageId}.${kind === "html" ? "html" : "txt"}`;
  const result = await uploadFile(buffer, {
    folder,
    filename,
    contentType: kind === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
    fileType: "inbox-body"
  });
  return result?.key || null;
}

async function uploadInboxAttachment({ ownerEmail, gmailEmail, messageId, attachment, content }) {
  const folder = `inbox/${ownerEmail.replace(/[^a-z0-9._-]/gi, "_")}/${gmailEmail.replace(/[^a-z0-9._-]/gi, "_")}/attachments/${messageId}`;
  const result = await uploadFile(content, {
    folder,
    filename: attachment.filename || attachment.attachmentId,
    contentType: attachment.mimetype || "application/octet-stream",
    fileType: "inbox-attachment"
  });
  return result?.key || null;
}

async function fetchR2BodyText(key) {
  if (!key) return "";
  try {
    const url = await getPresignedUrl(key, 60);
    const res = await fetch(url);
    if (!res.ok) return "";
    return await res.text();
  } catch (_) {
    return "";
  }
}

// =========================
// Sync / fetch logic
// =========================
async function listAndCacheThreads({ user, ownerEmail, q, labelIds, pageToken, maxResults = 25 }) {
  const gmail = gmailClientForUser(user);
  const listRes = await gmail.users.threads.list({
    userId: "me",
    q: q || undefined,
    labelIds: labelIds && labelIds.length ? labelIds : undefined,
    pageToken: pageToken || undefined,
    maxResults
  });

  const threads = listRes.data.threads || [];
  const out = [];

  for (const t of threads) {
    // Get minimal metadata for each thread (cheap, batched would be ideal — left for Phase 2)
    const tDetail = await gmail.users.threads.get({
      userId: "me",
      id: t.id,
      format: "metadata",
      metadataHeaders: ["From", "To", "Cc", "Subject", "Date"]
    });

    const msgs = tDetail.data.messages || [];
    if (!msgs.length) continue;

    const last = msgs[msgs.length - 1];
    const lastHeaders = last.payload?.headers || [];
    const subject = pickHeader(lastHeaders, "Subject");
    const fromLatest = pickHeader(lastHeaders, "From");

    const allLabels = new Set();
    let unread = 0;
    let hasAttach = false;
    const participants = new Set();

    for (const m of msgs) {
      (m.labelIds || []).forEach((l) => allLabels.add(l));
      if ((m.labelIds || []).includes("UNREAD")) unread++;
      const hs = m.payload?.headers || [];
      participants.add(pickHeader(hs, "From"));
      splitAddresses(pickHeader(hs, "To")).forEach((a) => participants.add(a));
      if ((m.payload?.parts || []).some((p) => p.filename)) hasAttach = true;
    }

    const lastDate = last.internalDate ? new Date(Number(last.internalDate)) : null;

    const upserted = await InboxThread.findOneAndUpdate(
      { ownerEmail, gmailEmail: user.email, threadId: t.id },
      {
        ownerEmail,
        gmailEmail: user.email,
        threadId: t.id,
        historyId: tDetail.data.historyId || null,
        subject,
        snippet: t.snippet || tDetail.data.snippet || "",
        participants: Array.from(participants).filter(Boolean),
        fromLatest,
        lastMessageAt: lastDate,
        messageCount: msgs.length,
        unreadCount: unread,
        labels: Array.from(allLabels),
        hasAttachments: hasAttach,
        lastSyncedAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    out.push(upserted);
  }

  return {
    threads: out,
    nextPageToken: listRes.data.nextPageToken || null,
    resultSizeEstimate: listRes.data.resultSizeEstimate || 0
  };
}

async function getCachedOrFetchMessage({ user, ownerEmail, messageId }) {
  const existing = await InboxMessage.findOne({
    ownerEmail,
    gmailEmail: user.email,
    messageId
  });
  if (existing && (existing.bodyHtmlR2Key || existing.bodyTextR2Key || existing.bodyTextInline)) {
    return existing;
  }

  const gmail = gmailClientForUser(user);
  const detail = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full"
  });
  const meta = normalizeMessageMeta(detail.data);
  const bodies = extractBodies(detail.data.payload);

  // Fetch large inline body parts that Gmail stored as anonymous attachments.
  for (const part of bodies.inlineBodyParts) {
    try {
      const r = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: part.attachmentId
      });
      const decoded = decodeBase64Url(r.data.data || "").toString("utf8");
      if (part.mimeType === "text/html") bodies.html += decoded;
      else if (part.mimeType === "text/plain") bodies.text += decoded;
    } catch (e) {
      console.warn(`[Inbox] inline body part fetch failed ${part.attachmentId}: ${e.message}`);
    }
  }

  const htmlKey = bodies.html
    ? await uploadInboxBody({
        ownerEmail,
        gmailEmail: user.email,
        messageId,
        kind: "html",
        content: bodies.html
      })
    : null;
  const textKey = bodies.text
    ? await uploadInboxBody({
        ownerEmail,
        gmailEmail: user.email,
        messageId,
        kind: "text",
        content: bodies.text
      })
    : null;

  const doc = await InboxMessage.findOneAndUpdate(
    { ownerEmail, gmailEmail: user.email, messageId },
    {
      ownerEmail,
      gmailEmail: user.email,
      threadId: detail.data.threadId,
      messageId,
      ...meta,
      snippet: detail.data.snippet || "",
      bodyHtmlR2Key: htmlKey,
      bodyTextR2Key: textKey,
      bodyTextInline: !htmlKey && !textKey ? bodies.text || "" : "",
      attachments: bodies.attachments
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc;
}

// =========================
// Routes
// =========================

router.post("/labels", async (req, res) => {
  try {
    const { ownerEmail, gmailEmail } = req.body || {};
    const user = await resolveGmailUser(ownerEmail, gmailEmail);
    if (!user) return res.status(404).json({ error: "no_connected_gmail" });
    const gmail = gmailClientForUser(user);
    const r = await gmail.users.labels.list({ userId: "me" });
    const labels = (r.data.labels || []).map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      messagesUnread: l.messagesUnread || 0,
      messagesTotal: l.messagesTotal || 0
    }));
    res.json({ labels, gmailEmail: user.email });
  } catch (err) {
    console.error("[Inbox] labels error:", err?.response?.data || err.message);
    res.status(500).json({ error: err?.message || "labels_failed" });
  }
});

router.post("/threads", async (req, res) => {
  try {
    const { ownerEmail, gmailEmail, q, labelIds, pageToken, maxResults } = req.body || {};
    const user = await resolveGmailUser(ownerEmail, gmailEmail);
    if (!user) return res.status(404).json({ error: "no_connected_gmail" });

    const result = await listAndCacheThreads({
      user,
      ownerEmail: user.ownerEmail,
      q,
      labelIds,
      pageToken,
      maxResults: Math.min(50, Number(maxResults) || 25)
    });

    res.json({
      gmailEmail: user.email,
      nextPageToken: result.nextPageToken,
      resultSizeEstimate: result.resultSizeEstimate,
      threads: result.threads.map((t) => ({
        threadId: t.threadId,
        subject: t.subject,
        snippet: t.snippet,
        fromLatest: t.fromLatest,
        participants: t.participants,
        lastMessageAt: t.lastMessageAt,
        messageCount: t.messageCount,
        unreadCount: t.unreadCount,
        labels: t.labels,
        hasAttachments: t.hasAttachments
      }))
    });
  } catch (err) {
    console.error("[Inbox] threads error:", err?.response?.data || err.message);
    res.status(500).json({ error: err?.message || "threads_failed" });
  }
});

router.post("/thread/:threadId", async (req, res) => {
  try {
    const { ownerEmail, gmailEmail } = req.body || {};
    const { threadId } = req.params;
    const user = await resolveGmailUser(ownerEmail, gmailEmail);
    if (!user) return res.status(404).json({ error: "no_connected_gmail" });

    const gmail = gmailClientForUser(user);
    const tDetail = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "minimal"
    });
    const msgIds = (tDetail.data.messages || []).map((m) => m.id);

    const messages = [];
    for (const id of msgIds) {
      const doc = await getCachedOrFetchMessage({
        user,
        ownerEmail: user.ownerEmail,
        messageId: id
      });
      const html = doc.bodyHtmlR2Key ? await fetchR2BodyText(doc.bodyHtmlR2Key) : "";
      const text = doc.bodyTextR2Key ? await fetchR2BodyText(doc.bodyTextR2Key) : doc.bodyTextInline || "";
      messages.push({
        messageId: doc.messageId,
        threadId: doc.threadId,
        from: doc.from,
        to: doc.to,
        cc: doc.cc,
        bcc: doc.bcc,
        replyTo: doc.replyTo,
        subject: doc.subject,
        date: doc.date,
        snippet: doc.snippet,
        labels: doc.labels,
        isUnread: doc.isUnread,
        rfcMessageId: doc.rfcMessageId,
        bodyHtml: html,
        bodyText: text,
        attachments: (doc.attachments || []).map((a) => ({
          attachmentId: a.attachmentId,
          filename: a.filename,
          mimetype: a.mimetype,
          size: a.size,
          cached: !!a.r2Key
        }))
      });
    }

    res.json({ threadId, messages });
  } catch (err) {
    console.error("[Inbox] thread error:", err?.response?.data || err.message);
    res.status(500).json({ error: err?.message || "thread_failed" });
  }
});

router.post("/message/:messageId/attachment/:attachmentId", async (req, res) => {
  try {
    const { ownerEmail, gmailEmail } = req.body || {};
    const { messageId, attachmentId } = req.params;
    const user = await resolveGmailUser(ownerEmail, gmailEmail);
    if (!user) return res.status(404).json({ error: "no_connected_gmail" });

    const msg = await InboxMessage.findOne({
      ownerEmail: user.ownerEmail,
      gmailEmail: user.email,
      messageId
    });
    if (!msg) return res.status(404).json({ error: "message_not_cached" });

    const att = (msg.attachments || []).find((a) => a.attachmentId === attachmentId);
    if (!att) return res.status(404).json({ error: "attachment_not_found" });

    if (!att.r2Key) {
      const gmail = gmailClientForUser(user);
      const r = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: attachmentId
      });
      const buf = decodeBase64Url(r.data.data);
      const key = await uploadInboxAttachment({
        ownerEmail: user.ownerEmail,
        gmailEmail: user.email,
        messageId,
        attachment: att,
        content: buf
      });
      await InboxMessage.updateOne(
        { ownerEmail: user.ownerEmail, gmailEmail: user.email, messageId, "attachments.attachmentId": attachmentId },
        { $set: { "attachments.$.r2Key": key } }
      );
      att.r2Key = key;
    }

    const url = await getPresignedUrl(att.r2Key, 600);
    res.json({
      filename: att.filename,
      mimetype: att.mimetype,
      size: att.size,
      url
    });
  } catch (err) {
    console.error("[Inbox] attachment error:", err?.response?.data || err.message);
    res.status(500).json({ error: err?.message || "attachment_failed" });
  }
});

router.post("/modify", async (req, res) => {
  try {
    const { ownerEmail, gmailEmail, messageIds, threadIds, addLabelIds, removeLabelIds, action } =
      req.body || {};
    const user = await resolveGmailUser(ownerEmail, gmailEmail);
    if (!user) return res.status(404).json({ error: "no_connected_gmail" });
    const gmail = gmailClientForUser(user);

    let add = Array.isArray(addLabelIds) ? [...addLabelIds] : [];
    let remove = Array.isArray(removeLabelIds) ? [...removeLabelIds] : [];

    if (action === "markRead") remove.push("UNREAD");
    else if (action === "markUnread") add.push("UNREAD");
    else if (action === "archive") remove.push("INBOX");
    else if (action === "trash") {
      // Trash requires special endpoint
      const ids = messageIds || threadIds || [];
      for (const id of ids) {
        if (messageIds) await gmail.users.messages.trash({ userId: "me", id });
        else await gmail.users.threads.trash({ userId: "me", id });
      }
      // Update local cache
      if (messageIds?.length) {
        await InboxMessage.updateMany(
          { ownerEmail: user.ownerEmail, gmailEmail: user.email, messageId: { $in: messageIds } },
          { $addToSet: { labels: "TRASH" } }
        );
      }
      return res.json({ ok: true, trashed: ids.length });
    }

    add = Array.from(new Set(add));
    remove = Array.from(new Set(remove));

    if (Array.isArray(messageIds) && messageIds.length) {
      for (const id of messageIds) {
        await gmail.users.messages.modify({
          userId: "me",
          id,
          requestBody: { addLabelIds: add, removeLabelIds: remove }
        });
      }
      // Update local cache
      const setOps = {};
      if (remove.includes("UNREAD")) setOps.isUnread = false;
      if (add.includes("UNREAD")) setOps.isUnread = true;
      await InboxMessage.updateMany(
        { ownerEmail: user.ownerEmail, gmailEmail: user.email, messageId: { $in: messageIds } },
        {
          ...(Object.keys(setOps).length ? { $set: setOps } : {}),
          ...(add.length ? { $addToSet: { labels: { $each: add } } } : {}),
          ...(remove.length ? { $pull: { labels: { $in: remove } } } : {})
        }
      );
    }

    if (Array.isArray(threadIds) && threadIds.length) {
      for (const id of threadIds) {
        await gmail.users.threads.modify({
          userId: "me",
          id,
          requestBody: { addLabelIds: add, removeLabelIds: remove }
        });
      }
      // Update local thread cache
      const incUnread = remove.includes("UNREAD") ? { unreadCount: 0 } : null;
      await InboxThread.updateMany(
        { ownerEmail: user.ownerEmail, gmailEmail: user.email, threadId: { $in: threadIds } },
        {
          ...(incUnread ? { $set: incUnread } : {}),
          ...(add.length ? { $addToSet: { labels: { $each: add } } } : {}),
          ...(remove.length ? { $pull: { labels: { $in: remove } } } : {})
        }
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[Inbox] modify error:", err?.response?.data || err.message);
    res.status(500).json({ error: err?.message || "modify_failed" });
  }
});

// Send a reply (uses threadId + In-Reply-To/References for proper threading).
router.post("/reply", async (req, res) => {
  try {
    const { ownerEmail, gmailEmail, threadId, inReplyTo, references, to, cc, subject, html, text } =
      req.body || {};
    const user = await resolveGmailUser(ownerEmail, gmailEmail);
    if (!user) return res.status(404).json({ error: "no_connected_gmail" });
    if (!to || !subject) return res.status(400).json({ error: "to_and_subject_required" });

    const gmail = gmailClientForUser(user);
    const boundary = `----=_FF_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const headers = [
      `To: ${Array.isArray(to) ? to.join(", ") : to}`,
      `From: ${user.email}`,
      `Subject: ${subject.startsWith("Re:") ? subject : `Re: ${subject}`}`,
      "MIME-Version: 1.0"
    ];
    if (cc) headers.push(`Cc: ${Array.isArray(cc) ? cc.join(", ") : cc}`);
    if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
    if (references) headers.push(`References: ${references}`);
    let body;
    if (html) {
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      body =
        "\r\n" +
        `--${boundary}\r\n` +
        "Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
        (text || "") +
        "\r\n" +
        `--${boundary}\r\n` +
        "Content-Type: text/html; charset=UTF-8\r\n\r\n" +
        html +
        "\r\n" +
        `--${boundary}--`;
    } else {
      headers.push("Content-Type: text/plain; charset=UTF-8");
      body = "\r\n" + (text || "");
    }
    const mime = headers.join("\r\n") + body;
    const raw = Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const r = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId: threadId || undefined }
    });

    res.json({ ok: true, messageId: r.data.id, threadId: r.data.threadId });
  } catch (err) {
    console.error("[Inbox] reply error:", err?.response?.data || err.message);
    res.status(500).json({ error: err?.message || "reply_failed" });
  }
});

// Compose / forward / reply with attachments + CC + BCC.
// multipart/form-data — fields: ownerEmail, gmailEmail, to, cc?, bcc?, subject, html?, text?, threadId?, inReplyTo?, references?
router.post("/compose", composeUpload.array("attachments", 10), async (req, res) => {
  try {
    const {
      ownerEmail,
      gmailEmail,
      to,
      cc,
      bcc,
      subject,
      html,
      text,
      threadId,
      inReplyTo,
      references
    } = req.body || {};
    if (!to || !subject) return res.status(400).json({ error: "to_and_subject_required" });

    const user = await resolveGmailUser(ownerEmail, gmailEmail);
    if (!user) return res.status(404).json({ error: "no_connected_gmail" });

    const attachments = (req.files || []).map((f) => ({
      filename: f.originalname,
      mimetype: f.mimetype,
      content: f.buffer
    }));

    const mime = buildComposeMime({
      from: user.email,
      to,
      cc,
      bcc,
      subject,
      html: html || undefined,
      text: text || undefined,
      attachments,
      inReplyTo: inReplyTo || undefined,
      references: references || undefined
    });
    const raw = Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const gmail = gmailClientForUser(user);
    const r = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId: threadId || undefined }
    });
    res.json({ ok: true, messageId: r.data.id, threadId: r.data.threadId });
  } catch (err) {
    console.error("[Inbox] compose error:", err?.response?.data || err.message);
    res.status(500).json({ error: err?.message || "compose_failed" });
  }
});

// Lightweight unread count for badge.
router.post("/unread-count", async (req, res) => {
  try {
    const { ownerEmail, gmailEmail } = req.body || {};
    const user = await resolveGmailUser(ownerEmail, gmailEmail);
    if (!user) return res.status(404).json({ error: "no_connected_gmail" });
    const gmail = gmailClientForUser(user);
    const r = await gmail.users.labels.get({ userId: "me", id: "INBOX" });
    const inboxUnread = r.data.messagesUnread || 0;
    res.json({ unread: inboxUnread, gmailEmail: user.email });
  } catch (err) {
    res.status(500).json({ error: err?.message || "unread_failed" });
  }
});

// Star / unstar (helper wrapper around modify).
router.post("/star", async (req, res) => {
  try {
    const { ownerEmail, gmailEmail, threadIds, messageIds, star } = req.body || {};
    const user = await resolveGmailUser(ownerEmail, gmailEmail);
    if (!user) return res.status(404).json({ error: "no_connected_gmail" });
    const gmail = gmailClientForUser(user);
    const ids = threadIds || messageIds || [];
    for (const id of ids) {
      const body = star
        ? { addLabelIds: ["STARRED"] }
        : { removeLabelIds: ["STARRED"] };
      if (threadIds) await gmail.users.threads.modify({ userId: "me", id, requestBody: body });
      else await gmail.users.messages.modify({ userId: "me", id, requestBody: body });
    }
    if (threadIds?.length) {
      await InboxThread.updateMany(
        { ownerEmail: user.ownerEmail, gmailEmail: user.email, threadId: { $in: threadIds } },
        star ? { $addToSet: { labels: "STARRED" } } : { $pull: { labels: "STARRED" } }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "star_failed" });
  }
});

export default router;
