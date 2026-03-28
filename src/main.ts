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

export default class GoogleCalendarPlugin extends Plugin {
  settings: GoogleCalendarSettings;

  async onload() {
    await this.loadSettings();

    // Ribbon icon — quick access to the event picker
    this.addRibbonIcon(
      "calendar-days",
      "Create note from Google Calendar event",
      () => this.pickEventAndCreateNote()
    );

    // Command: pick from upcoming events
    this.addCommand({
      id: "create-note-from-event",
      name: "Create note from Google Calendar event",
      callback: () => this.pickEventAndCreateNote(),
    });

    // Command: create a note for the very next upcoming event (no picker)
    this.addCommand({
      id: "create-note-for-next-event",
      name: "Create note for next upcoming event",
      callback: () => this.createNoteForNextEvent(),
    });

    // Settings tab
    this.addSettingTab(new GoogleCalendarSettingTab(this.app, this));
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ---------------------------------------------------------------------------
  // Token management
  // ---------------------------------------------------------------------------

  /**
   * Return a valid access token, refreshing it if needed.
   * Shows a Notice and returns null if credentials are missing or refresh fails.
   */
  private async getValidAccessToken(): Promise<string | null> {
    if (!this.settings.clientId || !this.settings.clientSecret) {
      new Notice(
        "Google Calendar: Please configure your API credentials in Settings → Google Calendar Note Integration."
      );
      return null;
    }

    if (!this.settings.refreshToken) {
      new Notice(
        "Google Calendar: Please authenticate with Google in the plugin settings."
      );
      return null;
    }

    // Refresh if the access token is expired or about to expire (within 60 s)
    if (Date.now() >= this.settings.tokenExpiry - 60_000) {
      try {
        const auth = new GoogleAuth(
          this.settings.clientId,
          this.settings.clientSecret
        );
        const tokens = await auth.refreshAccessToken(
          this.settings.refreshToken
        );
        this.settings.accessToken = tokens.access_token;
        this.settings.tokenExpiry = tokens.expiry_date;
        // Google may return a new refresh token; persist it if so
        if (tokens.refresh_token) {
          this.settings.refreshToken = tokens.refresh_token;
        }
        await this.saveSettings();
      } catch (err) {
        new Notice(
          `Google Calendar: Failed to refresh token — ${err.message}. Please re-authenticate in settings.`
        );
        return null;
      }
    }

    return this.settings.accessToken;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /** Fetch upcoming events and let the user pick one via fuzzy search. */
  async pickEventAndCreateNote() {
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
          `No upcoming events found in the next ${this.settings.daysAhead} day${this.settings.daysAhead !== 1 ? "s" : ""}.`
        );
        return;
      }

      new EventSuggestModal(this.app, events, (event) =>
        this.createAndOpenNote(event)
      ).open();
    } catch (err) {
      loadingNotice.hide();
      new Notice(`Google Calendar: ${err.message}`);
    }
  }

  /** Fetch only the next upcoming event and create a note for it immediately. */
  async createNoteForNextEvent() {
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
      new Notice(`Google Calendar: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Note creation
  // ---------------------------------------------------------------------------

  private async createAndOpenNote(event: CalendarEvent) {
    try {
      const file: TFile = await createNoteFile(
        this.app,
        event,
        this.settings.noteFolder
      );

      // Open the note in the current leaf
      await this.app.workspace.getLeaf(false).openFile(file);

      new Notice(`Note ready: ${file.name}`);
    } catch (err) {
      new Notice(`Google Calendar: Failed to create note — ${err.message}`);
    }
  }
}
