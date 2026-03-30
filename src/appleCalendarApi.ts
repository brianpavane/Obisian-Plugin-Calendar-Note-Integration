/**
 * @file appleCalendarApi.ts
 * @description Read events from Apple Calendar (Calendar.app) on macOS via
 * JavaScript for Automation (JXA) running through osascript.
 *
 * No network calls, no API keys, no OAuth required. Calendar.app already
 * handles authentication for all synced accounts (Google, iCloud, Exchange).
 *
 * Security notes:
 *   - The JXA script is a compile-time constant. No user-controlled data is
 *     ever interpolated into it, eliminating command/script injection risk.
 *   - Output is capped at MAX_OUTPUT_BYTES before JSON.parse to prevent OOM
 *     from a pathologically large calendar.
 *   - Every field read from the JXA response is type-checked and length-capped
 *     before being placed into a CalendarEvent.
 *   - Date strings are validated through Date.parse before use.
 *   - execFile (not exec) is used so no shell expansion takes place.
 *
 * macOS permissions:
 *   On first use macOS shows a system dialog:
 *   "Obsidian wants to access your calendars." — click Allow.
 *   The permission is remembered in System Settings → Privacy → Calendars.
 */

import { execFile } from "child_process";
import type { CalendarEvent, ResponseStatus } from "./icalParser";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on osascript stdout to prevent OOM from large calendars. */
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB

/** Fetch events from today through this many days ahead. */
const LOOKAHEAD_DAYS = 365;

// ---------------------------------------------------------------------------
// JXA scripts — compile-time constants, NO user input interpolated
// ---------------------------------------------------------------------------

/**
 * Returns a JSON array of calendar events starting today through one year
 * ahead. Each element has the shape of {@link RawJxaEvent}.
 *
 * All property accesses are wrapped in individual try/catch blocks so a single
 * bad event property does not discard the entire event.
 */
const JXA_FETCH_EVENTS = `
(function () {
  var app = Application("Calendar");
  var now = new Date();
  var windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var windowEnd   = new Date(windowStart.getTime() + ${LOOKAHEAD_DAYS} * 86400000);
  var results = [];

  app.calendars().forEach(function (cal) {
    var calName = "", calId = "";
    try { calName = cal.name();  } catch (e) {}
    try { calId   = cal.id();    } catch (e) {}

    try {
      cal.events().forEach(function (evt) {
        try {
          var sd = evt.startDate();
          if (!sd || sd < windowStart || sd > windowEnd) return;

          var item = {
            uid: "", summary: "",
            startDate: sd.toISOString(), endDate: sd.toISOString(),
            allDayEvent: false, description: "", location: "",
            calendarName: calName, calendarId: calId,
            attendees: []
          };

          try { item.uid         = String(evt.uid()         || ""); } catch (e) {}
          try { item.summary     = String(evt.summary()     || ""); } catch (e) {}
          try { var ed = evt.endDate(); if (ed) item.endDate = ed.toISOString(); } catch (e) {}
          try { item.allDayEvent = evt.allDayEvent() === true;       } catch (e) {}
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
      });
    } catch (e) {}
  });

  return JSON.stringify(results);
})();
`.trim();

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

/**
 * Run an osascript JXA snippet and return stdout as a string.
 * Uses `execFile` (not `exec`) — no shell expansion.
 * Output is capped at {@link MAX_OUTPUT_BYTES}.
 */
function runOsascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", script],
      { maxBuffer: MAX_OUTPUT_BYTES },
      (err, stdout) => {
        if (err) {
          reject(new Error(
            err.message.includes("1743")
              ? "Calendar access denied. Go to System Settings → Privacy & Security → Calendars and allow Obsidian."
              : `Apple Calendar error: ${err.message}`
          ));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

/**
 * Coerce an unknown value to a string, capped at `maxLen` characters.
 * Returns `""` for non-string or falsy values.
 */
function safeStr(v: unknown, maxLen = 5_000): string {
  return typeof v === "string" ? v.slice(0, maxLen) : "";
}

/** Map Apple Calendar participation status strings to {@link ResponseStatus}. */
function mapAppleStatus(status: string): ResponseStatus {
  switch (status.toLowerCase()) {
    case "accepted":  return "accepted";
    case "declined":  return "declined";
    case "tentative": return "tentative";
    default:          return "needsAction";
  }
}

/**
 * Parse and validate raw JXA JSON output into {@link CalendarEvent} objects.
 * Applies calendar name filter when `calendarFilter` is non-empty.
 */
function parseJxaEvents(
  json: string,
  calendarFilter: string[]
): CalendarEvent[] {
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

    // Apply calendar filter
    const calName = safeStr(r.calendarName);
    if (calendarFilter.length > 0 && !calendarFilter.includes(calName)) {
      continue;
    }

    const startStr = safeStr(r.startDate);
    const endStr   = safeStr(r.endDate);
    const startMs  = Date.parse(startStr);
    if (isNaN(startMs)) continue; // skip events with invalid dates

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
      end   = { dateTime: isNaN(endMs)
        ? new Date(startMs).toISOString()
        : new Date(endMs).toISOString() };
    }

    // Build attendee list
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

    events.push({
      id: uid,
      summary:     safeStr(r.summary,     500)    || undefined,
      description: safeStr(r.description, 50_000) || undefined,
      location:    safeStr(r.location,    1_000)  || undefined,
      start,
      end,
      attendees: attendees.length > 0 ? attendees : undefined,
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A calendar entry returned by {@link listAppleCalendars}. */
export interface AppleCalendar {
  name: string;
  id: string;
}

/**
 * Return the list of calendars visible in Calendar.app.
 * Useful for populating a calendar-filter picker in settings.
 */
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
 */
export class AppleCalendarApi {
  private readonly calendarFilter: string[];

  constructor(calendarFilter: string[] = []) {
    this.calendarFilter = calendarFilter;
  }

  /** Fetch all upcoming events (today → 365 days). */
  async fetchAllEvents(): Promise<CalendarEvent[]> {
    const json = await runOsascript(JXA_FETCH_EVENTS);
    const events = parseJxaEvents(json, this.calendarFilter);
    console.log(
      `[GoogleCalendarNotes] Apple Calendar: fetched ${events.length} events` +
      (this.calendarFilter.length > 0
        ? ` from calendars: ${this.calendarFilter.join(", ")}`
        : " from all calendars")
    );
    return events;
  }

  /** Return events whose start falls within [timeMin, timeMax]. */
  async listEventsInTimeWindow(
    timeMin: Date,
    timeMax: Date
  ): Promise<CalendarEvent[]> {
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

  /** Return up to `maxResults` events sorted by start time. */
  async listUpcomingEvents(
    maxResults: number,
    daysAhead: number
  ): Promise<CalendarEvent[]> {
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
