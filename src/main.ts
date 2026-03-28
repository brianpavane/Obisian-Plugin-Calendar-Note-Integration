/**
 * @file main.ts
 * @description Entry point for the Google Calendar Note Integration plugin.
 *
 * Responsibilities:
 *   - Register Obsidian commands and the ribbon icon.
 *   - Manage OAuth token lifecycle (obtain, refresh, persist).
 *   - Run a startup sweep and a recurring poll to auto-create meeting notes
 *     for events starting within the configured advance window.
 *   - Expose the settings tab.
 */

import { Notice, Plugin, TFile } from "obsidian";
import {
  GoogleCalendarSettings,
  DEFAULT_SETTINGS,
  GoogleCalendarSettingTab,
} from "./settings";
import { GoogleAuth } from "./googleAuth";
import { GoogleCalendarApi, CalendarEvent } from "./calendarApi";
import { EventSuggestModal } from "./eventModal";
import { createNoteFile } from "./noteCreator";

/**
 * Main plugin class for Google Calendar Note Integration.
 *
 * Lifecycle:
 *   `onload` → registers UI, starts background polling
 *   Obsidian calls `onunload` automatically; registered intervals are
 *   cleaned up by Obsidian via `registerInterval`.
 */
export default class GoogleCalendarPlugin extends Plugin {
  /** Persisted plugin configuration. Loaded in `onload`, saved on change. */
  settings!: GoogleCalendarSettings;

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
    // Delay 5 s to let the vault finish indexing before writing files.
    setTimeout(() => this.autoCreateUpcomingNotes(false), 5_000);

    // ----- Recurring poll ----------------------------------------------------
    // `registerInterval` wraps `window.setInterval` and automatically clears
    // the interval when the plugin is unloaded — no manual `onunload` needed.
    this.registerInterval(
      window.setInterval(
        () => this.autoCreateUpcomingNotes(false),
        this.settings.pollIntervalMinutes * 60 * 1_000
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Settings persistence
  // ---------------------------------------------------------------------------

  /**
   * Load settings from Obsidian's plugin data store, merging with defaults
   * so that new settings added in future versions are always initialised.
   */
  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  /**
   * Persist the current settings to Obsidian's plugin data store.
   * Should be called after every settings mutation.
   */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ---------------------------------------------------------------------------
  // Token management
  // ---------------------------------------------------------------------------

  /**
   * Refresh the stored access token using the refresh token.
   * Persists the new token data to settings on success.
   *
   * @returns `true` on success, `false` if the refresh failed.
   * @param showError When `true`, shows a Notice on failure (interactive use).
   */
  private async refreshTokens(showError: boolean): Promise<boolean> {
    try {
      const auth = new GoogleAuth(
        this.settings.clientId,
        this.settings.clientSecret
      );
      const tokens = await auth.refreshAccessToken(this.settings.refreshToken);
      this.settings.accessToken = tokens.access_token;
      this.settings.tokenExpiry = tokens.expiry_date;
      // Google may issue a new refresh token; always persist it when present.
      if (tokens.refresh_token) {
        this.settings.refreshToken = tokens.refresh_token;
      }
      await this.saveSettings();
      return true;
    } catch (err) {
      if (showError) {
        new Notice(
          `Google Calendar: Failed to refresh token — ${(err as Error).message}. ` +
            "Please re-authenticate in Settings."
        );
      }
      return false;
    }
  }

  /**
   * Obtain a valid access token for interactive commands.
   *
   * Shows descriptive Notices when credentials are missing or refresh fails,
   * so the user knows exactly what action to take.
   *
   * @returns A non-empty access token string, or `null` on any failure.
   */
  private async getValidAccessToken(): Promise<string | null> {
    if (!this.settings.clientId || !this.settings.clientSecret) {
      new Notice(
        "Google Calendar: Please configure your API credentials in " +
          "Settings → Google Calendar Note Integration."
      );
      return null;
    }
    if (!this.settings.refreshToken) {
      new Notice(
        "Google Calendar: Please authenticate with Google in the plugin settings."
      );
      return null;
    }

    // Refresh proactively if the token expires within 60 s.
    if (Date.now() >= this.settings.tokenExpiry - 60_000) {
      const ok = await this.refreshTokens(true);
      if (!ok) return null;
    }

    return this.settings.accessToken || null;
  }

  /**
   * Obtain a valid access token for silent background operations.
   *
   * Returns `null` without any Notice when credentials are absent — prevents
   * noisy errors during the startup sweep before the user has authenticated.
   *
   * @returns A non-empty access token string, or `null` on any failure.
   */
  private async getValidAccessTokenSilent(): Promise<string | null> {
    if (!this.settings.clientId || !this.settings.clientSecret) return null;
    if (!this.settings.refreshToken) return null;

    if (Date.now() >= this.settings.tokenExpiry - 60_000) {
      const ok = await this.refreshTokens(false);
      if (!ok) return null;
    }

    return this.settings.accessToken || null;
  }

  // ---------------------------------------------------------------------------
  // Auto-create: startup + polling
  // ---------------------------------------------------------------------------

  /**
   * Fetch events starting within the next `hoursInAdvance` hours and create
   * a meeting note for each one that does not already have one.
   *
   * This method is called:
   *   - Once at startup (after a 5 s delay), with `verbose = false`.
   *   - Every `pollIntervalMinutes` minutes, with `verbose = false`.
   *   - By the manual command, with `verbose = true`.
   *
   * Notes are created idempotently — existing files are never overwritten.
   *
   * @param verbose When `true`, always shows a summary Notice on completion.
   *                When `false`, only shows a Notice when new notes are created.
   */
  async autoCreateUpcomingNotes(verbose: boolean): Promise<void> {
    const token = await this.getValidAccessTokenSilent();
    if (!token) return;

    const now = new Date();
    const windowEnd = new Date(
      now.getTime() + this.settings.hoursInAdvance * 60 * 60 * 1_000
    );

    let events: CalendarEvent[];
    try {
      const api = new GoogleCalendarApi(token);
      events = await api.listEventsInTimeWindow(
        this.settings.calendarId,
        now,
        windowEnd
      );
    } catch (err) {
      if (verbose) {
        new Notice(`Google Calendar: ${(err as Error).message}`);
      }
      return;
    }

    let created = 0;
    for (const event of events) {
      try {
        const result = await createNoteFile(
          this.app,
          event,
          this.settings.noteFolder
        );
        if (result.wasCreated) created++;
      } catch {
        // Skip individual failures silently; one bad event should not
        // prevent notes being created for the remaining events.
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
   * Fetch upcoming events (within the `daysAhead` window) and open the
   * fuzzy-search picker so the user can choose which event to create a
   * note for.
   */
  async pickEventAndCreateNote(): Promise<void> {
    const token = await this.getValidAccessToken();
    if (!token) return;

    const loadingNotice = new Notice("Fetching upcoming events…", 0);

    try {
      const api = new GoogleCalendarApi(token);
      const events = await api.listUpcomingEvents(
        this.settings.calendarId,
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

      new EventSuggestModal(this.app, events, (event) =>
        this.createAndOpenNote(event)
      ).open();
    } catch (err) {
      loadingNotice.hide();
      new Notice(`Google Calendar: ${(err as Error).message}`);
    }
  }

  /**
   * Immediately create (or open) a note for the next upcoming event without
   * showing the picker.
   */
  async createNoteForNextEvent(): Promise<void> {
    const token = await this.getValidAccessToken();
    if (!token) return;

    const loadingNotice = new Notice("Fetching next event…", 0);

    try {
      const api = new GoogleCalendarApi(token);
      const events = await api.listUpcomingEvents(
        this.settings.calendarId,
        1,
        this.settings.daysAhead
      );
      loadingNotice.hide();

      if (events.length === 0) {
        new Notice("No upcoming events found.");
        return;
      }

      await this.createAndOpenNote(events[0]);
    } catch (err) {
      loadingNotice.hide();
      new Notice(`Google Calendar: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Note creation helpers
  // ---------------------------------------------------------------------------

  /**
   * Create (or retrieve) the meeting note for `event` and open it in the
   * current editor leaf.
   *
   * @param event The calendar event to create a note for.
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
        `Google Calendar: Failed to create note — ${(err as Error).message}`
      );
    }
  }
}
