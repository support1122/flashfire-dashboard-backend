// Shared Gmail message parsing helpers.
//
// Extracted from GmailInboxRouter.js so the inbox API and the hourly
// mail-poll worker parse messages identically. Everything here is pure
// (no DB, no R2) except gmailClientForUser, which only builds an OAuth
// client from a stored refresh token.

import { google } from "googleapis";

// =========================
// Auth
// =========================
export function gmailClientForUser(user) {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth.setCredentials({ refresh_token: user.refreshToken });
  return google.gmail({ version: "v1", auth: oauth });
}

// =========================
// Body / header parsing
// =========================
export function decodeBase64Url(b64) {
  if (!b64) return Buffer.alloc(0);
  const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? "" : "=".repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, "base64");
}

export function pickHeader(headers, name) {
  if (!Array.isArray(headers)) return "";
  const lc = name.toLowerCase();
  const h = headers.find((x) => (x.name || "").toLowerCase() === lc);
  return h ? String(h.value || "") : "";
}

export function splitAddresses(value) {
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

export function walkParts(payload, accumulator) {
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

export function extractBodies(payload) {
  const acc = { text: "", html: "", attachments: [], inlineBodyParts: [] };
  walkParts(payload, acc);
  return acc;
}

export function normalizeMessageMeta(gmailMsg) {
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
// Derived helpers used by the mail-poll worker
// =========================

// htmlToText: crude but dependency-free. Only used to feed the summarizer
// when a mail has no text/plain part at all.
export function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Matches bare http(s) URLs. Trailing punctuation is trimmed by the caller.
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

// extractUrls: pull unique http(s) links out of arbitrary text, preserving
// first-seen order. Trailing sentence punctuation is stripped so
// "see https://x.com/job." yields "https://x.com/job".
export function extractUrls(...texts) {
  const seen = new Set();
  const out = [];
  for (const t of texts) {
    if (!t) continue;
    for (const raw of String(t).match(URL_RE) || []) {
      const url = raw.replace(/[.,;:!?)\]}>'"]+$/, "");
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

// parseFromHeader: "Jobs Bot <bot@example.com>" → { name, email }
export function parseFromHeader(from) {
  const s = String(from || "").trim();
  const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: s.toLowerCase() };
}

// isTextLike: should this attachment's bytes be fed to the summarizer?
export function isTextLike(att) {
  const mt = String(att?.mimetype || "").toLowerCase();
  const fn = String(att?.filename || "").toLowerCase();
  return mt.startsWith("text/") || mt === "application/json" || /\.(txt|csv|md|json|log)$/.test(fn);
}
