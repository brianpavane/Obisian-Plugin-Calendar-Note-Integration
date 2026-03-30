/**
 * @file calendarApi.ts
 * @description Google Calendar clients for both iCal and REST API access.
 *
 * Exports three classes:
 *   - {@link IcalCalendarApi}    — fetches from a secret iCal URL (no auth)
 *   - {@link GoogleCalendarApi} — fetches via REST API with an OAuth access token
 *   - {@link CalendarService}   — unified adapter; wraps either backend
 *
 * Use {@link CalendarService} in application code so the auth mode can be
 * switched without changing call sites.
 */

export { CalendarEvent, ResponseStatus } from "./icalParser";
import { CalendarEvent } from "./icalParser";
import { parseIcal } from "./icalParser";
import { requestUrl } from "obsidian";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Milliseconds before an iCal fetch is aborted. */
const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a URL using Obsidian's `requestUrl` API, which routes the request
 * through Electron's main process and is therefore not subject to browser
 * CORS restrictions.
 *
 * Native `fetch()` fails for Google Calendar iCal URLs because the endpoint
 * does not set `Access-Control-Allow-Origin` headers — the Electron renderer
 * process (where Obsidian plugins run) blocks the response. `requestUrl`
 * bypasses this entirely.
 *
 * A manual timeout is implemented via `Promise.race` because `requestUrl`
 * does not natively support `AbortController`.
 *
 * @throws On timeout, non-2xx HTTP status, or network failure.
 */
async function fetchIcalText(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`iCal request timed out after ${timeoutMs / 1000} seconds.`)),
      timeoutMs
    )
  );

  const fetchPromise = requestUrl({ url, method: "GET", throw: false }).then(
    (response) => {
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `Failed to fetch iCal feed: HTTP ${response.status}. ` +
            "Check that the iCal URL is correct and has not been regenerated in Google Calendar."
        );
      }
      const text = response.text;
      // Validate that we received iCal content, not an HTML login page or error.
      const trimmed = text.trimStart();
      if (!trimmed.startsWith("BEGIN:VCALENDAR")) {
        const preview = trimmed.slice(0, 120).replace(/[\r\n]+/g, " ");
        console.error(
          "[GoogleCalendarNotes] Unexpected iCal response. " +
          `HTTP ${response.status}. First 120 chars: ${preview}`
        );
        throw new Error(
          "iCal URL did not return a valid calendar feed. " +
          "This usually means the calendar requires authentication — " +
          "check that you are using the 'Secret address in iCal format' " +
          "(not the public URL), and that your organization has not " +
          "disabled external iCal access. " +
          `Response preview: "${preview}"`
        );
      }
      return text;
    }
  );

  return Promise.race([fetchPromise, timeoutPromise]);
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
    const text = await fetchIcalText(url);
    const events = parseIcal(text);
    console.log(
      `[GoogleCalendarNotes] Fetched iCal feed: ${text.length} bytes, ` +
      `${text.split("BEGIN:VEVENT").length - 1} VEVENT blocks, ` +
      `${events.length} parsed events.`
    );
    if (events.length > 0) {
      console.log(
        "[GoogleCalendarNotes] First event:",
        events[0].summary,
        events[0].start
      );
    }
    return events;
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

// ---------------------------------------------------------------------------
// Google Calendar REST API client
// ---------------------------------------------------------------------------

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const REST_TIMEOUT_MS = 10_000;

/** A calendar entry from the user's calendar list. */
export interface Calendar {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  selected?: boolean;
}

/**
 * Read-only client for the Google Calendar REST API v3.
 * Requires a valid OAuth 2.0 access token with the `calendar.readonly` scope.
 * Uses `requestUrl` (Electron main process) for all requests.
 */
export class GoogleCalendarApi {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /** Retrieve the user's calendar list. */
  async listCalendars(): Promise<Calendar[]> {
    const data = await this.request<{ items: Calendar[] }>("/users/me/calendarList");
    return data.items ?? [];
  }

  /** Fetch up to `maxResults` events starting between now and `daysAhead` days. */
  async listUpcomingEvents(
    calendarId: string,
    maxResults = 20,
    daysAhead = 7
  ): Promise<CalendarEvent[]> {
    const now = new Date();
    const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1_000);
    return this.listEventsInTimeWindow(calendarId, now, future, maxResults);
  }

  /** Fetch events whose start falls within [timeMin, timeMax). */
  async listEventsInTimeWindow(
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
    maxResults = 50
  ): Promise<CalendarEvent[]> {
    const data = await this.request<{ items: CalendarEvent[] }>(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: String(maxResults),
        singleEvents: "true",
        orderBy: "startTime",
      }
    );
    return data.items ?? [];
  }

  private async request<T>(
    path: string,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${CALENDAR_API_BASE}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Google Calendar API request timed out.")),
        REST_TIMEOUT_MS
      )
    );

    const fetchPromise = requestUrl({
      url: url.toString(),
      method: "GET",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      throw: false,
    }).then((response) => {
      if (response.status < 200 || response.status >= 300) {
        const message =
          (response.json as { error?: { message?: string } })?.error?.message ??
          `HTTP ${response.status}`;
        throw new Error(`Google Calendar API error: ${message}`);
      }
      return response.json as T;
    });

    return Promise.race([fetchPromise, timeoutPromise]);
  }
}

// ---------------------------------------------------------------------------
// Unified CalendarService adapter
// ---------------------------------------------------------------------------

/**
 * Unified interface over both iCal and REST API backends.
 *
 * Use the static factory methods to create an instance:
 * ```ts
 * const svc = CalendarService.fromIcal(settings.icalUrl);
 * const svc = CalendarService.fromOAuth(accessToken, calendarId);
 * ```
 */
export class CalendarService {
  private readonly icalApi?: IcalCalendarApi;
  private readonly restApi?: GoogleCalendarApi;
  private readonly calendarId: string;

  private constructor(
    icalApi: IcalCalendarApi | undefined,
    restApi: GoogleCalendarApi | undefined,
    calendarId: string
  ) {
    this.icalApi = icalApi;
    this.restApi = restApi;
    this.calendarId = calendarId;
  }

  static fromIcal(url: string): CalendarService {
    return new CalendarService(new IcalCalendarApi(url), undefined, "");
  }

  static fromOAuth(accessToken: string, calendarId: string): CalendarService {
    return new CalendarService(
      undefined,
      new GoogleCalendarApi(accessToken),
      calendarId || "primary"
    );
  }

  async fetchAllEvents(): Promise<CalendarEvent[]> {
    if (this.icalApi) return this.icalApi.fetchAllEvents();
    return this.restApi!.listUpcomingEvents(this.calendarId, 2500, 365);
  }

  async listEventsInTimeWindow(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    if (this.icalApi) return this.icalApi.listEventsInTimeWindow(timeMin, timeMax);
    return this.restApi!.listEventsInTimeWindow(this.calendarId, timeMin, timeMax);
  }

  async listUpcomingEvents(maxResults: number, daysAhead: number): Promise<CalendarEvent[]> {
    if (this.icalApi) return this.icalApi.listUpcomingEvents(maxResults, daysAhead);
    return this.restApi!.listUpcomingEvents(this.calendarId, maxResults, daysAhead);
  }
}
