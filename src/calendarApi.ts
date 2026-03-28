const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
    optional?: boolean;
  }>;
  organizer?: {
    email: string;
    displayName?: string;
    self?: boolean;
  };
  location?: string;
  htmlLink?: string;
  status?: string;
  conferenceData?: {
    conferenceSolution?: { name: string };
    entryPoints?: Array<{
      entryPointType: string;
      uri: string;
      label?: string;
    }>;
  };
  recurrence?: string[];
  recurringEventId?: string;
}

export interface Calendar {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  selected?: boolean;
}

export class GoogleCalendarApi {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(
    path: string,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${CALENDAR_API_BASE}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const message = error?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`Google Calendar API error: ${message}`);
    }

    return response.json() as Promise<T>;
  }

  async listCalendars(): Promise<Calendar[]> {
    const data = await this.request<{ items: Calendar[] }>(
      "/users/me/calendarList"
    );
    return data.items ?? [];
  }

  /**
   * Fetch upcoming events from the given calendar.
   * @param calendarId  Calendar ID (e.g. "primary")
   * @param maxResults  Max number of events to return
   * @param daysAhead   How many days into the future to search
   */
  async listUpcomingEvents(
    calendarId: string,
    maxResults = 20,
    daysAhead = 7
  ): Promise<CalendarEvent[]> {
    const now = new Date();
    const future = new Date(
      now.getTime() + daysAhead * 24 * 60 * 60 * 1000
    );

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

  async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    );
  }
}
