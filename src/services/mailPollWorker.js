// mailPollWorker — hourly Gmail → gpt-4o-mini → Discord pipeline.
//
// Every hour, for each connected Gmail mailbox (GmailUser):
//   1. ask Gmail for INBOX messages newer than the stored cursor
//   2. fetch each new message, flatten its body, decode its .txt attachments
//   3. summarize it with gpt-4o-mini (fail-open — no summary still ships)
//   4. claim it in Mongo (unique index = at-most-once), then post a rich
//      Discord embed with the client's info, the summary, the extracted links,
//      and the .txt uploaded as a real Discord file
//
// If Gmail rejects the refresh token (invalid_grant / revoked), the mailbox is
// skipped and a red "please reconnect the mail" alert goes to Discord, throttled
// per-mailbox via GmailPollState.lastAuthAlertAt so a dead token pings once every
// few hours rather than every tick.
//
// Delivery guarantees:
//   • At most once — MailDigest has a unique (gmailEmail, messageId) index, and
//     we only post when *our* upsert created the doc.
//   • At least once (eventually) — a digest whose Discord post failed keeps
//     discordPostedAt === null and is retried at the top of the next tick.
//
// Nothing here throws out of pollOnce(). One broken mailbox must not stop the rest.

import cron from "node-cron";
import { GmailUser } from "../../Schema_Models/GmailUser.js";
import { GmailPollState } from "../../Schema_Models/GmailPollState.js";
import { MailDigest } from "../../Schema_Models/MailDigest.js";
import { UserModel } from "../../Schema_Models/UserModel.js";
import { ProfileModel } from "../../Schema_Models/ProfileModel.js";
import {
  gmailClientForUser,
  decodeBase64Url,
  extractBodies,
  normalizeMessageMeta,
  htmlToText,
  parseFromHeader,
  isTextLike
} from "../../Utils/gmailMessage.js";
import { summarizeMail } from "./mailAiSummarizer.js";
import { notifyMailDigest, notifyGmailAuthError, isGmailAuthError, errorText } from "../../Utils/discordMailNotify.js";

const CRON_EXPR = process.env.MAIL_POLL_CRON || "0 * * * *"; // top of every hour
const ENABLED = process.env.MAIL_POLL_ENABLED !== "0";
const CONCURRENCY = Math.max(1, Number(process.env.MAIL_POLL_CONCURRENCY) || 2);

// Hard cap on mails summarized per mailbox per tick. Overflow is not lost — the
// cursor only advances past what we actually processed, so the next tick resumes.
const MAX_PER_TICK = Math.max(1, Number(process.env.MAIL_POLL_MAX_PER_TICK) || 25);
// Upper bound on message ids pulled from Gmail in one tick (memory guard).
const MAX_COLLECT = Math.max(MAX_PER_TICK, Number(process.env.MAIL_POLL_MAX_COLLECT) || 200);

// First ever poll for a mailbox: look back this far instead of replaying the
// entire mailbox history into Discord.
const BOOTSTRAP_HOURS = Math.max(1, Number(process.env.MAIL_POLL_BOOTSTRAP_HOURS) || 1);
// Re-ask Gmail for a small window before the cursor so a message that landed in
// the same second as the cursor is not skipped. Dedupe makes the overlap free.
const CURSOR_OVERLAP_SEC = Math.max(0, Number(process.env.MAIL_POLL_CURSOR_OVERLAP_SEC) || 120);

// A dead token pings Discord at most once per this window.
const AUTH_ALERT_THROTTLE_MS = Math.max(1, Number(process.env.MAIL_AUTH_ALERT_THROTTLE_HOURS) || 6) * 3600 * 1000;

// Only attachments up to this size are downloaded and fed to the AI / uploaded.
const MAX_ATTACHMENT_BYTES = Number(process.env.MAIL_MAX_ATTACHMENT_BYTES) || 7_500_000;

// Retry window for digests that were claimed but never delivered to Discord.
const PENDING_RETRY_HOURS = Math.max(1, Number(process.env.MAIL_PENDING_RETRY_HOURS) || 24);
// Give up on a digest Discord keeps rejecting (e.g. a malformed embed) instead
// of re-attempting it every hour for the whole retry window.
const MAX_DELIVERY_ATTEMPTS = Math.max(1, Number(process.env.MAIL_MAX_DELIVERY_ATTEMPTS) || 5);

let running = false; // overlap guard
let task = null;

// ─── Tiny worker pool ───────────────────────────────────────────────
async function runWithConcurrency(items, limit, worker) {
  const queue = items.slice();
  const inFlight = [];
  const results = [];
  while (queue.length || inFlight.length) {
    while (queue.length && inFlight.length < limit) {
      const item = queue.shift();
      const p = worker(item)
        .then((r) => results.push({ ok: true, item, r }))
        .catch((e) => results.push({ ok: false, item, error: e?.message || String(e) }))
        .finally(() => {
          const i = inFlight.indexOf(p);
          if (i !== -1) inFlight.splice(i, 1);
        });
      inFlight.push(p);
    }
    if (inFlight.length) await Promise.race(inFlight);
  }
  return results;
}

// ─── Client identity ────────────────────────────────────────────────

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// findUserByEmail: UserModel.email has no lowercase transform, so a client
// stored as "Priya@Gmail.com" would never match our lowercased mailbox key.
// Try the indexed exact match first, then fall back to an anchored
// case-insensitive match (rare, and the client collection is small).
async function findUserByEmail(email) {
  const exact = await UserModel.findOne({ email })
    .select("name email planType dashboardManager")
    .lean()
    .catch(() => null);
  if (exact) return exact;

  return UserModel.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, "i") })
    .select("name email planType dashboardManager")
    .lean()
    .catch(() => null);
}

// resolveClient: map a connected mailbox back to the FlashFire client it
// belongs to, so the Discord embed can say who this mail is about.
// Tries the dashboard account first, then the profile's contact email.
async function resolveClient(gmailEmail, ownerEmail, cache) {
  const key = gmailEmail.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  let client = await findUserByEmail(key);

  if (!client) {
    const profile = await ProfileModel.findOne({
      $or: [
        { email: key },
        { contactEmail: key },
        { email: new RegExp(`^${escapeRegex(key)}$`, "i") },
        { contactEmail: new RegExp(`^${escapeRegex(key)}$`, "i") }
      ]
    })
      .select("email firstName lastName")
      .lean()
      .catch(() => null);

    if (profile?.email) {
      client =
        (await findUserByEmail(profile.email.toLowerCase())) || {
          name: [profile.firstName, profile.lastName].filter(Boolean).join(" "),
          email: profile.email
        };
    }
  }

  // Unmatched mailbox — still notify, just with what we know.
  if (!client) client = { name: "", email: gmailEmail, planType: "", dashboardManager: ownerEmail };

  cache.set(key, client);
  return client;
}

// ─── Gmail fetch ────────────────────────────────────────────────────

// listNewMessageIds: paginate INBOX for everything after the cursor, oldest-first.
// Gmail returns newest-first, so we reverse. Bounded by MAX_COLLECT.
async function listNewMessageIds(gmail, afterSec) {
  const ids = [];
  let pageToken;
  do {
    const res = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      q: `after:${afterSec}`,
      maxResults: 100,
      pageToken
    });
    for (const m of res.data.messages || []) ids.push(m.id);
    pageToken = res.data.nextPageToken;
  } while (pageToken && ids.length < MAX_COLLECT);

  return ids.slice(0, MAX_COLLECT).reverse(); // oldest first
}

// downloadTextAttachments: pull the bytes for text-like attachments only.
// Binary files (PDFs, images) are recorded in the digest but never fetched —
// they are not useful to the summarizer and would blow the upload budget.
async function downloadTextAttachments(gmail, messageId, attachments) {
  const out = [];
  for (const att of attachments) {
    if (!isTextLike(att)) continue;
    if (att.size > MAX_ATTACHMENT_BYTES) {
      console.warn(`[mail-poll] skip oversized attachment ${att.filename} (${att.size} bytes)`);
      continue;
    }
    try {
      const r = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: att.attachmentId
      });
      const buffer = decodeBase64Url(r.data.data || "");
      out.push({ ...att, buffer, text: buffer.toString("utf8") });
    } catch (e) {
      console.warn(`[mail-poll] attachment fetch failed ${att.filename}: ${e.message}`);
    }
  }
  return out;
}

// fetchMessage: full message → { meta, bodyText, textAttachments, allAttachments }
async function fetchMessage(gmail, messageId) {
  const detail = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const meta = normalizeMessageMeta(detail.data);
  const bodies = extractBodies(detail.data.payload);

  // Gmail parks body parts over ~2 MB as anonymous attachments with no inline data.
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
      console.warn(`[mail-poll] inline body part fetch failed: ${e.message}`);
    }
  }

  const bodyText = bodies.text?.trim() || htmlToText(bodies.html);
  const textAttachments = await downloadTextAttachments(gmail, messageId, bodies.attachments);

  return {
    meta,
    snippet: detail.data.snippet || "",
    threadId: detail.data.threadId || "",
    internalDate: Number(detail.data.internalDate || 0),
    bodyText,
    textAttachments,
    allAttachments: bodies.attachments
  };
}

// ─── Discord delivery ───────────────────────────────────────────────

// deliver: post one digest and record the outcome. Never throws.
//
// The two writes below are deliberately separate. Stamping discordPostedAt is
// what stops the retry pass from posting this mail a second time, so it must
// not be coupled to the cosmetic per-attachment flag: an arrayFilters failure
// would otherwise leave discordPostedAt null and duplicate the Discord message.
async function deliver({ digestDoc, client, mailbox, files = [], counts }) {
  const result = await notifyMailDigest({ client, mailbox, digest: digestDoc, files, counts });

  if (!result.ok) {
    await MailDigest.updateOne(
      { _id: digestDoc._id },
      { $set: { discordError: String(result.error || "unknown").slice(0, 300) }, $inc: { discordAttempts: 1 } }
    ).catch(() => {});
    console.warn(`[mail-poll] discord post failed for ${digestDoc.messageId}: ${result.error}`);
    return false;
  }

  // Critical: mark delivered. If this throws we surface it loudly, because the
  // mail WILL be re-posted on the next tick.
  try {
    await MailDigest.updateOne(
      { _id: digestDoc._id },
      { $set: { discordPostedAt: new Date(), discordError: "" }, $inc: { discordAttempts: 1 } }
    );
  } catch (e) {
    console.error(
      `[mail-poll] CRITICAL: posted ${digestDoc.messageId} to Discord but failed to mark it delivered — it may be re-posted: ${e.message}`
    );
    return true; // it did reach Discord; do not count it as a failure
  }

  // Cosmetic: record which files actually made it. Oversized ones were named in
  // the embed but never uploaded. Failure here is harmless.
  const skipped = new Set((result.skipped || []).map((s) => s.filename));
  const delivered = files.map((f) => f.filename).filter((n) => !skipped.has(n));
  if (delivered.length) {
    await MailDigest.updateOne(
      { _id: digestDoc._id },
      { $set: { "attachments.$[a].uploadedToDiscord": true } },
      { arrayFilters: [{ "a.filename": { $in: delivered } }] }
    ).catch((e) => console.warn(`[mail-poll] attachment flag update failed: ${e.message}`));
  }
  return true;
}

// retryPendingDigests: anything claimed but never delivered (worker crashed, or
// Discord was down). Reposts without re-summarizing — the digest is already
// stored — but DOES re-download the attachments from Gmail, so a Discord blip
// never costs the client their .txt file.
//
// Returns the number recovered so the caller can advance the lifetime counter;
// these mails were claimed on an earlier tick and so were never counted.
async function retryPendingDigests({ gmail, user, client, state }) {
  const cutoff = new Date(Date.now() - PENDING_RETRY_HOURS * 3600 * 1000);
  const pending = await MailDigest.find({
    gmailEmail: user.email,
    discordPostedAt: null,
    createdAt: { $gte: cutoff },
    discordAttempts: { $lt: MAX_DELIVERY_ATTEMPTS }
  })
    .sort({ internalDate: 1 })
    .limit(MAX_PER_TICK);

  let recovered = 0;
  for (const doc of pending) {
    // Re-fetch only the files we would have uploaded originally.
    const wanted = (doc.attachments || []).filter((a) => a.uploadable && a.attachmentId);
    let files = [];
    if (wanted.length) {
      files = (await downloadTextAttachments(gmail, doc.messageId, wanted)).map((a) => ({
        filename: a.filename,
        contentType: a.mimetype,
        buffer: a.buffer
      }));
    }

    const ok = await deliver({
      digestDoc: doc,
      client,
      mailbox: user.email,
      files,
      counts: { totalForClient: state.totalNotified + recovered + 1, newThisRun: 0 }
    });
    if (ok) recovered++;
  }

  if (recovered) {
    // These were claimed on a previous tick, so nothing has counted them yet.
    await GmailPollState.updateOne({ _id: state._id }, { $inc: { totalNotified: recovered } }).catch(() => {});
    state.totalNotified += recovered;
    console.log(`[mail-poll] ${user.email}: recovered ${recovered} undelivered digest(s)`);
  }
  return recovered;
}

// ─── Per-mailbox poll ───────────────────────────────────────────────

async function pollMailbox(user, clientCache) {
  const mailbox = user.email;
  const ownerEmail = (user.ownerEmail || "").toLowerCase();

  let state = await GmailPollState.findOne({ gmailEmail: mailbox });
  if (!state) {
    try {
      state = await GmailPollState.create({ ownerEmail, gmailEmail: mailbox });
    } catch (e) {
      // Lost a create race against a concurrent worker — re-read the winner.
      if (e?.code !== 11000) throw e;
      state = await GmailPollState.findOne({ gmailEmail: mailbox });
    }
  }

  if (!state) throw new Error(`could not load or create poll state for ${mailbox}`);

  const client = await resolveClient(mailbox, ownerEmail, clientCache);
  const gmail = gmailClientForUser(user);

  // Deliver anything stranded from a previous tick before pulling new mail.
  await retryPendingDigests({ gmail, user, client, state }).catch((e) =>
    console.warn(`[mail-poll] ${mailbox}: pending retry failed: ${errorText(e)}`)
  );

  const afterSec = state.lastInternalDate
    ? Math.max(0, Math.floor(state.lastInternalDate / 1000) - CURSOR_OVERLAP_SEC)
    : Math.floor((Date.now() - BOOTSTRAP_HOURS * 3600 * 1000) / 1000);

  let ids;
  try {
    ids = await listNewMessageIds(gmail, afterSec);
  } catch (err) {
    return handleMailboxError({ err, state, client, mailbox });
  }

  if (!ids.length) {
    await GmailPollState.updateOne(
      { _id: state._id },
      {
        $set: {
          lastPolledAt: new Date(),
          lastSuccessAt: new Date(),
          consecutiveFailures: 0,
          lastErrorMessage: "",
          authErrorAt: null,
          authErrorMessage: ""
        }
      }
    );
    return { mailbox, checked: 0, posted: 0 };
  }

  // Drop ids we've already digested before spending a Gmail get + an OpenAI call.
  const known = await MailDigest.find({ gmailEmail: mailbox, messageId: { $in: ids } })
    .select("messageId")
    .lean();
  const knownSet = new Set(known.map((d) => d.messageId));
  const fresh = ids.filter((id) => !knownSet.has(id)).slice(0, MAX_PER_TICK);

  if (ids.length > MAX_PER_TICK) {
    console.log(
      `[mail-poll] ${mailbox}: ${ids.length} candidates, processing oldest ${Math.min(fresh.length, MAX_PER_TICK)} this tick; remainder resumes next tick`
    );
  }

  let posted = 0;
  let maxInternalDate = state.lastInternalDate || 0;

  for (const messageId of fresh) {
    try {
      const msg = await fetchMessage(gmail, messageId);

      const ai = await summarizeMail({
        from: msg.meta.from,
        subject: msg.meta.subject,
        date: msg.meta.date,
        bodyText: msg.bodyText,
        attachments: msg.textAttachments.map((a) => ({ filename: a.filename, text: a.text }))
      });

      const uploadedNames = new Set(msg.textAttachments.map((a) => a.filename));
      const doc = {
        ownerEmail,
        gmailEmail: mailbox,
        threadId: msg.threadId,
        messageId,
        from: msg.meta.from,
        fromEmail: parseFromHeader(msg.meta.from).email,
        subject: msg.meta.subject,
        snippet: msg.snippet,
        date: msg.meta.date,
        internalDate: msg.internalDate,
        summary: ai.summary,
        keyPoints: ai.keyPoints,
        category: ai.category,
        priority: ai.priority,
        actionRequired: ai.actionRequired,
        urls: ai.urls,
        aiModel: ai.aiModel,
        aiSucceeded: ai.aiSucceeded,
        aiError: ai.aiError,
        attachments: msg.allAttachments.map((a) => ({
          attachmentId: a.attachmentId,
          filename: a.filename,
          mimetype: a.mimetype,
          size: a.size,
          uploadable: uploadedNames.has(a.filename),
          uploadedToDiscord: false // flipped below once Discord accepts the post
        })),
        discordPostedAt: null
      };

      // Claim the message by inserting it. The unique (gmailEmail, messageId)
      // index makes this the atomic gate: exactly one worker's insert wins, so
      // exactly one Discord post happens — even if the cursor replays a second
      // or a second instance polls the same mailbox. A duplicate-key error means
      // someone else owns this mail; skip it.
      let digestDoc;
      try {
        digestDoc = await MailDigest.create(doc);
      } catch (e) {
        if (e?.code === 11000) {
          maxInternalDate = Math.max(maxInternalDate, msg.internalDate);
          continue;
        }
        throw e;
      }

      const ok = await deliver({
        digestDoc,
        client,
        mailbox,
        files: msg.textAttachments.map((a) => ({
          filename: a.filename,
          contentType: a.mimetype,
          buffer: a.buffer
        })),
        counts: {
          totalForClient: state.totalNotified + posted + 1,
          newThisRun: fresh.length
        }
      });
      if (ok) posted++;

      maxInternalDate = Math.max(maxInternalDate, msg.internalDate);
    } catch (err) {
      // An auth failure mid-loop means every remaining message will fail too —
      // bail out of the mailbox rather than burning 24 more Gmail calls.
      if (isGmailAuthError(errorText(err))) {
        return handleMailboxError({ err, state, client, mailbox, partialPosted: posted, maxInternalDate });
      }
      console.warn(`[mail-poll] ${mailbox}: message ${messageId} failed: ${errorText(err)}`);
    }
  }

  await GmailPollState.updateOne(
    { _id: state._id },
    {
      $set: {
        lastInternalDate: maxInternalDate,
        lastPolledAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        lastErrorMessage: "",
        authErrorAt: null,
        authErrorMessage: ""
      },
      $inc: { totalNotified: posted }
    }
  );

  console.log(`[mail-poll] ${mailbox}: checked=${fresh.length} posted=${posted}`);
  return { mailbox, checked: fresh.length, posted };
}

// handleMailboxError: classify, persist, and (for auth failures) alert Discord
// under a DB-backed throttle so restarts don't re-spam the channel.
async function handleMailboxError({ err, state, client, mailbox, partialPosted = 0, maxInternalDate }) {
  const message = (errorText(err) || String(err)).slice(0, 400);

  if (!isGmailAuthError(message)) {
    await GmailPollState.updateOne(
      { _id: state._id },
      {
        $set: { lastPolledAt: new Date(), lastErrorMessage: message },
        $inc: { consecutiveFailures: 1, ...(partialPosted ? { totalNotified: partialPosted } : {}) },
        ...(maxInternalDate ? { $max: { lastInternalDate: maxInternalDate } } : {})
      }
    ).catch(() => {});
    console.error(`[mail-poll] ${mailbox}: transient failure: ${message}`);
    return { mailbox, checked: 0, posted: partialPosted, error: message };
  }

  const now = Date.now();
  const lastAlert = state.lastAuthAlertAt ? new Date(state.lastAuthAlertAt).getTime() : 0;
  const shouldAlert = now - lastAlert >= AUTH_ALERT_THROTTLE_MS;

  const update = {
    $set: {
      lastPolledAt: new Date(),
      authErrorMessage: message,
      lastErrorMessage: message,
      ...(state.authErrorAt ? {} : { authErrorAt: new Date() })
    },
    $inc: { consecutiveFailures: 1, ...(partialPosted ? { totalNotified: partialPosted } : {}) },
    ...(maxInternalDate ? { $max: { lastInternalDate: maxInternalDate } } : {})
  };
  if (shouldAlert) update.$set.lastAuthAlertAt = new Date();

  await GmailPollState.updateOne({ _id: state._id }, update).catch(() => {});

  if (shouldAlert) {
    console.error(`[mail-poll] ${mailbox}: AUTH ERROR — alerting Discord: ${message}`);
    await notifyGmailAuthError({
      client,
      mailbox,
      error: message,
      since: state.authErrorAt || new Date()
    }).catch((e) => console.error(`[mail-poll] auth alert post failed: ${e.message}`));
  } else {
    console.error(`[mail-poll] ${mailbox}: AUTH ERROR (alert throttled): ${message}`);
  }

  return { mailbox, checked: 0, posted: partialPosted, authError: message };
}

// ─── Tick ───────────────────────────────────────────────────────────

export async function pollOnce({ trigger = "cron" } = {}) {
  if (running) {
    console.log("[mail-poll] previous tick still running — skip");
    return { skipped: true };
  }
  running = true;
  const startedAt = Date.now();

  try {
    // The at-most-once guarantee rests on these unique indexes existing. Model.init()
    // resolves once they are built (and is memoized, so this is free after the first tick).
    await Promise.all([MailDigest.init(), GmailPollState.init()]);

    const mailboxes = await GmailUser.find({ refreshToken: { $exists: true, $ne: "" } }).lean();
    if (!mailboxes.length) {
      console.log("[mail-poll] no connected mailboxes");
      return { mailboxes: 0, posted: 0, tookMs: Date.now() - startedAt };
    }

    const clientCache = new Map();
    const results = await runWithConcurrency(mailboxes, CONCURRENCY, (u) => pollMailbox(u, clientCache));

    const posted = results.reduce((n, r) => n + (r.r?.posted || 0), 0);
    const checked = results.reduce((n, r) => n + (r.r?.checked || 0), 0);
    const authErrors = results.filter((r) => r.r?.authError).length;
    const crashed = results.filter((r) => !r.ok);

    for (const c of crashed) {
      console.error(`[mail-poll] mailbox ${c.item?.email} crashed: ${c.error}`);
    }

    console.log(
      `[mail-poll] tick done (${trigger}) — mailboxes=${mailboxes.length} checked=${checked} posted=${posted} authErrors=${authErrors} crashed=${crashed.length} tookMs=${Date.now() - startedAt}`
    );

    return {
      mailboxes: mailboxes.length,
      checked,
      posted,
      authErrors,
      crashed: crashed.length,
      tookMs: Date.now() - startedAt
    };
  } catch (err) {
    console.error("[mail-poll] tick crashed:", err);
    return { error: err.message, tookMs: Date.now() - startedAt };
  } finally {
    running = false;
  }
}

export function startMailPollWorker() {
  if (!ENABLED) {
    console.log("[mail-poll] disabled (MAIL_POLL_ENABLED=0)");
    return null;
  }
  if (task) {
    console.log("[mail-poll] already running — skip duplicate start");
    return task;
  }
  if (!process.env.DISCORD_MAIL_WEBHOOK_URL) {
    console.warn("[mail-poll] DISCORD_MAIL_WEBHOOK_URL is not set — mails will be summarized and stored but NOT posted to Discord");
  }

  task = cron.schedule(CRON_EXPR, () => pollOnce({ trigger: "cron" }), { timezone: "Asia/Kolkata" });
  console.log(`[mail-poll] worker registered (cron='${CRON_EXPR}', concurrency=${CONCURRENCY}, maxPerTick=${MAX_PER_TICK})`);

  if (process.env.MAIL_POLL_RUN_ON_BOOT === "1") {
    setTimeout(() => pollOnce({ trigger: "boot" }).catch((e) => console.error("[mail-poll] boot tick failed:", e)), 8000);
  }
  return task;
}
