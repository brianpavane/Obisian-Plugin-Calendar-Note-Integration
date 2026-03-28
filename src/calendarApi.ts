/**
 * @file calendarApi.ts
 * @description Thin wrapper around the Google Calendar REST API v3.
 *
 * All requests are authenticated with a Bearer token (OAuth 2.0 access token)
 * and are subject to a 10-second timeout. The caller is responsible for
 * obtaining and refreshing the access token via {@link GoogleAuth}.
 *
 * Only the calendar.readonly scope is used; no write operations are performed.
 */

/** Base URL for all Google Calendar API v3 endpoints. */
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

/** Milliseconds before a Calendar API fetch is aborted. */
const FETCH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/**
 * A single Google Calendar event as returned by the Events.list / Events.get
 * endpoints. Only the fields consumed by this plugin are declared; additional
 * fields returned by the API are ignored.
 */
export interface CalendarEvent {
  /** Stable, opaque identifier for the event. */
  id: string;
  /** Human-readable title of the event. May contain arbitrary Unicode. */
  summary: string;
  /**
   * Free-form description / notes from the invite.
   * Google Calendar may return this as plain text or as HTML (rich-text events).
   */
  description?: string;
  /** Scheduled start time. Exactly one of `dateTime` or `date` will be set. */
  start: {
    /** ISO 8601 date-time string (timed events). */
    dateTime?: string;
    /** ISO 8601 date string "YYYY-MM-DD" (all-day events). */
    date?: string;
    /** IANA time-zone identifier, e.g. "America/New_York". */
    timeZone?: string;
  };
  /** Scheduled end time. Same shape as `start`. */
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  /**
   * List of people invited to the event.
   * The `self` flag marks the calendar owner's own entry.
   */
  attendees?: Array<{
    /** Email address (always present). */
    email: string;
    /** Display name, if the contact is in the user's directory. */
    displayName?: string;
    /** RSVP status: "accepted" | "declined" | "tentative" | "needsAction" */
    responseStatus?: string;
    /** True for the calendar owner's own attendee entry. */
    self?: boolean;
    /** True when this attendee is also the event organizer. */
    organizer?: boolean;
    /** True for optional invitees. */
    optional?: boolean;
  }>;
  /** The person who created / owns the event. */
  organizer?: {
    email: string;
    displayName?: string;
    /** True when the organizer is the calendar owner. */
    self?: boolean;
  };
  /** Physical or virtual location string from the event. */
  location?: string;
  /** URL to view the event in Google Calendar. */
  htmlLink?: string;
  /** Event status: "confirmed" | "tentative" | "cancelled". */
  status?: string;
  /**
   * Video-conferencing data (e.g. Google Meet links).
   * Only present when a conference solution is attached to the event.
   */
  conferenceData?: {
    conferenceSolution?: {
      /** Human-readable name, e.g. "Google Meet". */
      name: string;
    };
    entryPoints?: Array<{
      /** "video" | "phone" | "sip" | "more" */
      entryPointType: string;
      /** The actual URL or dial-in number. */
      uri: string;
      /** Optional label shown in the Google Calendar UI. */
      label?: string;
    }>;
  };
  /** RRULE strings for recurring events. */
  recurrence?: string[];
  /** ID of the recurring event series, for individual instances. */
  recurringEventId?: string;
}

/**
 * A calendar entry from the user's calendar list.
 */
export interface Calendar {
  /** Unique calendar ID (often an email address for personal calendars). */
  id: string;
  /** Display name of the calendar. */
  summary: string;
  /** Optional description. */
  description?: string;
  /** True for the user's primary calendar. */
  primary?: boolean;
  /** True when the calendar is shown in the Google Calendar UI. */
  selected?: boolean;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

/**
 * Minimal read-only client for the Google Calendar API v3.
 *
 * @example
 * ```ts
 * const api = new GoogleCalendarApi(accessToken);
 * const events = await api.listUpcomingEvents("primary", 20, 7);
 * ```
 */
export class GoogleCalendarApi {
  private readonly accessToken: string;

  /**
   * @param accessToken A valid OAuth 2.0 access token with the
   *                    `calendar.readonly` scope.
   */
  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  /**
   * Retrieve the authenticated user's calendar list.
   *
   * @returns Array of calendars the user has access to.
   * @throws  On network failure, timeout, or API error.
   */
  async listCalendars(): Promise<Calendar[]> {
    const data = await this.request<{ items: Calendar[] }>(
      "/users/me/calendarList"
    );
    return data.items ?? [];
  }

  /**
   * Fetch upcoming events from a calendar, ordered by start time.
   *
   * @param calendarId  Calendar to query. Use `"primary"` for the user's
   *                    default calendar or pass a specific calendar email/ID.
   * @param maxResults  Maximum number of events to return (1–2500).
   * @param daysAhead   How many days into the future to search.
   * @returns Events starting between now and `now + daysAhead` days.
   * @throws  On network failure, timeout, or API error.
   */
  async listUpcomingEvents(
    calendarId: string,
    maxResults = 20,
    daysAhead = 7
  ): Promise<CalendarEvent[]> {
    const now = new Date();
    const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1_000);

    const data = await this.request<{ items: CalendarEvent[] }>(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        timeMin: now.toISOString(),
        timeMax: future.toISOString(),
        maxResults: String(maxResults),
        singleEvents: "true",
        orderBy: "startTime",
      }
    );

    return data.items ?? [];
  }

  /**
   * Fetch events that start within an absolute time window.
   *
   * Used by the auto-create polling loop to find events starting within
   * the next N hours, independent of the `daysAhead` picker setting.
   *
   * @param calendarId  Calendar to query.
   * @param timeMin     Window start (inclusive).
   * @param timeMax     Window end (exclusive).
   * @param maxResults  Maximum number of events to return.
   * @returns Events starting in [timeMin, timeMax).
   * @throws  On network failure, timeout, or API error.
   */
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

  /**
   * Fetch a single event by ID.
   *
   * @param calendarId Calendar that owns the event.
   * @param eventId    Stable event identifier.
   * @throws  On network failure, timeout, or API error.
   */
  async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Execute an authenticated GET request against the Calendar API.
   *
   * Applies a {@link FETCH_TIMEOUT_MS} timeout. On non-2xx responses,
   * attempts to parse the API error message from the response body.
   *
   * @param path    API path relative to {@link CALENDAR_API_BASE}.
   * @param params  Optional query-string parameters.
   */
  private async request<T>(
    path: string,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${CALENDAR_API_BASE}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const message =
        (errorBody as { error?: { message?: string } })?.error?.message ??
        `HTTP ${response.status}`;
      throw new Error(`Google Calendar API error: ${message}`);
    }

    return response.json() as Promise<T>;
  }
}
