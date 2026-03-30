/**
 * @file icalParser.ts
 * @description RFC 5545 iCalendar parser for Google Calendar events.
 *
 * Handles the iCal features present in Google Calendar exports:
 *   - Line unfolding (CRLF + WSP continuation per RFC 5545 §3.1)
 *   - DATE and DATE-TIME properties (UTC "Z", floating, TZID-qualified)
 *   - VEVENT fields: UID, SUMMARY, DESCRIPTION, LOCATION, DTSTART, DTEND,
 *     ORGANIZER, ATTENDEE (with CN and PARTSTAT), STATUS
 *   - Google Meet conference links via X-GOOGLE-CONFERENCE / X-GOOGLE-HANGOUT
 *     and by scanning DESCRIPTION for meet.google.com URLs
 *   - Cancelled event suppression (STATUS:CANCELLED)
 *
 * Timezone note: TZID-qualified datetimes (e.g. `DTSTART;TZID=America/New_York`)
 * are stored as ISO strings without a timezone offset (treated as local time).
 * For users whose system timezone matches their calendar timezone — by far the
 * common case — this gives exact results. Slight imprecision for cross-timezone
 * vaults is acceptable for the "create notes N hours in advance" use case.
 *
 * Recurring events: Google Calendar expands recurring instances server-side
 * when `singleevents=true` is appended to the iCal URL (done automatically
 * by {@link IcalCalendarApi}). The parser itself treats each VEVENT
 * independently and does not implement RRULE expansion.
 */

// ---------------------------------------------------------------------------
// Exported types  (re-exported by calendarApi.ts for compatibility)
// ---------------------------------------------------------------------------

/** RSVP response status for a calendar attendee. */
export type ResponseStatus = "accepted" | "declined" | "tentative" | "needsAction";

/**
 * A calendar event. The shape matches what `noteCreator.ts` and
 * `eventModal.ts` expect, preserving full compatibility with those modules.
 */
export interface CalendarEvent {
  /** Unique event identifier (UID property in iCal). */
  id: string;
  /** Event title (SUMMARY). */
  summary?: string;
  /**
   * Free-form description / agenda (DESCRIPTION).
   * May be plain text or HTML depending on the calendar client that created
   * the event. `noteCreator.ts` handles HTML via DOMParser.
   */
  description?: string;
  /** Physical or virtual location (LOCATION). */
  location?: string;
  /** Start time. Exactly one of `dateTime` or `date` is set. */
  start: { dateTime?: string; date?: string };
  /** End time. Exactly one of `dateTime` or `date` is set. */
  end: { dateTime?: string; date?: string };
  /** Invited attendees, excluding cancelled events' own ATTENDEE list. */
  attendees?: Array<{
    /** Email address (extracted from `mailto:` value). */
    email: string;
    /** Display name from the CN parameter, if present. */
    displayName?: string;
    /** RSVP status from the PARTSTAT parameter. */
    responseStatus?: ResponseStatus;
    /**
     * Marked `true` by the plugin when the attendee's email matches
     * the "Your email address" setting, so `noteCreator.ts` can exclude
     * the user's own entry from the attendees table.
     */
    self?: boolean;
    /** True when this attendee is also listed as the event organizer. */
    organizer?: boolean;
  }>;
  /** Event organizer (ORGANIZER property). */
  organizer?: { email: string; displayName?: string };
  /**
   * Video conferencing information.
   * Populated from X-GOOGLE-CONFERENCE, X-GOOGLE-HANGOUT, or a
   * `meet.google.com` URL found in the event description.
   */
  conferenceData?: {
    entryPoints?: Array<{ entryPointType: string; uri: string }>;
    conferenceSolution?: { name?: string };
  };
}

// ---------------------------------------------------------------------------
// Line handling
// ---------------------------------------------------------------------------

/**
 * Unfold iCal lines per RFC 5545 §3.1.
 *
 * A CRLF (or bare LF) immediately followed by a single SP or HTAB is a
 * line-continuation fold. The fold indicator (CRLF + WSP) is removed in
 * its entirety — the WSP is not content.
 */
function unfoldLines(raw: string): string[] {
  return raw
    .replace(/\r\n[ \t]/g, "")  // unfold standard CRLF-folded lines
    .replace(/\r\n/g, "\n")     // normalise remaining CRLF to LF
    .replace(/\n[ \t]/g, "")    // unfold LF-folded lines (common non-standard variant)
    .split("\n")
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Property line parsing
// ---------------------------------------------------------------------------

interface Prop {
  /** Uppercased property name (e.g. "DTSTART", "ATTENDEE"). */
  name: string;
  /** Uppercased parameter names mapped to their (unquoted) values. */
  params: Record<string, string>;
  /** Raw property value (the part after the first `:` delimiter). */
  value: string;
}

/**
 * Parse a single unfolded iCal content line into its component parts.
 *
 * Format (RFC 5545 §3.1):
 * ```
 * NAME[;PARAM=VALUE]* : value
 * ```
 *
 * The first colon that is not inside a DQUOTE-quoted parameter value is
 * the name/value delimiter. This correctly handles values like
 * `ATTENDEE;CN="Smith, Jane":mailto:jane@example.com` where the value
 * itself contains a colon.
 */
function parsePropLine(line: string): Prop {
  // Locate the first colon outside of DQUOTE parameter values.
  let colonIdx = -1;
  let inDQuote = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inDQuote = !inDQuote; continue; }
    if (line[i] === ":" && !inDQuote) { colonIdx = i; break; }
  }

  if (colonIdx === -1) {
    return { name: line.toUpperCase(), params: {}, value: "" };
  }

  const nameAndParams = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);

  // Split name and parameters on ";" while respecting DQUOTE boundaries.
  const segments: string[] = [];
  let seg = "";
  inDQuote = false;
  for (const ch of nameAndParams) {
    if (ch === '"') { inDQuote = !inDQuote; seg += ch; }
    else if (ch === ";" && !inDQuote) { segments.push(seg); seg = ""; }
    else { seg += ch; }
  }
  segments.push(seg);

  const name = segments[0].toUpperCase().trim();
  const params: Record<string, string> = {};

  for (let i = 1; i < segments.length; i++) {
    const eqIdx = segments[i].indexOf("=");
    if (eqIdx === -1) continue;
    const key = segments[i].slice(0, eqIdx).toUpperCase().trim();
    let val = segments[i].slice(eqIdx + 1).trim();
    // Strip surrounding DQUOTE if present.
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    params[key] = val;
  }

  return { name, params, value };
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/**
 * Unescape iCal TEXT value escape sequences (RFC 5545 §3.3.11):
 *
 * | Escape | Meaning          |
 * |--------|------------------|
 * | `\n`   | newline          |
 * | `\N`   | newline          |
 * | `\\`   | literal backslash |
 * | `\;`   | semicolon        |
 * | `\,`   | comma            |
 */
function unescapeText(value: string): string {
  return value
    .replace(/\\[nN]/g, "\n")
    .replace(/\\;/g, ";")
    .replace(/\\,/g, ",")
    .replace(/\\\\/g, "\\");
}

/**
 * Convert an iCal date or date-time string to ISO 8601.
 *
 * | iCal input            | Result                        | Notes          |
 * |-----------------------|-------------------------------|----------------|
 * | `20260330`            | `{ date: "2026-03-30" }`      | DATE-only      |
 * | `20260330T100000Z`    | `{ dateTime: "2026-03-30T10:00:00Z" }` | UTC   |
 * | `20260330T100000`     | `{ dateTime: "2026-03-30T10:00:00" }`  | local  |
 * | (with TZID param)     | `{ dateTime: "2026-03-30T10:00:00" }`  | local  |
 */
function parseIcalDate(value: string): { dateTime?: string; date?: string } {
  // DATE-only: exactly 8 digits.
  if (/^\d{8}$/.test(value)) {
    return {
      date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
    };
  }

  // DATE-TIME: YYYYMMDDTHHmmss[Z]
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return {};

  const [, yr, mo, dy, hr, mn, sc, utc] = m;
  return {
    dateTime: `${yr}-${mo}-${dy}T${hr}:${mn}:${sc}${utc === "Z" ? "Z" : ""}`,
  };
}

/**
 * Map an iCal PARTSTAT parameter value to a {@link ResponseStatus}.
 * Defaults to `"needsAction"` for absent or unrecognised values.
 */
function mapPartstat(partstat: string | undefined): ResponseStatus {
  switch ((partstat ?? "").toUpperCase()) {
    case "ACCEPTED":     return "accepted";
    case "DECLINED":     return "declined";
    case "TENTATIVE":    return "tentative";
    case "NEEDS-ACTION":
    default:             return "needsAction";
  }
}

/**
 * Attempt to extract a Google Meet video-conference URL from event properties.
 *
 * Search order:
 * 1. `X-GOOGLE-CONFERENCE` property (modern Google Calendar format)
 * 2. `X-GOOGLE-HANGOUT` property (legacy format)
 * 3. First `https://meet.google.com/…` URL found in the event description
 */
function extractConference(
  xConf: string | undefined,
  xHangout: string | undefined,
  description: string
): CalendarEvent["conferenceData"] | undefined {
  const meetUrl =
    xConf ??
    xHangout ??
    description.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i)?.[0];

  if (!meetUrl) return undefined;

  return {
    entryPoints: [{ entryPointType: "video", uri: meetUrl }],
    conferenceSolution: { name: "Google Meet" },
  };
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

/**
 * Parse a raw iCalendar string and return all VEVENT entries as
 * {@link CalendarEvent} objects.
 *
 * Cancelled events (`STATUS:CANCELLED`) are silently dropped.
 * Events with no UID are also dropped (they cannot be reliably identified).
 *
 * @param raw The full iCal feed content as a UTF-8 string.
 * @returns   Array of events in the order they appear in the feed.
 */
export function parseIcal(raw: string): CalendarEvent[] {
  const lines = unfoldLines(raw);
  const events: CalendarEvent[] = [];

  // Mutable state for the VEVENT currently being parsed.
  let inVEvent = false;
  let uid = "";
  let summary = "";
  let description = "";
  let location = "";
  let startResult: ReturnType<typeof parseIcalDate> = {};
  let endResult: ReturnType<typeof parseIcalDate> = {};
  let organizer: CalendarEvent["organizer"] = undefined;
  let attendees: NonNullable<CalendarEvent["attendees"]> = [];
  let xConf: string | undefined;
  let xHangout: string | undefined;
  let cancelled = false;

  const resetState = (): void => {
    uid = ""; summary = ""; description = ""; location = "";
    startResult = {}; endResult = {};
    organizer = undefined; attendees = [];
    xConf = undefined; xHangout = undefined;
    cancelled = false;
  };

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inVEvent = true;
      resetState();
      continue;
    }

    if (line === "END:VEVENT") {
      inVEvent = false;
      // Only emit events with a UID and that are not cancelled.
      if (uid && !cancelled) {
        // Mark organizer attendee entry so noteCreator.ts can apply the
        // "organizer first" ordering correctly.
        if (organizer) {
          attendees = attendees.map((a) => ({
            ...a,
            organizer: a.organizer ?? (a.email === organizer!.email),
          }));
        }

        events.push({
          id: uid,
          summary: summary || undefined,
          description: description || undefined,
          location: location || undefined,
          start: startResult,
          end: endResult,
          organizer,
          attendees: attendees.length > 0 ? attendees : undefined,
          conferenceData: extractConference(xConf, xHangout, description),
        });
      }
      continue;
    }

    if (!inVEvent) continue;

    const prop = parsePropLine(line);

    switch (prop.name) {
      case "UID":
        uid = prop.value;
        break;

      case "SUMMARY":
        summary = unescapeText(prop.value);
        break;

      case "DESCRIPTION":
        description = unescapeText(prop.value);
        break;

      case "LOCATION":
        location = unescapeText(prop.value);
        break;

      case "STATUS":
        if (prop.value.toUpperCase() === "CANCELLED") cancelled = true;
        break;

      case "DTSTART":
        startResult = parseIcalDate(prop.value);
        break;

      case "DTEND":
        endResult = parseIcalDate(prop.value);
        break;

      case "ORGANIZER": {
        const email = prop.value.replace(/^mailto:/i, "").trim();
        const displayName = prop.params["CN"] || undefined;
        if (email) organizer = { email, displayName };
        break;
      }

      case "ATTENDEE": {
        const email = prop.value.replace(/^mailto:/i, "").trim();
        if (!email) break;
        const displayName = prop.params["CN"] || undefined;
        const responseStatus = mapPartstat(prop.params["PARTSTAT"]);
        attendees.push({ email, displayName, responseStatus });
        break;
      }

      case "X-GOOGLE-CONFERENCE":
        xConf = prop.value;
        break;

      case "X-GOOGLE-HANGOUT":
        xHangout = prop.value;
        break;
    }
  }

  return events;
}
