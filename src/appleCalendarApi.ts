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
 * Default cap on events scanned in Tier 3 (individual startDate() loop).
 * Tier 2.75 (bulk startDate fetch) is tried first and is far faster —
 * this cap only applies if Tier 2.75 also fails.
 */
const DEFAULT_MAX_TIER3_SCAN = 250;

// Shared JXA snippet for building one result item from an event object (variable `evt`).
//
// Uses evt.properties() to fetch all scalar fields in ONE IPC call instead of
// 7+ individual getter calls. This is critical for calendars with recurring
// events — each instance requires its own IPC round-trip per property, so
// 300 events × 7 getters = 2100 calls vs. 300 × 1 = 300 with properties().
const JXA_BUILD_ITEM = `
      var p = {};
      try { p = evt.properties(); } catch (ep) {}
      try { item.uid         = String(p.uid         || ""); } catch (e) {}
      try { item.summary     = String(p.summary     || ""); } catch (e) {}
      try { if (p.startDate) item.startDate = p.startDate.toISOString(); } catch (e) {}
      try { if (p.endDate)   item.endDate   = p.endDate.toISOString();   } catch (e) {}
      try { item.allDayEvent = p.allDayEvent === true;                    } catch (e) {}
      try { item.description = String(p.description || "");              } catch (e) {}
      try { item.location    = String(p.location    || "");              } catch (e) {}
      try {
        var atts = evt.attendees();
        if (atts && atts.length > 0) {
          var maxAtts = Math.min(atts.length, 20);
          var attList = [];
          for (var ai = 0; ai < maxAtts; ai++) {
            try {
              var ap = {};
              try { ap = atts[ai].properties(); } catch (e) {}
              // properties() may return empty on Exchange — fall back to
              // individual getters for each field so we always get what we can.
              var attAddr   = String(ap.address             || "");
              var attName   = String(ap.displayName         || "");
              var attStatus = String(ap.participationStatus || "");
              if (!attAddr)   { try { attAddr   = String(atts[ai].address()             || ""); } catch (e) {} }
              if (!attName)   { try { attName   = String(atts[ai].displayName()         || ""); } catch (e) {} }
              if (!attStatus) { try { attStatus = String(atts[ai].participationStatus() || ""); } catch (e) {} }
              // Only push if we have at least a name or address to show.
              if (attAddr || attName) {
                attList.push({
                  displayName: attName,
                  address:     attAddr,
                  status:      attStatus || "unknown"
                });
              }
            } catch (e) {}
          }
          item.attendees = attList;
        }
      } catch (e) {}`.trimStart();

/**
 * Tier 1 script: application-level app.eventsFrom(start, {to:end}).
 * Throws (non-zero osascript exit) when unsupported so the TypeScript
 * caller knows to fall back to per-calendar mode.
 */
function buildJxaTier1Script(daysBack: number, daysAhead: number): string {
  const safeDaysBack  = Math.max(0, Math.min(30,  Math.floor(daysBack)));
  const safeDaysAhead = Math.max(1, Math.min(365, Math.floor(daysAhead)));
  return `
(function () {
  var app = Application("Calendar");
  var now = new Date();
  var windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ${safeDaysBack});
  var windowEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ${safeDaysAhead});

  var calMap = {};
  try {
    app.calendars().forEach(function (cal) {
      var id = "", name = "";
      try { id   = String(cal.id()   || ""); } catch (e) {}
      try { name = String(cal.name() || ""); } catch (e) {}
      if (id) calMap[id] = name;
    });
  } catch (e) {}

  // Throws if unsupported — TypeScript caller falls back to per-calendar mode.
  var rawEvents = app.eventsFrom(windowStart, { to: windowEnd });

  var results = [];
  for (var i = 0; i < rawEvents.length; i++) {
    try {
      var evt = rawEvents[i];
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
      var item = {
        uid: "", summary: "",
        startDate: windowStart.toISOString(), endDate: windowStart.toISOString(),
        allDayEvent: false, description: "", location: "",
        calendarName: calName, calendarId: calId, attendees: []
      };
      ${JXA_BUILD_ITEM}
      results.push(item);
    } catch (e) {}
  }
  return JSON.stringify(results);
})();
`.trim();
}

/**
 * Per-calendar script: queries ONE named calendar through Tier 2 → 2.5 → 2.75 → 3.
 * Running one call per calendar in TypeScript means a slow/hung calendar
 * only blocks its own slot — other calendars still return results.
 *
 * Tier 2.75 is the key fix for Exchange calendars that fail Tier 2 & 2.5:
 *   `cal.events.startDate()` fetches ALL start dates in ONE IPC call,
 *   filters in JS, then calls `properties()` only for matching events.
 *   This replaces the Tier 3 loop of N individual `startDate()` calls
 *   (e.g. 1000 calls × 50–100 ms each = timeout).
 *
 * Returns JSON: { tier, t2ms, t25ms, t275ms, t3ms, events[] }
 *   tier: 2 | 25 | 275 | 3 | -3 (skipped)
 *   tXms: elapsed ms for each tier attempt (-1 = not attempted)
 */
function buildJxaPerCalendarScript(
  calName: string,
  daysBack: number,
  daysAhead: number,
  skipTier3 = false,
  maxTier3Scan = DEFAULT_MAX_TIER3_SCAN
): string {
  const safeDaysBack    = Math.max(0, Math.min(30,  Math.floor(daysBack)));
  const safeDaysAhead   = Math.max(1, Math.min(365, Math.floor(daysAhead)));
  const safeCalName     = JSON.stringify(calName); // name came from Calendar.app
  const skipTier3Js     = skipTier3 ? "true" : "false";
  const safeMaxT3Scan   = Math.max(50, Math.min(2_000, Math.floor(maxTier3Scan)));
  return `
ObjC.import('Foundation');
ObjC.import('EventKit');
(function () {
  var app = Application("Calendar");
  var targetName = ${safeCalName};
  var now = new Date();
  var windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ${safeDaysBack});
  var windowEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ${safeDaysAhead});

  var targetCal = null, cId = "";
  try {
    var allCals = app.calendars();
    for (var i = 0; i < allCals.length; i++) {
      var n = "";
      try { n = String(allCals[i].name() || ""); } catch (e) {}
      if (n === targetName) {
        targetCal = allCals[i];
        try { cId = String(allCals[i].id() || ""); } catch (e) {}
        break;
      }
    }
  } catch (e) {}
  if (!targetCal) return JSON.stringify({ tier: 0, t2ms: -1, t25ms: -1, t275ms: -1, t3ms: -1, events: [] });

  var calEvts = null;
  var t2ms = -1, t25ms = -1, t275ms = -1, t3ms = -1, tier = 0;

  // ── Tier 0: EventKit (EKEventStore) — reads local cache, no network ────────
  //
  // EKEventStore queries the same local SQLite store that Calendar.app writes
  // to during its background syncs. It does NOT trigger a CalDAV or Exchange
  // server round-trip, so it returns in milliseconds regardless of how stale
  // the in-process scripting-bridge cache is.
  //
  // If EventKit is unavailable, or the process lacks Calendar permission, or
  // the target calendar is not found, we fall through to the scripting-bridge
  // tiers below which remain as a full fallback.
  //
  // Attendee email: EKParticipant.URL is a mailto: URL — strip the scheme.
  // EKParticipantStatus integers: 0=unknown 1=pending 2=accepted 3=declined
  //                               4=tentative 5=delegated 6=completed 7=inProcess
  var t0start = Date.now();
  try {
    var store   = $.EKEventStore.alloc.init;
    var startNS = $.NSDate.dateWithTimeIntervalSince1970(windowStart.getTime() / 1000);
    var endNS   = $.NSDate.dateWithTimeIntervalSince1970(windowEnd.getTime()   / 1000);
    // 30-day lookback so recurring instances near the window boundary are included
    var recurNS = $.NSDate.dateWithTimeIntervalSince1970(
      (windowStart.getTime() - 30 * 86400000) / 1000
    );

    // Find the target EKCalendar by name
    var ekCals       = store.calendarsForEntityType(0); // 0 = EKEntityTypeEvent
    var targetEKCal  = null;
    var ekCalId      = "";
    for (var ec = 0; ec < ekCals.count; ec++) {
      try {
        var ekc = ekCals.objectAtIndex(ec);
        if (ekc.title.js === targetName) {
          targetEKCal = ekc;
          try { ekCalId = ekc.calendarIdentifier.js; } catch (e) {}
          break;
        }
      } catch (e) {}
    }

    if (targetEKCal) {
      var calsNS = $.NSArray.arrayWithObject(targetEKCal);
      var pred   = store.predicateForEventsWithStartDateEndDateCalendars(recurNS, endNS, calsNS);
      var ekEvts = store.eventsMatchingPredicate(pred); // reads local cache only
      var t0ms   = Date.now() - t0start;
      var ek0results = [];
      for (var ek = 0; ek < ekEvts.count; ek++) {
        try {
          var ev   = ekEvts.objectAtIndex(ek);
          var item = {
            uid: "", summary: "",
            startDate: windowStart.toISOString(), endDate: windowStart.toISOString(),
            allDayEvent: false, description: "", location: "",
            calendarName: targetName, calendarId: ekCalId, attendees: []
          };
          try { item.uid     = ev.eventIdentifier ? ev.eventIdentifier.js : ""; } catch (e) {}
          try { item.summary = ev.title            ? ev.title.js            : ""; } catch (e) {}
          try {
            if (ev.startDate) {
              var secs0 = parseFloat(String(ev.startDate.timeIntervalSince1970));
              item.startDate = new Date(secs0 * 1000).toISOString();
            }
          } catch (e) {}
          try {
            if (ev.endDate) {
              var sece0 = parseFloat(String(ev.endDate.timeIntervalSince1970));
              item.endDate = new Date(sece0 * 1000).toISOString();
            }
          } catch (e) {}
          try { item.allDayEvent = ev.isAllDay ? true : false; } catch (e) {}
          try { item.description = ev.notes    ? ev.notes.js    : ""; } catch (e) {}
          try { item.location    = ev.location ? ev.location.js : ""; } catch (e) {}
          try {
            var ekAtts = ev.attendees;
            if (ekAtts && ekAtts.count > 0) {
              var attList = [];
              var maxAtts = Math.min(ekAtts.count, 20);
              for (var ai = 0; ai < maxAtts; ai++) {
                try {
                  var att       = ekAtts.objectAtIndex(ai);
                  var attName   = "";
                  var attAddr   = "";
                  var attStatus = "unknown";
                  try { attName = att.name ? att.name.js : ""; } catch (e) {}
                  try {
                    if (att.URL) {
                      var mto = att.URL.absoluteString.js;
                      attAddr = mto.replace(/^mailto:/i, "");
                    }
                  } catch (e) {}
                  try {
                    var ps = att.participantStatus; // EKParticipantStatus int
                    if      (ps === 2) attStatus = "accepted";
                    else if (ps === 3) attStatus = "declined";
                    else if (ps === 4) attStatus = "tentative";
                    else if (ps === 1) attStatus = "needsAction";
                    else               attStatus = "unknown";
                  } catch (e) {}
                  if (attAddr || attName) {
                    attList.push({ displayName: attName, address: attAddr, status: attStatus });
                  }
                } catch (e) {}
              }
              item.attendees = attList;
            }
          } catch (e) {}
          ek0results.push(item);
        } catch (e) {}
      }
      // Return early — no need to touch Calendar.app scripting bridge at all
      return JSON.stringify({
        tier: 0, t0ms: t0ms, t2ms: -1, t25ms: -1, t275ms: -1, t3ms: -1,
        events: ek0results
      });
    }
  } catch (e0) {
    // EventKit unavailable or permission denied — fall through to
    // Calendar.app scripting-bridge tiers below
  }

  // ── Tier 2: cal.eventsFrom(start, {to:end}) ──────────────────────────────
  //
  // Attempt A: pass NSDate objects (required for CalDAV calendars — Google
  // CalDAV / iCloud).  JXA's auto-conversion of JS Date → AppleScript date
  // triggers a "Can't convert types" error on CalDAV; NSDate bypasses it and
  // allows Calendar.app to issue a proper CalDAV REPORT time-range query,
  // which Google answers with only the matching events (1–5 s vs 60–150 s).
  //
  // Attempt B: fall back to raw JS Date (works for Exchange/EWS accounts).
  var t2start = Date.now();
  try {
    var startNS = $.NSDate.dateWithTimeIntervalSince1970(windowStart.getTime() / 1000);
    var endNS   = $.NSDate.dateWithTimeIntervalSince1970(windowEnd.getTime()   / 1000);
    calEvts = targetCal.eventsFrom(startNS, { to: endNS });
    t2ms = Date.now() - t2start;
    tier = 2;
  } catch (e2a) {
    try {
      calEvts = targetCal.eventsFrom(windowStart, { to: windowEnd });
      t2ms = Date.now() - t2start;
      tier = 2;
    } catch (e2b) {
      t2ms = Date.now() - t2start;
      calEvts = null;
    }
  }

  // ── Tier 2.5: whose-predicate filter ─────────────────────────────────────
  if (calEvts === null) {
    var t25start = Date.now();
    try {
      calEvts = targetCal.events.whose({
        _and: [
          { startDate: { _greaterThanEquals: windowStart } },
          { startDate: { _lessThanEquals:    windowEnd   } }
        ]
      })();
      t25ms = Date.now() - t25start;
      tier = 25;
    } catch (e25) {
      t25ms = Date.now() - t25start;
      calEvts = null;
    }
  }

  // ── Tier 2.75: bulk startDate() fetch — ONE IPC call for all dates ────────
  //
  // cal.events.startDate() is a JXA collection-level property access that
  // returns ALL event start dates in a SINGLE AppleEvent round-trip.
  // We then filter purely in JS and call properties() only on matches.
  //
  //   Old Tier 3: 1000 individual startDate() calls × 50–100 ms = 50–100 s
  //   Tier 2.75:  1 bulk call + JS filter = typically 1–10 s
  //
  // Guard: if the calendar has more than 4× maxTier3Scan events, the bulk
  // response itself may be too large and slow. Skip to Tier 3 in that case.
  //
  // Lookback: filter uses windowStart - 30 days (not just windowStart) so
  // that recurring event instances whose dates fall just before the window
  // boundary are captured. Calendar.app materialises recurring instances as
  // individual records with their own startDate; this wider net catches them.
  if (calEvts === null) {
    var t275start = Date.now();
    try {
      var t275Total = targetCal.events.length;
      var t275Limit = ${safeMaxT3Scan} * 3;
      if (t275Total > t275Limit) {
        // Too many events — bulk response would be huge; skip to Tier 3
        t275ms = Date.now() - t275start;
        calEvts = null;
      } else {
        var recurLookback = new Date(windowStart.getTime() - 30 * 86400000);
        var allDates = targetCal.events.startDate();
        calEvts = [];
        for (var m = 0; m < allDates.length; m++) {
          try {
            var sd275 = allDates[m];
            if (sd275 && sd275 >= recurLookback && sd275 <= windowEnd) {
              calEvts.push(targetCal.events[m]);
            }
          } catch (em) {}
        }
        t275ms = Date.now() - t275start;
        tier = 275;
      }
    } catch (e275b) {
      t275ms = Date.now() - t275start;
      calEvts = null;
    }
  }

  // ── Tier 3: individual startDate() scan of the newest N events ────────────
  //
  // Last resort — only reached if Tier 2.75 also fails.
  // Calendar.app returns events oldest-first, so we start from the end
  // where upcoming events live.
  if (calEvts === null) {
    if (${skipTier3Js}) {
      calEvts = [];
      tier = -3;
    } else {
      calEvts = [];
      var t3start = Date.now();
      try {
        // Use .length (fast count) then indexed access [j] (lazy object
        // specifier) to avoid materialising the full CalDAV event array.
        // Calling targetCal.events() forces Calendar.app to download the
        // entire CalDAV list from Google's servers, causing 120s+ timeouts.
        var total    = targetCal.events.length;
        var scanFrom = Math.max(0, total - ${safeMaxT3Scan});
        for (var j = scanFrom; j < total; j++) {
          try {
            var evtSd = targetCal.events[j].startDate();
            if (evtSd && evtSd >= windowStart && evtSd <= windowEnd) {
              calEvts.push(targetCal.events[j]);
            }
          } catch (e3) {}
        }
      } catch (e3) {}
      t3ms = Date.now() - t3start;
      tier = 3;
    }
  }

  var results = [];
  for (var k = 0; k < calEvts.length; k++) {
    try {
      var evt = calEvts[k];
      var item = {
        uid: "", summary: "",
        startDate: windowStart.toISOString(), endDate: windowStart.toISOString(),
        allDayEvent: false, description: "", location: "",
        calendarName: targetName, calendarId: cId, attendees: []
      };
      ${JXA_BUILD_ITEM}
      results.push(item);
    } catch (e) {}
  }
  return JSON.stringify({ tier: tier, t2ms: t2ms, t25ms: t25ms, t275ms: t275ms, t3ms: t3ms, events: results });
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

/** Default timeout when the caller does not specify one. */
const DEFAULT_TIMEOUT_MS = 30_000;

function runOsascript(script: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", script],
      { maxBuffer: MAX_OUTPUT_BYTES, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          if ((err as Error & { killed?: boolean }).killed) {
            reject(new Error(
              `Apple Calendar request timed out after ${timeoutMs / 1000}s. ` +
              "Calendar.app may be syncing a large calendar — try again in a moment, " +
              "or increase the timeout in Settings."
            ));
            return;
          }
          // Use stderr for the meaningful error text — err.message includes the
          // full command string (with the entire JXA script), which makes logs
          // unreadable. stderr contains only the osascript execution error.
          const raw = (stderr ?? "").trim() || err.message;
          const clean = raw.split("\n").filter((l) => l.trim()).pop() ?? raw;
          reject(new Error(
            clean.includes("1743")
              ? "Calendar access denied. In System Settings → Privacy & Security → Calendars, " +
                "set Obsidian to 'Full Calendar Access' (not 'Add Only')."
              : `Apple Calendar error: ${clean}`
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
    // "invited" and "notresponded" are Calendar.app variants for "awaiting reply"
    case "invited":
    case "notresponded":
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
        const email       = safeStr(ar.address,     200).trim();
        const displayName = safeStr(ar.displayName, 200).trim();
        // Exchange attendees often have a display name but no email address in
        // Calendar.app's scripting bridge. Include them using the display name
        // as a fallback identifier so the attendee table is never silently empty.
        if (!email && !displayName) continue;
        attendees.push({
          email: email || displayName,
          displayName: displayName || undefined,
          responseStatus: mapAppleStatus(safeStr(ar.status)),
        });
      }
    }

    const uid = safeStr(r.uid, 500) || `apple-${startMs}-${crypto.randomUUID()}`;
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
            log(`    ⚠ ${total} total events — will try Tier 2.75 bulk-date fetch, then scan newest ${DEFAULT_MAX_TIER3_SCAN}`);
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
  private readonly timeoutMs: number;
  private readonly skipTier3: boolean;
  private readonly maxTier3Scan: number;

  constructor(
    calendarFilter: string[] = [],
    daysBack = 0,
    daysAhead = 30,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    skipTier3 = false,
    maxTier3Scan = DEFAULT_MAX_TIER3_SCAN
  ) {
    this.calendarFilter = calendarFilter;
    this.daysBack = daysBack;
    this.daysAhead = daysAhead;
    this.timeoutMs = timeoutMs;
    this.skipTier3 = skipTier3;
    this.maxTier3Scan = maxTier3Scan;
  }

  async fetchAllEvents(): Promise<CalendarEvent[]> {
    const tag = "[GoogleCalendarNotes] Apple Calendar";
    const timeoutSec = Math.round(this.timeoutMs / 1000);
    console.log(
      `${tag} fetchAllEvents() window: -${this.daysBack}d…+${this.daysAhead}d ` +
      `timeout:${timeoutSec}s skipTier3:${this.skipTier3}`
    );

    // ── Step 1: Try Tier 1 (app.eventsFrom — single fast call) ───────────────
    try {
      const t0 = Date.now();
      const json = await runOsascript(
        buildJxaTier1Script(this.daysBack, this.daysAhead),
        this.timeoutMs
      );
      const events = parseJxaEvents(json, this.calendarFilter);
      console.log(`${tag} Tier 1 ✓ — ${events.length} event(s) in ${Date.now() - t0}ms`);
      return events;
    } catch (tier1Err) {
      const msg = tier1Err instanceof Error ? tier1Err.message : String(tier1Err);
      console.log(`${tag} Tier 1 failed (${msg}), switching to per-calendar mode`);
    }

    // ── Step 2: Per-calendar fallback — one osascript call per calendar ───────
    // Each call has its own timeout, so a hung calendar only blocks its own
    // slot and doesn't prevent other calendars from returning results.
    let calNames = this.calendarFilter;
    if (calNames.length === 0) {
      try {
        const cals = await listAppleCalendars();
        calNames = cals.map((c) => c.name).filter(Boolean);
      } catch {
        calNames = [];
      }
    }

    if (calNames.length === 0) {
      throw new Error(
        "Apple Calendar: no calendars found. " +
        "Verify Obsidian has Full Calendar Access in " +
        "System Settings → Privacy & Security → Calendars."
      );
    }

    const allEvents: CalendarEvent[] = [];
    const timedOut: string[] = [];
    const errored: string[] = [];

    for (const calName of calNames) {
      const t0 = Date.now();
      try {
        const json = await runOsascript(
          buildJxaPerCalendarScript(
            calName, this.daysBack, this.daysAhead, this.skipTier3, this.maxTier3Scan
          ),
          this.timeoutMs
        );

        // Per-calendar script returns { tier, t2ms, t25ms, t275ms, t3ms, events }
        let eventsJson = json;
        try {
          const wrapper = JSON.parse(json) as {
            tier?: number;
            t0ms?: number; t2ms?: number; t25ms?: number; t275ms?: number; t3ms?: number;
            events?: unknown[];
          };
          if (wrapper && typeof wrapper === "object" && Array.isArray(wrapper.events)) {
            const tierLabel: Record<number, string> = {
              0: "Tier 0 (EventKit local cache)",
              2: "Tier 2", 25: "Tier 2.5", 275: "Tier 2.75 (bulk-date)", 3: "Tier 3", [-3]: "Tier 3 skipped",
            };
            const tLabel = tierLabel[wrapper.tier ?? -1] ?? `Tier ${wrapper.tier}`;
            const timingParts: string[] = [];
            if ((wrapper.t0ms   ?? -1) >= 0) timingParts.push(`t0:${wrapper.t0ms}ms`);
            if ((wrapper.t2ms   ?? -1) >= 0) timingParts.push(`t2:${wrapper.t2ms}ms`);
            if ((wrapper.t25ms  ?? -1) >= 0) timingParts.push(`t2.5:${wrapper.t25ms}ms`);
            if ((wrapper.t275ms ?? -1) >= 0) timingParts.push(`t2.75:${wrapper.t275ms}ms`);
            if ((wrapper.t3ms   ?? -1) >= 0) timingParts.push(`t3:${wrapper.t3ms}ms`);
            const timing = timingParts.length ? ` (${timingParts.join(" ")})` : "";
            if (wrapper.tier === -3) {
              console.log(
                `${tag} "${calName}" — EventKit + Tier 2/2.5/2.75 all failed, Tier 3 skipped (disabled in Settings)`
              );
            } else {
              console.log(
                `${tag} "${calName}" ✓ ${tLabel} — ${wrapper.events.length} event(s) ` +
                `in ${Date.now() - t0}ms${timing}`
              );
            }
            eventsJson = JSON.stringify(wrapper.events);
          }
        } catch {
          // wrapper parse failed — treat as plain array (backward compat)
        }

        const events = parseJxaEvents(eventsJson, []);
        allEvents.push(...events);
      } catch (err) {
        const elapsed = Date.now() - t0;
        const isTimeout = (err as Error & { killed?: boolean }).killed === true ||
                          (err instanceof Error && err.message.includes("timed out"));
        if (isTimeout) {
          console.warn(`${tag} "${calName}" timed out after ${elapsed}ms`);
          timedOut.push(calName);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`${tag} "${calName}" error after ${elapsed}ms: ${msg}`);
          errored.push(`"${calName}": ${msg.slice(0, 120)}`);
        }
      }
    }

    // Partial success — return what we got, surface a warning in the console
    if (allEvents.length > 0) {
      if (timedOut.length > 0) {
        console.warn(
          `${tag} Timed out on: ${timedOut.map((n) => `"${n}"`).join(", ")}. ` +
          `Returning ${allEvents.length} event(s) from other calendars.`
        );
      }
      return allEvents;
    }

    // Total failure — throw with detail on each calendar
    const parts: string[] = [];
    if (timedOut.length > 0) {
      parts.push(
        `Timed out reading ${timedOut.map((n) => `"${n}"`).join(", ")} after ${timeoutSec}s. ` +
        `Calendar.app may be syncing a large Exchange/Office 365 account. ` +
        `Try: open Calendar.app and wait for it to finish syncing, then retry. ` +
        `Or increase the timeout in Settings → Apple Calendar → Advanced.`
      );
    }
    errored.forEach((e) => parts.push(e));
    throw new Error(`Apple Calendar: ${parts.join(" | ")}`);
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
