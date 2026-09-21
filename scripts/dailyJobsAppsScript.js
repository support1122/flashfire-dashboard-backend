/**
 * FlashFire — Daily Prev-24h Jobs → Google Sheet
 *
 * Setup:
 *  1. Open Google Sheet → Extensions → Apps Script.
 *  2. Paste this whole file. Save.
 *  3. Run `setupDailyTrigger` once (authorize when prompted).
 *     Installs a time-driven trigger at ~12 AM daily.
 *  4. (Optional) Run `runDailyJobsSync` manually to test.
 *
 * Endpoint hit:
 *   GET https://dashboard-api.flashfirejobs.com/get/prev24hourjobs?email=...
 *
 * Sheet columns written: Company Name | URL | Position
 */

const CONFIG = {
  BACKEND_URL: 'https://dashboard-api.flashfirejobs.com',
  EMAIL: 'tejaveluri99@gmail.com',
  SHEET_NAME: 'Daily Jobs',
  HOURS: 24,
  // 'replace'  → wipe sheet, write headers + today's rows
  // 'append'   → keep history, append today's rows under existing data
  MODE: 'replace',
  TIMEZONE: Session.getScriptTimeZone(),
};

function runDailyJobsSync() {
  const url = CONFIG.BACKEND_URL.replace(/\/+$/, '') +
    '/get/prev24hourjobs?email=' + encodeURIComponent(CONFIG.EMAIL) +
    '&hours=' + encodeURIComponent(CONFIG.HOURS);

  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'Accept': 'application/json' },
  });

  const code = resp.getResponseCode();
  const body = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Backend ' + code + ': ' + body.slice(0, 500));
  }

  let data;
  try { data = JSON.parse(body); }
  catch (e) { throw new Error('Bad JSON from backend: ' + body.slice(0, 300)); }

  if (!data || data.success !== true) {
    throw new Error('Backend error: ' + (data && data.message ? data.message : body.slice(0, 300)));
  }

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  writeToSheet_(jobs);
  Logger.log('Wrote %s rows for %s', jobs.length, CONFIG.EMAIL);
}

function writeToSheet_(jobs) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME);

  const headers = ['Company Name', 'URL', 'Position'];
  const rows = jobs.map(function (j) {
    return [j.companyName || '', j.url || '', j.position || ''];
  });

  if (CONFIG.MODE === 'append') {
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    }
    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
    }
    return;
  }

  // replace mode
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, headers.length);
}

/** Run once: install daily 12 AM trigger. Safe to re-run (clears old triggers for this fn). */
function setupDailyTrigger() {
  const fn = 'runDailyJobsSync';
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyDays(1)
    .atHour(0) // 12 AM script TZ
    .create();
  Logger.log('Trigger installed for %s @ 00:00 (%s)', fn, CONFIG.TIMEZONE);
}
