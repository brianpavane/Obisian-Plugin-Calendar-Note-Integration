/**
 * @file calendarApi.ts
 * @description Google Calendar client using the iCalendar (iCal/ICS) protocol.
 *
 * This module replaces the previous OAuth + REST API approach. Events are now
 * fetched from the user's Google Calendar "secret address" iCal URL — no
 * Google Cloud Console project, no API keys, and no OAuth flow required.
 *
 * Re-exports {@link CalendarEvent} and {@link ResponseStatus} from
 * `icalParser.ts` so that `noteCreator.ts` and `eventModal.ts` continue to
 * import from this module without changes.
 */

export { CalendarEvent, ResponseStatus } from "./icalParser";
import { CalendarEvent } from "./icalParser";
import { parseIcal } from "./icalParser";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Milliseconds before an iCal fetch is aborted. */
const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a URL with an automatic abort after `timeoutMs` milliseconds.
 * Throws an AbortError (err.name === "AbortError") on timeout.
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Append `singleevents=true` to a Google Calendar iCal URL so that Google
 * expands recurring event instances server-side rather than returning a
 * single VEVENT with an RRULE that the client would need to expand.
 *
 * Non-Google URLs are returned unchanged.
 */
function withSingleEvents(url: string): string {
  if (!url.includes("calendar.google.com")) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("singleevents")) {
      u.searchParams.set("singleevents", "true");
    }
    return u.toString();
  } catch {
    return url; // malformed URL — return as-is
  }
}

// ---------------------------------------------------------------------------
// IcalCalendarApi
// ---------------------------------------------------------------------------

/**
 * Read-only calendar client that fetches events from an iCal feed URL.
 *
 * The iCal URL is the "Secret address in iCal format" available in
 * Google Calendar → Settings → [your calendar] → Integrate calendar.
 * It requires no sign-in and no API keys — the URL itself is the credential.
 *
 * @example
 * ```ts
 * const api = new IcalCalendarApi(settings.icalUrl);
 * const events = await api.listUpcomingEvents(20, 7);
 * ```
 */
export class IcalCalendarApi {
  private readonly icalUrl: string;

  /**
   * @param icalUrl The iCal feed URL (Google Calendar secret address).
   */
  constructor(icalUrl: string) {
    this.icalUrl = icalUrl;
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  /**
   * Fetch and parse all events from the iCal feed.
   *
   * For Google Calendar URLs, `singleevents=true` is appended automatically
   * so recurring event instances are returned as individual VEVENTs.
   *
   * @throws If the network request fails, times out, or returns a non-2xx status.
   */
  async fetchAllEvents(): Promise<CalendarEvent[]> {
    const url = withSingleEvents(this.icalUrl);
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch iCal feed: HTTP ${response.status} ${response.statusText}. ` +
          "Check that the iCal URL is correct and has not been regenerated in Google Calendar."
      );
    }

    const text = await response.text();
    return parseIcal(text);
  }

  /**
   * Return events whose start time falls within [timeMin, timeMax].
   *
   * - Timed events (`start.dateTime`): included when the start instant is
   *   within the window.
   * - All-day events (`start.date`): included when their calendar date
   *   overlaps with the window.
   *
   * @param timeMin Window start (inclusive).
   * @param timeMax Window end (inclusive).
   */
  async listEventsInTimeWindow(
    timeMin: Date,
    timeMax: Date
  ): Promise<CalendarEvent[]> {
    const events = await this.fetchAllEvents();

    return events.filter((event) => {
      if (event.start.dateTime) {
        const start = new Date(event.start.dateTime);
        return start >= timeMin && start <= timeMax;
      }
      if (event.start.date) {
        // All-day: include if any part of the day falls in the window.
        const dayStart = new Date(event.start.date + "T00:00:00");
        const dayEnd   = new Date(event.start.date + "T23:59:59");
        return dayEnd >= timeMin && dayStart <= timeMax;
      }
      return false;
    });
  }

  /**
   * Return up to `maxResults` events starting after now and within
   * `daysAhead` days, sorted ascending by start time.
   *
   * @param maxResults Maximum events to return (1–50).
   * @param daysAhead  How many days ahead to look.
   */
  async listUpcomingEvents(
    maxResults: number,
    daysAhead: number
  ): Promise<CalendarEvent[]> {
    const now       = new Date();
    const windowEnd = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1_000);

    const events = await this.listEventsInTimeWindow(now, windowEnd);

    // Sort ascending by start time.
    events.sort((a, b) => {
      const ta = new Date(
        a.start.dateTime ?? (a.start.date ?? "") + "T00:00:00"
      ).getTime();
      const tb = new Date(
        b.start.dateTime ?? (b.start.date ?? "") + "T00:00:00"
      ).getTime();
      return ta - tb;
    });

    return events.slice(0, maxResults);
  }
}
