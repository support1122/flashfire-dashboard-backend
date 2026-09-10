import { AutopilotWorker, WORKER_ONLINE_SECONDS } from "../Schema_Models/AutopilotWorker.js";
import { AutopilotAssignment } from "../Schema_Models/AutopilotAssignment.js";

// Worker ("profile") registry, client assignment, and the heartbeat that lets
// every machine see what the others are doing.
//
// See Schema_Models/AutopilotWorker.js for why this exists and why "worker" in
// code means "Profile" in the UI.
//
// All routes sit behind requireOpsKey: only the autopilot app calls them, and
// it holds the key already.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

// Turn a display name into a stable id. Computed once at creation; renaming a
// worker later keeps the slug, so assignments never orphan.
const slugify = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const cleanEmail = (raw) => String(raw || "").toLowerCase().trim();

/** A worker is online when its last heartbeat is recent enough. */
const isOnline = (lastSeenAt) =>
  Boolean(lastSeenAt) && Date.now() - new Date(lastSeenAt).getTime() < WORKER_ONLINE_SECONDS * 1000;

const shapeWorker = (w, counts) => ({
  slug: w.slug,
  name: w.name,
  note: w.note || "",
  host: w.host || "",
  lastSeenAt: w.lastSeenAt || null,
  online: isOnline(w.lastSeenAt),
  // Only trust the running list while the beat is fresh. A machine that was
  // closed mid-run leaves its last heartbeat behind, and showing "running 3"
  // for a dead laptop is worse than showing nothing.
  running: isOnline(w.lastSeenAt) ? w.running || [] : [],
  queued: isOnline(w.lastSeenAt) ? w.queued || [] : [],
  lanes: w.lanes || 0,
  appVersion: w.appVersion || "",
  assignedCount: counts?.get(w.slug) || 0
});

/**
 * GET /autopilot/workers
 *
 * Every profile plus its live state and how many clients it owns. This is what
 * fills the "choose profile" screen, so it must answer even when nothing has
 * ever checked in.
 */
export const listAutopilotWorkers = async (_req, res) => {
  try {
    const [workers, counts] = await Promise.all([
      AutopilotWorker.find({}).sort({ name: 1 }).lean(),
      AutopilotAssignment.aggregate([{ $group: { _id: "$worker", n: { $sum: 1 } } }])
    ]);
    const byWorker = new Map(counts.map((c) => [c._id, c.n]));

    // Assignments pointing at a worker that no longer exists read as
    // unassigned everywhere else, so surface the number rather than letting
    // those clients quietly vanish from every list.
    const known = new Set(workers.map((w) => w.slug));
    const orphaned = counts.filter((c) => !known.has(c._id)).reduce((a, c) => a + c.n, 0);

    res.status(200).json({
      success: true,
      onlineSeconds: WORKER_ONLINE_SECONDS,
      orphanedAssignments: orphaned,
      count: workers.length,
      data: workers.map((w) => shapeWorker(w, byWorker))
    });
  } catch (error) {
    console.error("listAutopilotWorkers failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /autopilot/workers   { name, note?, createdBy? }
 *
 * Admin creates a profile. Returns 409 on a duplicate rather than silently
 * handing back the existing one, so the admin knows the name is taken.
 */
export const createAutopilotWorker = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "name is required" });

    const slug = slugify(name);
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({
        success: false,
        message: "name must contain at least two letters or digits"
      });
    }
    // "admin" is the built-in view, not a real worker - a profile by that name
    // would shadow it in the chooser.
    if (slug === "admin") {
      return res.status(400).json({ success: false, message: "'admin' is reserved" });
    }

    const doc = await AutopilotWorker.create({
      slug,
      name,
      note: String(req.body?.note || "").trim(),
      createdBy: String(req.body?.createdBy || "").slice(0, 200)
    });
    res.status(201).json({ success: true, data: shapeWorker(doc.toObject(), new Map()) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "a profile with that name already exists" });
    }
    console.error("createAutopilotWorker failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /autopilot/workers/:slug
 *
 * Removing a profile releases its clients back to Unassigned in the same
 * operation. Leaving them pointing at a deleted worker would hide them from
 * every list at once.
 */
export const deleteAutopilotWorker = async (req, res) => {
  try {
    const slug = String(req.params.slug || "").toLowerCase().trim();
    const worker = await AutopilotWorker.findOne({ slug }).lean();
    if (!worker) return res.status(404).json({ success: false, message: "no such profile" });

    if (isOnline(worker.lastSeenAt) && (worker.running || []).length) {
      return res.status(409).json({
        success: false,
        message: `${worker.name} is running ${worker.running.length} client(s) right now. Stop them first.`
      });
    }

    const released = await AutopilotAssignment.deleteMany({ worker: slug });
    await AutopilotWorker.deleteOne({ slug });
    res.status(200).json({ success: true, released: released.deletedCount || 0 });
  } catch (error) {
    console.error("deleteAutopilotWorker failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /autopilot/assignments[?worker=slug]
 *
 * The whole map, or one worker's clients. The app calls this on every roster
 * refresh, so it stays a single lean query.
 */
export const listAutopilotAssignments = async (req, res) => {
  try {
    const filter = {};
    if (req.query.worker) filter.worker = String(req.query.worker).toLowerCase().trim();
    const rows = await AutopilotAssignment.find(filter).lean();
    res.status(200).json({
      success: true,
      count: rows.length,
      data: rows.map((r) => ({ clientEmail: r.clientEmail, worker: r.worker, assignedBy: r.assignedBy || "" }))
    });
  } catch (error) {
    console.error("listAutopilotAssignments failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /autopilot/assignments   { assignments: [{ clientEmail, worker }], assignedBy? }
 *
 * Bulk set. `worker` empty or null unassigns that client. Written as one
 * bulkWrite so the admin dragging 50 clients across is one round trip and
 * either all of it lands or none does.
 */
export const setAutopilotAssignments = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.assignments) ? req.body.assignments : null;
    if (!rows || !rows.length) {
      return res.status(400).json({ success: false, message: "assignments must be a non-empty array" });
    }
    if (rows.length > 1000) {
      return res.status(400).json({ success: false, message: "at most 1000 assignments per call" });
    }
    const assignedBy = String(req.body?.assignedBy || "").slice(0, 200);

    // Validate every target before writing anything: a typo'd worker slug
    // would otherwise hide those clients from every list.
    const wanted = new Set(
      rows.map((r) => String(r?.worker || "").toLowerCase().trim()).filter(Boolean)
    );
    if (wanted.size) {
      const known = await AutopilotWorker.find({ slug: { $in: [...wanted] } }, { slug: 1 }).lean();
      const knownSet = new Set(known.map((w) => w.slug));
      const missing = [...wanted].filter((s) => !knownSet.has(s));
      if (missing.length) {
        return res.status(400).json({ success: false, message: `unknown profile(s): ${missing.join(", ")}` });
      }
    }

    const ops = [];
    let assigned = 0;
    let cleared = 0;
    for (const r of rows) {
      const clientEmail = cleanEmail(r?.clientEmail);
      if (!clientEmail.includes("@")) continue;
      const worker = String(r?.worker || "").toLowerCase().trim();
      if (!worker) {
        ops.push({ deleteOne: { filter: { clientEmail } } });
        cleared += 1;
      } else {
        ops.push({
          updateOne: {
            filter: { clientEmail },
            update: { $set: { clientEmail, worker, assignedBy } },
            upsert: true
          }
        });
        assigned += 1;
      }
    }
    if (!ops.length) {
      return res.status(400).json({ success: false, message: "no valid client emails in the request" });
    }

    await AutopilotAssignment.bulkWrite(ops, { ordered: false });
    res.status(200).json({ success: true, assigned, cleared });
  } catch (error) {
    console.error("setAutopilotAssignments failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /autopilot/workers/:slug/heartbeat   { host?, running?, queued?, lanes?, appVersion? }
 *
 * The running app checks in every ~20s. This is the only way one machine
 * learns another is busy, so it upserts: a worker whose row was deleted while
 * it was mid-run reappears rather than beating into a void.
 */
export const autopilotWorkerHeartbeat = async (req, res) => {
  try {
    const slug = String(req.params.slug || "").toLowerCase().trim();
    if (!SLUG_RE.test(slug)) return res.status(400).json({ success: false, message: "bad profile id" });

    const asEmails = (v) =>
      (Array.isArray(v) ? v : []).map(cleanEmail).filter((e) => e.includes("@")).slice(0, 200);

    const doc = await AutopilotWorker.findOneAndUpdate(
      { slug },
      {
        $set: {
          host: String(req.body?.host || "").slice(0, 120),
          lastSeenAt: new Date(),
          running: asEmails(req.body?.running),
          queued: asEmails(req.body?.queued),
          lanes: Number.isFinite(Number(req.body?.lanes)) ? Number(req.body.lanes) : 0,
          appVersion: String(req.body?.appVersion || "").slice(0, 40)
        },
        // Only on insert, so a heartbeat never overwrites the admin's name.
        $setOnInsert: { name: slug, note: "auto-registered by a running app" }
      },
      { new: true, upsert: true }
    ).lean();

    res.status(200).json({ success: true, slug: doc.slug });
  } catch (error) {
    if (error?.code === 11000) {
      // Two heartbeats racing the same upsert. The other one won; nothing to do.
      return res.status(200).json({ success: true, slug: String(req.params.slug || "") });
    }
    console.error("autopilotWorkerHeartbeat failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
