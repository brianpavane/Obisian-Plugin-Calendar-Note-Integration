/**
 * @file main.ts
 * @description Entry point for the Google Calendar Note Integration plugin.
 *
 * Supports three authentication modes:
 *   - iCal URL  — fetches from the Google Calendar secret iCal address
 *   - OAuth 2.0 — fetches from the Google Calendar REST API with user tokens
 *   - Apple     — reads from Calendar.app on macOS via JXA (no auth)
 *
 * Responsibilities:
 *   - Register Obsidian commands and the ribbon icon.
 *   - Run a startup sweep and a recurring poll to auto-create meeting notes.
 *   - Manage OAuth token refresh transparently.
 *   - Apply the `selfEmail` setting to exclude the user's own attendee entry.
 *   - Expose the settings tab.
 */

import { Notice, Plugin, TFile } from "obsidian";
import {
  GoogleCalendarSettings,
  DEFAULT_SETTINGS,
  GoogleCalendarSettingTab,
} from "./settings";
import { CalendarService, CalendarEvent } from "./calendarApi";
import { GoogleAuth } from "./googleAuth";
import { encrypt, decrypt } from "./secureStorage";
import { EventSuggestModal } from "./eventModal";
import { createNoteFile, NoteOptions } from "./noteCreator";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/[\r\n]+/g, " ").slice(0, 200);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class GoogleCalendarPlugin extends Plugin {
  settings!: GoogleCalendarSettings;

  private startupTimeoutId: number | undefined;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon(
      "calendar-days",
      "Create note from Google Calendar event",
      () => this.pickEventAndCreateNote()
    );

    this.addCommand({
      id: "create-note-from-event",
      name: "Create note from Google Calendar event",
      callback: () => this.pickEventAndCreateNote(),
    });

    this.addCommand({
      id: "create-note-for-next-event",
      name: "Create note for next upcoming event",
      callback: () => this.createNoteForNextEvent(),
    });

    this.addCommand({
      id: "auto-create-upcoming-notes",
      name: "Auto-create notes for events in the next N hours",
      callback: () => this.autoCreateUpcomingNotes(true),
    });

    this.addSettingTab(new GoogleCalendarSettingTab(this.app, this));

    this.startupTimeoutId = window.setTimeout(
      () => this.autoCreateUpcomingNotes(false),
      5_000
    );

    this.registerInterval(
      window.setInterval(
        () => this.autoCreateUpcomingNotes(false),
        this.settings.pollIntervalMinutes * 60 * 1_000
      )
    );
  }

  onunload(): void {
    if (this.startupTimeoutId !== undefined) {
      window.clearTimeout(this.startupTimeoutId);
    }
  }

  // ---------------------------------------------------------------------------
  // Settings persistence
  // ---------------------------------------------------------------------------

  async loadSettings(): Promise<void> {
    const stored =
      ((await this.loadData()) as Partial<GoogleCalendarSettings>) ?? {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, stored);

    merged.daysAhead = clamp(
      Number(merged.daysAhead) || DEFAULT_SETTINGS.daysAhead, 1, 30
    );
    merged.maxEvents = clamp(
      Number(merged.maxEvents) || DEFAULT_SETTINGS.maxEvents, 1, 50
    );
    merged.hoursInAdvance = clamp(
      Number(merged.hoursInAdvance) || DEFAULT_SETTINGS.hoursInAdvance, 1, 48
    );
    merged.pollIntervalMinutes = clamp(
      Number(merged.pollIntervalMinutes) || DEFAULT_SETTINGS.pollIntervalMinutes,
      5, 120
    );
    merged.daysBack = clamp(
      Number(merged.daysBack) || DEFAULT_SETTINGS.daysBack, 1, 30
    );

    // Sanitize boolean fields
    if (typeof merged.includePastEvents !== "boolean") {
      merged.includePastEvents = DEFAULT_SETTINGS.includePastEvents;
    }
    if (typeof merged.includeEventNotes !== "boolean") {
      merged.includeEventNotes = DEFAULT_SETTINGS.includeEventNotes;
    }
    if (typeof merged.includeConferenceLinks !== "boolean") {
      merged.includeConferenceLinks = DEFAULT_SETTINGS.includeConferenceLinks;
    }

    // Sanitize enum field
    if (!["before", "after"].includes(merged.datePosition)) {
      merged.datePosition = DEFAULT_SETTINGS.datePosition;
    }

    this.settings = merged;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ---------------------------------------------------------------------------
  // Auth helpers
  // ---------------------------------------------------------------------------

  private isConfigured(): boolean {
    if (this.settings.authMode === "oauth") {
      return !!(
        this.settings.clientId &&
        decrypt(this.settings.clientSecret) &&
        this.settings.refreshToken
      );
    }
    if (this.settings.authMode === "apple") return true;
    return !!decrypt(this.settings.icalUrl);
  }

  async getValidAccessToken(): Promise<string> {
    const needsRefresh =
      !this.settings.accessToken ||
      Date.now() > this.settings.tokenExpiry - 60_000;

    if (!needsRefresh) return decrypt(this.settings.accessToken);

    const refreshToken = decrypt(this.settings.refreshToken);
    if (!refreshToken) {
      throw new Error(
        "Not authenticated. Please sign in via Settings → Google Calendar Note Integration."
      );
    }

    const auth = new GoogleAuth(this.settings.clientId, decrypt(this.settings.clientSecret));
    const tokens = await auth.refreshAccessToken(refreshToken);
    this.settings.accessToken = encrypt(tokens.access_token);
    if (tokens.refresh_token) {
      this.settings.refreshToken = encrypt(tokens.refresh_token);
    }
    this.settings.tokenExpiry = tokens.expiry_date;
    await this.saveSettings();
    return tokens.access_token;
  }

  async getCalendarService(): Promise<CalendarService> {
    if (this.settings.authMode === "oauth") {
      const accessToken = await this.getValidAccessToken();
      return CalendarService.fromOAuth(
        accessToken,
        this.settings.calendarId || "primary"
      );
    }
    if (this.settings.authMode === "apple") {
      const calendarFilter = this.settings.appleCalendars
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // daysBack = 0 when past events disabled → JXA windowStart = today.
      const daysBack  = this.settings.includePastEvents ? this.settings.daysBack : 0;
      const daysAhead = this.settings.daysAhead;
      const timeoutMs    = (this.settings.appleTimeoutSeconds ?? 30) * 1000;
      const skipTier3    = this.settings.appleSkipTier3 ?? false;
      const maxTier3Scan = this.settings.appleMaxTier3Scan ?? 500;
      return CalendarService.fromApple(calendarFilter, daysBack, daysAhead, timeoutMs, skipTier3, maxTier3Scan);
    }
    return CalendarService.fromIcal(decrypt(this.settings.icalUrl));
  }

  // ---------------------------------------------------------------------------
  // NoteOptions builder
  // ---------------------------------------------------------------------------

  private getNoteOptions(): NoteOptions {
    return {
      noteFolder: this.settings.noteFolder,
      includeEventNotes: this.settings.includeEventNotes,
      includeConferenceLinks: this.settings.includeConferenceLinks,
      datePosition: this.settings.datePosition,
    };
  }

  // ---------------------------------------------------------------------------
  // All-day event filter
  // ---------------------------------------------------------------------------

  /** Remove all-day events — they have only `start.date`, no `start.dateTime`. */
  private filterOutAllDay(events: CalendarEvent[]): CalendarEvent[] {
    return events.filter((e) => !!e.start.dateTime);
  }

  // ---------------------------------------------------------------------------
  // Self-email helper
  // ---------------------------------------------------------------------------

  private markSelfAttendee(events: CalendarEvent[]): CalendarEvent[] {
    const selfEmail = this.settings.selfEmail.trim().toLowerCase();
    if (!selfEmail) return events;

    return events.map((event) => ({
      ...event,
      attendees: event.attendees?.map((a) => ({
        ...a,
        self: a.self ?? (a.email.toLowerCase() === selfEmail),
      })),
    }));
  }

  // ---------------------------------------------------------------------------
  // Auto-create: startup + polling
  // ---------------------------------------------------------------------------

  async autoCreateUpcomingNotes(verbose: boolean): Promise<void> {
    if (!this.isConfigured()) return;

    const now = new Date();
    // Optionally extend window backward to include past events
    const timeMin = this.settings.includePastEvents
      ? new Date(now.getTime() - this.settings.daysBack * 24 * 60 * 60 * 1_000)
      : now;
    const timeMax = new Date(
      now.getTime() + this.settings.hoursInAdvance * 60 * 60 * 1_000
    );

    let events: CalendarEvent[];
    try {
      const svc = await this.getCalendarService();
      events = await svc.listEventsInTimeWindow(timeMin, timeMax);
    } catch (err) {
      if (verbose) new Notice(`Google Calendar: ${safeErrorMessage(err)}`);
      return;
    }

    events = this.filterOutAllDay(events);
    events = this.markSelfAttendee(events);
    const options = this.getNoteOptions();

    let created = 0;
    for (const event of events) {
      try {
        const result = await createNoteFile(this.app, event, options);
        if (result.wasCreated) created++;
      } catch (err) {
        console.debug("[gcal-notes] Failed to create note for event:", err);
      }
    }

    if (verbose) {
      new Notice(
        created > 0
          ? `Google Calendar: Created ${created} new note${created !== 1 ? "s" : ""}.`
          : `Google Calendar: No new notes needed — all events already have notes.`
      );
    } else if (created > 0) {
      new Notice(
        `Google Calendar: Auto-created ${created} meeting note${created !== 1 ? "s" : ""}.`,
        4_000
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Interactive commands
  // ---------------------------------------------------------------------------

  async pickEventAndCreateNote(): Promise<void> {
    if (!this.isConfigured()) {
      new Notice(
        "Google Calendar: Please configure your connection in " +
          "Settings → Google Calendar Note Integration."
      );
      return;
    }

    const loadingNotice = new Notice("Fetching upcoming events…", 0);
    try {
      const svc = await this.getCalendarService();
      let events = await svc.listUpcomingEvents(
        this.settings.maxEvents,
        this.settings.daysAhead
      );
      loadingNotice.hide();

      events = this.filterOutAllDay(events);

      if (events.length === 0) {
        new Notice(
          `No upcoming events found in the next ${this.settings.daysAhead} ` +
            `day${this.settings.daysAhead !== 1 ? "s" : ""}.`
        );
        return;
      }

      events = this.markSelfAttendee(events);
      new EventSuggestModal(this.app, events, (event) =>
        this.createAndOpenNote(event)
      ).open();
    } catch (err) {
      loadingNotice.hide();
      new Notice(`Google Calendar: ${safeErrorMessage(err)}`);
    }
  }

  async createNoteForNextEvent(): Promise<void> {
    if (!this.isConfigured()) {
      new Notice(
        "Google Calendar: Please configure your connection in " +
          "Settings → Google Calendar Note Integration."
      );
      return;
    }

    const loadingNotice = new Notice("Fetching next event…", 0);
    try {
      const svc = await this.getCalendarService();
      let events = await svc.listUpcomingEvents(
        this.settings.maxEvents,
        this.settings.daysAhead
      );
      loadingNotice.hide();

      events = this.filterOutAllDay(events);

      if (events.length === 0) {
        new Notice("No upcoming events found.");
        return;
      }

      events = this.markSelfAttendee(events);
      await this.createAndOpenNote(events[0]);
    } catch (err) {
      loadingNotice.hide();
      new Notice(`Google Calendar: ${safeErrorMessage(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Note creation helper
  // ---------------------------------------------------------------------------

  private async createAndOpenNote(event: CalendarEvent): Promise<void> {
    try {
      const { file } = await createNoteFile(this.app, event, this.getNoteOptions());
      await this.app.workspace.getLeaf(false).openFile(file as TFile);
      new Notice(`Note ready: ${file.name}`);
    } catch (err) {
      new Notice(
        `Google Calendar: Failed to create note — ${safeErrorMessage(err)}`
      );
    }
  }
}
