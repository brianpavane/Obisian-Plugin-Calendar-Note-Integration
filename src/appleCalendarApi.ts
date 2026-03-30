/**
 * @file appleCalendarApi.ts
 * @description Read events from Apple Calendar (Calendar.app) on macOS via
 * JavaScript for Automation (JXA) running through osascript.
 *
 * No network calls, no API keys, no OAuth required. Calendar.app already
 * handles authentication for all synced accounts (Google, iCloud, Exchange).
 *
 * Security notes:
 *   - The JXA script template only interpolates validated integers (daysBack,
 *     LOOKAHEAD_DAYS) — never user strings — eliminating injection risk.
 *   - Output is capped at MAX_OUTPUT_BYTES before JSON.parse to prevent OOM.
 *   - Every field read from the JXA response is type-checked and length-capped.
 *   - Date strings are validated through Date.parse before use.
 *   - execFile (not exec) is used so no shell expansion takes place.
 */

import { execFile } from "child_process";
import type { CalendarEvent, ResponseStatus } from "./icalParser";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB
const LOOKAHEAD_DAYS = 365;

// ---------------------------------------------------------------------------
// Conference URL patterns (mirrors icalParser.ts)
// ---------------------------------------------------------------------------

const CONFERENCE_PATTERNS: Array<{ regex: RegExp; name: string }> = [
  { regex: /https:\/\/meet\.google\.com\/[a-z0-9-]+/i, name: "Google Meet" },
  { regex: /https:\/\/[\w.-]+\.zoom\.us\/[^\s<>"]{5,100}/i, name: "Zoom" },
  { regex: /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"]{5,200}/i, name: "Microsoft Teams" },
  { regex: /https:\/\/teams\.live\.com\/meet\/[^\s<>"]{5,100}/i, name: "Microsoft Teams" },
];

function extractConferenceFromText(text: string): CalendarEvent["conferenceData"] | undefined {
  for (const { regex, name } of CONFERENCE_PATTERNS) {
    const match = text.match(regex);
    if (match) {
      return {
        entryPoints: [{ entryPointType: "video", uri: match[0] }],
        conferenceSolution: { name },
      };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// JXA script builder — only integers are interpolated
// ---------------------------------------------------------------------------

/**
 * Build the JXA fetch-events script.
 *
 * Only safe integers and a JSON-encoded string array are interpolated.
 *
 * @param daysBack        Days before today to start the window. Clamped [0,30].
 * @param daysAhead       Days after today to end the window. Clamped [1,365].
 * @param calendarFilter  Names of calendars to query. Empty = all calendars.
 *                        Embedded as JSON — values come from Calendar.app itself.
 */
/** Hard cap on events scanned in Tier 3 (cal.events() full-scan fallback). */
const MAX_TIER3_SCAN = 5_000;

function buildJxaFetchEvents(daysBack: number, daysAhead: number, calendarFilter: string[] = []): string {
  const safeDaysBack  = Math.max(0,   Math.min(30,  Math.floor(daysBack)));
  const safeDaysAhead = Math.max(1,   Math.min(365, Math.floor(daysAhead)));
  // JSON.stringify is safe here: values are calendar names returned by Calendar.app
  const filterJson    = JSON.stringify(calendarFilter);

  return `
(function () {
  var app = Application("Calendar");
  var now = new Date();
  var windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ${safeDaysBack});
  var windowEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ${safeDaysAhead});

  // Calendar names to query. Empty array = all calendars (no filter).
  var filterNames = ${filterJson};

  // Build a calendar ID → name lookup first (fast — no event data loaded).
  var calMap = {};
  try {
    app.calendars().forEach(function (cal) {
      var id = "", name = "";
      try { id   = String(cal.id()   || ""); } catch (e) {}
      try { name = String(cal.name() || ""); } catch (e) {}
      if (id) calMap[id] = name;
    });
  } catch (e) {}

  // Each entry: { evt, calId, calName }
  // Calendar info is resolved differently depending on which tier succeeded.
  var pairs = [];

  // ── Tier 1: app.eventsFrom(start, {to:end}) ──────────────────────────────
  // Fastest path — application-level date-range query. Fails with
  // "Can't convert types" on some Exchange / Office 365 accounts.
  var tier1ok = false;
  try {
    var t1evts = app.eventsFrom(windowStart, { to: windowEnd });
    for (var i = 0; i < t1evts.length; i++) {
      var evt = t1evts[i];
      var calId = "", calName = "";
      try {
        calId   = String(evt.container.id()   || "");
        calName = String(evt.container.name() || "");
      } catch (ce) {
        try {
          var spec = String(evt.specifier());
          var m = spec.match(/calendar id "([^"]+)"/);
          if (m) { calId = m[1]; calName = calMap[calId] || ""; }
        } catch (ce2) {}
      }
      pairs.push({ evt: evt, calId: calId, calName: calName });
    }
    tier1ok = true;
  } catch (e1) {}

  // ── Tiers 2 / 2.5 / 3: per-calendar fallback ─────────────────────────────
  // Used when Tier 1 fails. Only calendars in filterNames are queried.
  // Each calendar tries three progressively slower strategies:
  //
  //   Tier 2  — cal.eventsFrom(start, {to:end})
  //             Fast server-side range query. Fails with "Can't convert types"
  //             on some Exchange / Office 365 accounts.
  //
  //   Tier 2.5 — cal.events.whose({_and:[{startDate >= start},{startDate <= end}]})()
  //             Predicate filter evaluated at the scripting-bridge level.
  //             Works on many accounts where eventsFrom() fails.
  //
  //   Tier 3  — cal.events() + JS date filter (hard scan cap: ${MAX_TIER3_SCAN})
  //             Loads every event then filters in JS. Slow on large calendars.
  //             Capped to avoid an indefinite hang — partial results possible.
  if (!tier1ok) {
    var MAX_SCAN = ${MAX_TIER3_SCAN};
    var cals = [];
    try { cals = app.calendars(); } catch (e) {}
    for (var ci = 0; ci < cals.length; ci++) {
      var cal = cals[ci];
      var cId = "", cName = "";
      try { cId   = String(cal.id()   || ""); } catch (e) {}
      try { cName = String(cal.name() || ""); } catch (e) {}

      // Skip calendars not in the active filter
      if (filterNames.length > 0 && filterNames.indexOf(cName) === -1) continue;

      var calEvts = null;

      // Tier 2: cal.eventsFrom
      try {
        calEvts = cal.eventsFrom(windowStart, { to: windowEnd });
      } catch (e2) { calEvts = null; }

      // Tier 2.5: whose-predicate filter (works on accounts where eventsFrom fails)
      if (calEvts === null) {
        try {
          calEvts = cal.events.whose({
            _and: [
              { startDate: { _greaterThanEquals: windowStart } },
              { startDate: { _lessThanEquals:    windowEnd   } }
            ]
          })();
        } catch (e25) { calEvts = null; }
      }

      // Tier 3: full scan with a hard cap to prevent indefinite hang
      if (calEvts === null) {
        calEvts = [];
        try {
          var allEvts = cal.events();
          var scanLimit = Math.min(allEvts.length, MAX_SCAN);
          for (var j = 0; j < scanLimit; j++) {
            try {
              var sd = allEvts[j].startDate();
              if (sd && sd >= windowStart && sd <= windowEnd) {
                calEvts.push(allEvts[j]);
              }
            } catch (e3) {}
          }
        } catch (e3) {}
      }

      for (var k = 0; k < calEvts.length; k++) {
        pairs.push({ evt: calEvts[k], calId: cId, calName: cName });
      }
    }
  }

  // ── Build result objects ──────────────────────────────────────────────────
  var results = [];
  for (var pi = 0; pi < pairs.length; pi++) {
    try {
      var p = pairs[pi];
      var item = {
        uid: "", summary: "",
        startDate: windowStart.toISOString(), endDate: windowStart.toISOString(),
        allDayEvent: false, description: "", location: "",
        calendarName: p.calName, calendarId: p.calId,
        attendees: []
      };

      try { item.uid         = String(p.evt.uid()         || ""); } catch (e) {}
      try { item.summary     = String(p.evt.summary()     || ""); } catch (e) {}
      try { var sd = p.evt.startDate(); if (sd) item.startDate = sd.toISOString(); } catch (e) {}
      try { var ed = p.evt.endDate();   if (ed) item.endDate   = ed.toISOString(); } catch (e) {}
      try { item.allDayEvent = p.evt.allDayEvent() === true;                        } catch (e) {}
      try { item.description = String(p.evt.description() || ""); } catch (e) {}
      try { item.location    = String(p.evt.location()    || ""); } catch (e) {}
      try {
        var atts = p.evt.attendees();
        if (atts) {
          item.attendees = atts.map(function (a) {
            return {
              displayName: String(a.displayName()         || ""),
              address:     String(a.address()             || ""),
              status:      String(a.participationStatus() || "unknown")
            };
          });
        }
      } catch (e) {}

      results.push(item);
    } catch (e) {}
  }

  return JSON.stringify(results);
})();
`.trim();
}

/** Returns a JSON array of { name, id } for every calendar in Calendar.app. */
const JXA_LIST_CALENDARS = `
(function () {
  var app = Application("Calendar");
  return JSON.stringify(
    app.calendars().map(function (c) {
      var name = "", id = "";
      try { name = c.name(); } catch (e) {}
      try { id   = c.id();   } catch (e) {}
      return { name: name, id: id };
    })
  );
})();
`.trim();

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RawJxaEvent {
  uid: string;
  summary: string;
  startDate: string;
  endDate: string;
  allDayEvent: boolean;
  description: string;
  location: string;
  calendarName: string;
  calendarId: string;
  attendees: Array<{ displayName: string; address: string; status: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maximum time to wait for osascript to respond before aborting. */
const OSASCRIPT_TIMEOUT_MS = 30_000;

function runOsascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", script],
      { maxBuffer: MAX_OUTPUT_BYTES, timeout: OSASCRIPT_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          if ((err as Error & { killed?: boolean }).killed) {
            reject(new Error(
              "Apple Calendar request timed out after 30 seconds. " +
              "Calendar.app may be busy — try again in a moment."
            ));
            return;
          }
          reject(new Error(
            err.message.includes("1743")
              ? "Calendar access denied. In System Settings → Privacy & Security → Calendars, " +
                "set Obsidian to 'Full Calendar Access' (not 'Add Only')."
              : `Apple Calendar error: ${err.message}`
          ));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function safeStr(v: unknown, maxLen = 5_000): string {
  return typeof v === "string" ? v.slice(0, maxLen) : "";
}

function mapAppleStatus(status: string): ResponseStatus {
  switch (status.toLowerCase()) {
    case "accepted":  return "accepted";
    case "declined":  return "declined";
    case "tentative": return "tentative";
    default:          return "needsAction";
  }
}

function parseJxaEvents(json: string, calendarFilter: string[]): CalendarEvent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error(
      "Apple Calendar: could not parse calendar data. " +
      "Check the developer console (Ctrl+Shift+I) for details."
    );
  }

  if (!Array.isArray(raw)) {
    throw new Error("Apple Calendar: unexpected response format.");
  }

  const events: CalendarEvent[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;

    const calName = safeStr(r.calendarName);
    if (calendarFilter.length > 0 && !calendarFilter.includes(calName)) {
      continue;
    }

    const startStr = safeStr(r.startDate);
    const endStr   = safeStr(r.endDate);
    const startMs  = Date.parse(startStr);
    if (isNaN(startMs)) continue;

    const allDay = r.allDayEvent === true;
    let start: CalendarEvent["start"];
    let end: CalendarEvent["end"];

    if (allDay) {
      const s = new Date(startMs);
      const pad = (n: number) => String(n).padStart(2, "0");
      const toDateStr = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      start = { date: toDateStr(s) };
      const endMs = Date.parse(endStr);
      end = { date: toDateStr(isNaN(endMs) ? s : new Date(endMs)) };
    } else {
      start = { dateTime: new Date(startMs).toISOString() };
      const endMs = Date.parse(endStr);
      end = { dateTime: isNaN(endMs) ? new Date(startMs).toISOString() : new Date(endMs).toISOString() };
    }

    const attendees: NonNullable<CalendarEvent["attendees"]> = [];
    if (Array.isArray(r.attendees)) {
      for (const a of r.attendees) {
        if (typeof a !== "object" || a === null) continue;
        const ar = a as Record<string, unknown>;
        const email = safeStr(ar.address, 200).trim();
        if (!email) continue;
        attendees.push({
          email,
          displayName: safeStr(ar.displayName, 200) || undefined,
          responseStatus: mapAppleStatus(safeStr(ar.status)),
        });
      }
    }

    const uid = safeStr(r.uid, 500) || `apple-${startMs}-${Math.random().toString(36).slice(2)}`;
    const description = safeStr(r.description, 50_000) || undefined;

    events.push({
      id: uid,
      summary:     safeStr(r.summary,  500)   || undefined,
      description,
      location:    safeStr(r.location, 1_000) || undefined,
      start,
      end,
      attendees: attendees.length > 0 ? attendees : undefined,
      // Detect conference links from the event description
      conferenceData: description ? extractConferenceFromText(description) : undefined,
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AppleCalendar {
  name: string;
  id: string;
}

/**
 * Three-step diagnostic for Apple Calendar access.
 * Safe to run independently of the main fetch — each step has its own timeout.
 * Results are also logged to the developer console (Ctrl+Shift+I → Console).
 */
export async function runAppleCalendarDiagnostic(): Promise<string> {
  const lines: string[] = ["Apple Calendar Diagnostic", "─".repeat(40)];

  const log = (line: string) => {
    lines.push(line);
    console.log("[GoogleCalendarNotes] DIAG", line);
  };

  // Step 1 — basic JXA execution
  log("Step 1: Testing JXA execution…");
  try {
    const t0 = Date.now();
    const result = await runOsascript(`(function(){ return "jxa-ok"; })()`);
    log(`  ✓ JXA works (${Date.now() - t0}ms): ${result}`);
  } catch (err) {
    log(`  ✗ JXA failed: ${err instanceof Error ? err.message : String(err)}`);
    lines.push("", "Cannot reach Calendar.app at all. Check osascript is available.");
    return lines.join("\n");
  }

  // Step 2 — list calendars
  log("Step 2: Listing calendars…");
  try {
    const t0 = Date.now();
    const json = await runOsascript(JXA_LIST_CALENDARS);
    const cals = JSON.parse(json) as Array<{ name: string; id: string }>;
    log(`  ✓ Found ${cals.length} calendar(s) in ${Date.now() - t0}ms:`);
    cals.forEach((c, i) => log(`     [${i}] "${c.name}"`));
  } catch (err) {
    log(`  ✗ Failed: ${err instanceof Error ? err.message : String(err)}`);
    lines.push("", "Cannot list calendars. Verify Obsidian has Calendars permission in");
    lines.push("System Settings → Privacy & Security → Calendars.");
    return lines.join("\n");
  }

  // Step 3 — probe all fetch tiers per calendar
  log("Step 3: Probing all fetch strategies per calendar (next 7 days)…");
  log("  (Tier 1 = app.eventsFrom, Tier 2 = cal.eventsFrom, 2.5 = whose-predicate, 3 = full scan)");
  const probeScript = `
(function(){
  var app = Application("Calendar");
  var now = new Date();
  var s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var e = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  var out = {};

  // Tier 1: app.eventsFrom
  try {
    out.tier1 = app.eventsFrom(s, { to: e }).length;
  } catch(ex) { out.tier1err = String(ex); }

  // Per-calendar: probe Tier 2, 2.5, and event count for Tier 3 warning
  var cals = [];
  try { cals = app.calendars(); } catch(ex) {}
  var calResults = [];
  for (var i = 0; i < cals.length; i++) {
    var name = "?";
    try { name = String(cals[i].name()); } catch(ex) {}
    var r = { name: name };

    // Tier 2: cal.eventsFrom
    try {
      r.t2count = cals[i].eventsFrom(s, { to: e }).length;
    } catch(ex) { r.t2err = String(ex); }

    // Tier 2.5: whose predicate (only test if Tier 2 failed)
    if (r.t2err !== undefined) {
      try {
        r.t25count = cals[i].events.whose({
          _and: [
            { startDate: { _greaterThanEquals: s } },
            { startDate: { _lessThanEquals:    e } }
          ]
        })().length;
      } catch(ex) { r.t25err = String(ex); }
    }

    // Report total event count so user knows if Tier 3 would be slow
    if (r.t2err !== undefined && r.t25err !== undefined) {
      try { r.totalEvents = cals[i].events.length; } catch(ex) { r.totalEvents = -1; }
    }

    calResults.push(r);
  }
  out.cals = calResults;
  return JSON.stringify(out);
})();`.trim();
  try {
    const t0 = Date.now();
    const json = await runOsascript(probeScript);
    type CalResult = {
      name: string;
      t2count?: number; t2err?: string;
      t25count?: number; t25err?: string;
      totalEvents?: number;
    };
    const r = JSON.parse(json) as {
      tier1?: number; tier1err?: string;
      cals?: CalResult[];
    };
    log(`  Completed in ${Date.now() - t0}ms`);

    if (r.tier1 !== undefined) {
      log(`  Tier 1 (app.eventsFrom): ✓ ${r.tier1} event(s) — fastest path active`);
    } else {
      log(`  Tier 1 (app.eventsFrom): ✗ ${(r.tier1err ?? "failed").slice(0, 100)}`);
    }

    if (r.cals) {
      r.cals.forEach((c) => {
        if (c.t2count !== undefined) {
          log(`  "${c.name}": Tier 2 ✓ (${c.t2count} events)`);
        } else if (c.t25count !== undefined) {
          log(`  "${c.name}": Tier 2 ✗ → Tier 2.5 (whose) ✓ (${c.t25count} events)`);
        } else if (c.t2err !== undefined) {
          const total = c.totalEvents ?? -1;
          log(`  "${c.name}": Tier 2 ✗ → Tier 2.5 ✗ → will use Tier 3 (full scan)`);
          if (total > 0) {
            log(`    ⚠ ${total} total events to scan — may timeout if > ${MAX_TIER3_SCAN}`);
          } else if (total < 0) {
            log(`    ⚠ Could not read event count — Tier 3 may timeout`);
          }
          log(`    Tier 2 error: ${(c.t2err ?? "").slice(0, 80)}`);
          log(`    Tier 2.5 error: ${(c.t25err ?? "").slice(0, 80)}`);
        }
      });
    }
  } catch (err) {
    log(`  ✗ Probe timed out: ${err instanceof Error ? err.message : String(err)}`);
  }

  lines.push("", "Full log also visible in Obsidian developer console (Ctrl+Shift+I → Console).");
  return lines.join("\n");
}

export async function listAppleCalendars(): Promise<AppleCalendar[]> {
  const json = await runOsascript(JXA_LIST_CALENDARS);
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null
    )
    .map((item) => ({
      name: safeStr(item.name, 200),
      id:   safeStr(item.id,   500),
    }))
    .filter((c) => c.name);
}

/**
 * Read-only client that sources events from Apple Calendar (Calendar.app).
 *
 * @param calendarFilter Optional list of calendar names to include.
 *                       Pass an empty array to include all calendars.
 * @param daysBack       How many days back to fetch (0 = today onwards).
 */
export class AppleCalendarApi {
  private readonly calendarFilter: string[];
  private readonly daysBack: number;
  private readonly daysAhead: number;

  constructor(calendarFilter: string[] = [], daysBack = 0, daysAhead = 30) {
    this.calendarFilter = calendarFilter;
    this.daysBack = daysBack;
    this.daysAhead = daysAhead;
  }

  async fetchAllEvents(): Promise<CalendarEvent[]> {
    const tag = "[GoogleCalendarNotes] Apple Calendar";
    const filter = this.calendarFilter.length > 0
      ? `filter: [${this.calendarFilter.join(", ")}]`
      : "filter: all calendars";
    console.log(`${tag} fetchAllEvents() — ${filter}, daysBack=${this.daysBack}`);

    console.log(`${tag} → window: -${this.daysBack}d … +${this.daysAhead}d, timeout ${OSASCRIPT_TIMEOUT_MS / 1000}s`);
    const t0 = Date.now();
    let json: string;
    try {
      json = await runOsascript(buildJxaFetchEvents(this.daysBack, this.daysAhead, this.calendarFilter));
    } catch (err) {
      console.error(`${tag} ✗ osascript failed after ${Date.now() - t0}ms:`, err);
      throw err;
    }
    console.log(`${tag} ✓ osascript returned ${json.length} bytes in ${Date.now() - t0}ms`);

    console.log(`${tag} → parsing JSON…`);
    const events = parseJxaEvents(json, this.calendarFilter);
    console.log(`${tag} ✓ parsed ${events.length} event(s)`);
    return events;
  }

  async listEventsInTimeWindow(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    const all = await this.fetchAllEvents();
    return all.filter((event) => {
      if (event.start.dateTime) {
        const s = new Date(event.start.dateTime);
        return s >= timeMin && s <= timeMax;
      }
      if (event.start.date) {
        const dayStart = new Date(event.start.date + "T00:00:00");
        const dayEnd   = new Date(event.start.date + "T23:59:59");
        return dayEnd >= timeMin && dayStart <= timeMax;
      }
      return false;
    });
  }

  async listUpcomingEvents(maxResults: number, daysAhead: number): Promise<CalendarEvent[]> {
    const now       = new Date();
    const windowEnd = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1_000);
    const events    = await this.listEventsInTimeWindow(now, windowEnd);

    events.sort((a, b) => {
      const ta = new Date(a.start.dateTime ?? (a.start.date ?? "") + "T00:00:00").getTime();
      const tb = new Date(b.start.dateTime ?? (b.start.date ?? "") + "T00:00:00").getTime();
      return ta - tb;
    });

    return events.slice(0, maxResults);
  }
}
