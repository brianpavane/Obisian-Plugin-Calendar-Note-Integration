/**
 * @file main.ts
 * @description Entry point for the Google Calendar Note Integration plugin.
 *
 * This version uses the iCal protocol instead of the Google Calendar REST API.
 * Events are fetched directly from the user's Google Calendar "secret address"
 * iCal URL — no OAuth flow, no Google Cloud Console project, no API keys.
 *
 * Responsibilities:
 *   - Register Obsidian commands and the ribbon icon.
 *   - Run a startup sweep and a recurring poll to auto-create meeting notes
 *     for events starting within the configured advance window.
 *   - Apply the `selfEmail` setting to exclude the user's own attendee entry.
 *   - Expose the settings tab.
 */

import { Notice, Plugin, TFile } from "obsidian";
import {
  GoogleCalendarSettings,
  DEFAULT_SETTINGS,
  GoogleCalendarSettingTab,
} from "./settings";
import { IcalCalendarApi, CalendarEvent } from "./calendarApi";
import { EventSuggestModal } from "./eventModal";
import { createNoteFile } from "./noteCreator";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Clamp a number to an inclusive [min, max] range.
 * Used to sanitise numeric settings loaded from disk.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Extract a safe, single-line error message from an unknown thrown value.
 * Strips newlines (to prevent Notice injection) and caps length at 200 chars.
 */
function safeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/[\r\n]+/g, " ").slice(0, 200);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Main plugin class for Google Calendar Note Integration.
 *
 * Lifecycle:
 *   `onload`   → registers UI, starts background polling
 *   `onunload` → cancels the startup timeout (intervals are cleaned up
 *                automatically by Obsidian via `registerInterval`)
 */
export default class GoogleCalendarPlugin extends Plugin {
  /** Persisted plugin configuration. Loaded in `onload`, saved on change. */
  settings!: GoogleCalendarSettings;

  /**
   * Handle for the one-time startup timeout so it can be cancelled if the
   * plugin is unloaded within 5 seconds of loading.
   */
  private startupTimeoutId: number | undefined;

  async onload(): Promise<void> {
    await this.loadSettings();

    // ----- Ribbon icon -------------------------------------------------------
    this.addRibbonIcon(
      "calendar-days",
      "Create note from Google Calendar event",
      () => this.pickEventAndCreateNote()
    );

    // ----- Commands ----------------------------------------------------------
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

    // ----- Settings tab ------------------------------------------------------
    this.addSettingTab(new GoogleCalendarSettingTab(this.app, this));

    // ----- Startup sweep -----------------------------------------------------
    // 5-second delay lets the vault finish indexing before writing files.
    this.startupTimeoutId = window.setTimeout(
      () => this.autoCreateUpcomingNotes(false),
      5_000
    );

    // ----- Recurring poll ----------------------------------------------------
    // `registerInterval` wraps setInterval and auto-clears on plugin unload.
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

  /**
   * Load settings from Obsidian's plugin data store.
   * Merges with defaults so new settings added in future versions are always
   * initialised. Numeric fields are clamped to their legal ranges.
   */
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

    this.settings = merged;
  }

  /**
   * Persist the current settings to Obsidian's plugin data store.
   * Should be called after every settings mutation.
   */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ---------------------------------------------------------------------------
  // Self-email helper
  // ---------------------------------------------------------------------------

  /**
   * If the user has configured their own email address in settings, mark any
   * attendee whose email matches as `self: true`. `noteCreator.ts` uses this
   * flag to exclude the user's own entry from the attendees table.
   */
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

  /**
   * Fetch events starting within the next `hoursInAdvance` hours and create
   * a meeting note for each one that does not already have one.
   *
   * Called on startup (verbose = false), on the poll interval (verbose = false),
   * by the manual command and the settings Refresh button (verbose = true).
   *
   * @param verbose When `true`, always shows a summary Notice on completion.
   */
  async autoCreateUpcomingNotes(verbose: boolean): Promise<void> {
    if (!this.settings.icalUrl) return;

    const now = new Date();
    const windowEnd = new Date(
      now.getTime() + this.settings.hoursInAdvance * 60 * 60 * 1_000
    );

    let events: CalendarEvent[];
    try {
      const api = new IcalCalendarApi(this.settings.icalUrl);
      events = await api.listEventsInTimeWindow(now, windowEnd);
    } catch (err) {
      if (verbose) new Notice(`Google Calendar: ${safeErrorMessage(err)}`);
      return;
    }

    events = this.markSelfAttendee(events);

    let created = 0;
    for (const event of events) {
      try {
        const result = await createNoteFile(
          this.app,
          event,
          this.settings.noteFolder
        );
        if (result.wasCreated) created++;
      } catch (err) {
        console.debug("[gcal-notes] Failed to create note for event:", err);
      }
    }

    if (verbose) {
      new Notice(
        created > 0
          ? `Google Calendar: Created ${created} new note${created !== 1 ? "s" : ""} ` +
            `for events in the next ${this.settings.hoursInAdvance} hour${this.settings.hoursInAdvance !== 1 ? "s" : ""}.`
          : `Google Calendar: No new notes needed — all events in the next ` +
            `${this.settings.hoursInAdvance} hour${this.settings.hoursInAdvance !== 1 ? "s" : ""} already have notes.`
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

  /**
   * Fetch upcoming events and open the fuzzy-search picker so the user can
   * choose which event to create a note for.
   */
  async pickEventAndCreateNote(): Promise<void> {
    if (!this.settings.icalUrl) {
      new Notice(
        "Google Calendar: Please configure your iCal URL in " +
          "Settings → Google Calendar Note Integration."
      );
      return;
    }

    const loadingNotice = new Notice("Fetching upcoming events…", 0);
    try {
      const api = new IcalCalendarApi(this.settings.icalUrl);
      let events = await api.listUpcomingEvents(
        this.settings.maxEvents,
        this.settings.daysAhead
      );
      loadingNotice.hide();

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

  /**
   * Immediately create (or open) a note for the next upcoming event without
   * showing the picker.
   */
  async createNoteForNextEvent(): Promise<void> {
    if (!this.settings.icalUrl) {
      new Notice(
        "Google Calendar: Please configure your iCal URL in " +
          "Settings → Google Calendar Note Integration."
      );
      return;
    }

    const loadingNotice = new Notice("Fetching next event…", 0);
    try {
      const api = new IcalCalendarApi(this.settings.icalUrl);
      let events = await api.listUpcomingEvents(1, this.settings.daysAhead);
      loadingNotice.hide();

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

  /**
   * Create (or retrieve) the meeting note for `event` and open it in the
   * current editor leaf.
   */
  private async createAndOpenNote(event: CalendarEvent): Promise<void> {
    try {
      const { file } = await createNoteFile(
        this.app,
        event,
        this.settings.noteFolder
      );
      await this.app.workspace.getLeaf(false).openFile(file as TFile);
      new Notice(`Note ready: ${file.name}`);
    } catch (err) {
      new Notice(
        `Google Calendar: Failed to create note — ${safeErrorMessage(err)}`
      );
    }
  }
}
