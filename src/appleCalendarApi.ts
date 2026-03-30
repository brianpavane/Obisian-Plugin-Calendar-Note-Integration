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
 * Only safe integers are interpolated — never user strings.
 *
 * @param daysBack   Days before today to start the window. 0 = today (no past events).
 *                   Clamped to [0, 30].
 * @param daysAhead  Days after today to end the window.
 *                   Clamped to [1, 365].
 */
function buildJxaFetchEvents(daysBack: number, daysAhead: number): string {
  const safeDaysBack  = Math.max(0,   Math.min(30,  Math.floor(daysBack)));
  const safeDaysAhead = Math.max(1,   Math.min(365, Math.floor(daysAhead)));

  return `
(function () {
  var app = Application("Calendar");
  var now = new Date();
  var windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ${safeDaysBack});
  var windowEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ${safeDaysAhead});

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

  // Use app.eventsFrom(start, {to: end}) — the application-level API.
  // Calendar.app executes this as a native date-range query (equivalent to
  // CalDAV/Exchange server-side search), so it never loads every historical
  // event from every calendar. This avoids the timeout caused by cal.events()
  // or per-calendar eventsFrom(), which enumerate the full event store first.
  var rawEvents = [];
  try {
    rawEvents = app.eventsFrom(windowStart, { to: windowEnd });
  } catch (e) {
    return JSON.stringify([]);
  }

  var results = [];
  for (var i = 0; i < rawEvents.length; i++) {
    try {
      var evt = rawEvents[i];

      // Determine the parent calendar from the event's JXA object specifier.
      // Specifier format: event id "X" of calendar id "Y" of application "Calendar"
      // The container property gives the enclosing calendar specifier.
      var calName = "", calId = "";
      try {
        calId   = String(evt.container.id()   || "");
        calName = String(evt.container.name() || "");
      } catch (e1) {
        try {
          // Fallback: parse the calendar ID out of the specifier string.
          var specStr = String(evt.specifier());
          var m = specStr.match(/calendar id "([^"]+)"/);
          if (m) { calId = m[1]; calName = calMap[calId] || ""; }
        } catch (e2) {}
      }

      var item = {
        uid: "", summary: "",
        startDate: windowStart.toISOString(), endDate: windowStart.toISOString(),
        allDayEvent: false, description: "", location: "",
        calendarName: calName, calendarId: calId,
        attendees: []
      };

      try { item.uid         = String(evt.uid()         || ""); } catch (e) {}
      try { item.summary     = String(evt.summary()     || ""); } catch (e) {}
      try { var sd = evt.startDate(); if (sd) item.startDate = sd.toISOString(); } catch (e) {}
      try { var ed = evt.endDate();   if (ed) item.endDate   = ed.toISOString(); } catch (e) {}
      try { item.allDayEvent = evt.allDayEvent() === true;                        } catch (e) {}
      try { item.description = String(evt.description() || ""); } catch (e) {}
      try { item.location    = String(evt.location()    || ""); } catch (e) {}
      try {
        var atts = evt.attendees();
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
      json = await runOsascript(buildJxaFetchEvents(this.daysBack, this.daysAhead));
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
