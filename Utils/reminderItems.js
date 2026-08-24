// Single source of truth for the client-reminder catalogue.
//
// Every other layer reads its item list from HERE and nowhere else:
//   • Schema_Models/ClientReminderConfig.js  - enum + per-item defaults
//   • Utils/reminderTemplates.js             - copy + render dispatch
//   • src/services/clientReminderWorker.js   - cadence + due evaluation
//   • Controllers/operations/ClientReminders.js - ships the catalogue to the UI
//   • the Operations > Client Reminders tab   - renders rows from the API payload
//
// Nothing in this file touches Mongo, the network or process.env, so it is
// safe to import from a test with no setup.

/**
 * cadence:
 *   daily   - once per IST calendar day at sendAtIST
 *   weekly  - once per ISO week, on dayOfWeek at sendAtIST
 *   monthly - once per IST calendar month, on dayOfMonth at sendAtIST
 *   event   - evaluated on every tick; fires when its own condition trips
 *             (quiet hours still apply, see QUIET_HOURS_IST)
 *
 * activityGated: when true the worker refuses to send an empty report.
 *   "Nothing was added and nothing was applied" means the client hears
 *   nothing at all - an empty digest is worse than silence.
 *
 * scheduleFields: which schedule controls the UI must render for this item.
 */
export const REMINDER_ITEMS = [
  {
    key: "daily_summary",
    label: "Daily activity summary",
    description:
      "Jobs added and applications submitted for the client today, with the companies and roles.",
    cadence: "daily",
    activityGated: true,
    scheduleFields: ["sendAtIST"],
    defaults: {
      enabled: true,
      channels: { mattermost: true, email: true },
      sendAtIST: "21:30"
    }
  },
  {
    key: "weekly_report",
    label: "Weekly progress report",
    description:
      "Seven-day rollup: totals, a day-by-day breakdown and the companies applied to most.",
    cadence: "weekly",
    activityGated: true,
    scheduleFields: ["dayOfWeek", "sendAtIST"],
    defaults: {
      enabled: true,
      channels: { mattermost: true, email: true },
      dayOfWeek: 1, // Monday
      sendAtIST: "10:00"
    }
  },
  {
    key: "monthly_report",
    label: "Monthly performance report",
    description:
      "Previous calendar month in full: applications, interviews, offers and week-by-week momentum.",
    cadence: "monthly",
    activityGated: true,
    scheduleFields: ["dayOfMonth", "sendAtIST"],
    defaults: {
      enabled: false,
      channels: { mattermost: true, email: true },
      dayOfMonth: 1,
      sendAtIST: "10:30"
    }
  },
  {
    key: "interview_digest",
    label: "Interview & offer pipeline",
    description:
      "Every card that reached interview, assignment or offer in the last seven days.",
    cadence: "weekly",
    activityGated: true,
    scheduleFields: ["dayOfWeek", "sendAtIST"],
    defaults: {
      enabled: false,
      channels: { mattermost: true, email: false },
      dayOfWeek: 5, // Friday
      sendAtIST: "18:00"
    }
  },
  {
    key: "plan_usage",
    label: "Plan usage & remaining quota",
    description:
      "Applications used against the client's plan cap, plus what is left. Skipped while the count is zero.",
    cadence: "weekly",
    activityGated: false,
    scheduleFields: ["dayOfWeek", "sendAtIST"],
    defaults: {
      enabled: false,
      channels: { mattermost: true, email: false },
      dayOfWeek: 0, // Sunday
      sendAtIST: "19:00"
    }
  },
  {
    key: "milestone",
    label: "Application milestones",
    description:
      "Fires once each time the client's lifetime application count crosses 25, 50, 100, 150, 200, 250, 300, 400, 500, 750 or 1000.",
    cadence: "event",
    activityGated: false,
    scheduleFields: [],
    defaults: {
      enabled: false,
      channels: { mattermost: true, email: true }
    }
  },
  {
    key: "inactivity_alert",
    label: "No-activity alert",
    description:
      "Internal warning when nothing has been added or applied for N consecutive days. Off by default. Goes to the FlashFire team only - the email channel delivers to the team inbox, never to the client.",
    cadence: "daily",
    activityGated: false,
    /**
     * Internal items are FOR US, never for the client. The worker routes the
     * email channel of an internal item to OPS_ALERT_EMAIL (falling back to
     * SMTP_USER) and never to the client's payment address - so ticking the
     * email box on this row cannot leak "we went quiet on your account" into
     * a paying client's inbox. The UI labels the checkbox accordingly.
     */
    internal: true,
    scheduleFields: ["inactivityDays", "sendAtIST"],
    defaults: {
      enabled: false,
      channels: { mattermost: true, email: false },
      inactivityDays: 3,
      sendAtIST: "11:00"
    }
  }
];

/** Lifetime application counts that trigger the `milestone` item, ascending. */
export const MILESTONE_THRESHOLDS = [25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000];

/**
 * Event-cadence items never deliver outside this IST window. A milestone that
 * trips at 03:00 waits for 08:00 rather than pinging a client at night.
 */
export const QUIET_HOURS_IST = { startHour: 8, endHour: 22 };

export const REMINDER_ITEM_KEYS = REMINDER_ITEMS.map((i) => i.key);

const BY_KEY = new Map(REMINDER_ITEMS.map((i) => [i.key, i]));

/** Metadata for one item, or null when the key is unknown. Never throws. */
export function reminderItemMeta(key) {
  return BY_KEY.get(String(key || "")) || null;
}

export function isReminderItemKey(key) {
  return BY_KEY.has(String(key || ""));
}

/**
 * A fully-populated config row for one item, defaults filled in. Every field
 * the schema knows about is present, so callers never branch on undefined.
 * @returns {object|null} null for an unknown key.
 */
export function defaultItemConfig(key) {
  const meta = reminderItemMeta(key);
  if (!meta) return null;
  const d = meta.defaults || {};
  return {
    key: meta.key,
    enabled: d.enabled === true,
    channels: {
      mattermost: d.channels?.mattermost === true,
      email: d.channels?.email === true
    },
    sendAtIST: d.sendAtIST || "09:00",
    dayOfWeek: Number.isInteger(d.dayOfWeek) ? d.dayOfWeek : 1,
    dayOfMonth: Number.isInteger(d.dayOfMonth) ? d.dayOfMonth : 1,
    inactivityDays: Number.isInteger(d.inactivityDays) ? d.inactivityDays : 3,
    lastPeriodKey: "",
    lastSentAt: null,
    lastStatus: "",
    lastError: ""
  };
}

/** The default item list for a brand-new client config, in catalogue order. */
export function defaultItems() {
  return REMINDER_ITEM_KEYS.map((k) => defaultItemConfig(k));
}

/** "HH:mm" in 24h, 00:00–23:59. */
export function isValidSendAt(v) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(v || ""));
}

/** Parse "HH:mm" → {hour, minute}; null when malformed. */
export function parseSendAt(v) {
  if (!isValidSendAt(v)) return null;
  const [h, m] = String(v).split(":");
  return { hour: Number(h), minute: Number(m) };
}
