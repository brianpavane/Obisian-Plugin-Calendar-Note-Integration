/**
 * @file main.ts
 * @description Entry point for Calendar Note Integration - Apple-iCal-Google.
 *
 * Supports three calendar sources:
 *   - Apple Calendar — reads from Calendar.app on macOS via EventKit (primary)
 *                      with JXA scripting-bridge fallback tiers
 *   - iCal URL       — fetches from the Google Calendar secret iCal address
 *   - OAuth 2.0      — fetches from the Google Calendar REST API with user tokens
 *
 * Responsibilities:
 *   - Register Obsidian commands and the ribbon icon.
 *   - Run a startup sweep and a recurring poll to auto-create meeting notes.
 *   - Manage OAuth token refresh transparently.
 *   - Apply the `selfEmail` setting to exclude the user's own attendee entry.
 *   - Expose the settings tab.
 */

import { normalizePath, Notice, Plugin, TFile } from "obsidian";
import { ActionItemsView, ACTION_ITEMS_VIEW } from "./actionItems";
import { DASHBOARD_CONTENT, DASHBOARD_FILENAME } from "./dashboard";
import { TodayView, TODAY_VIEW } from "./todayView";
import { currentOrNextMeeting, meetingToJoin, statusText } from "./meetingStatus";
import {
  GoogleCalendarSettings,
  DEFAULT_SETTINGS,
  GoogleCalendarSettingTab,
} from "./settings";
import { CalendarService, CalendarEvent } from "./calendarApi";
import { GoogleAuth } from "./googleAuth";
import { encrypt, decrypt } from "./secureStorage";
import { EventSuggestModal } from "./eventModal";
import {
  createNoteFile,
  findNotesByEventId,
  joinUrl,
  markNoteRemoved,
  resolveNoteFilePath,
  seriesOptions,
  syncNoteFile,
  DailyNoteConfig,
  NoteOptions,
} from "./noteCreator";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Events read for one sync, plus what is needed to spot meetings that disappeared. */
interface FetchResult {
  /** Events to sync notes for: in the window, timed, not declined. */
  events: CalendarEvent[];
  /** Same filtering, but including meetings already in progress (for the status bar). */
  live: CalendarEvent[];
  /** IDs of every event the calendar returned across its whole date range, before any filtering. */
  seenIds: Set<string>;
  /** Calendars the fetch covered; undefined when the source can't tell. */
  queriedCalendars?: string[];
  timeMin: Date;
  timeMax: Date;
}

/** How far back to look for meetings that are still in progress. */
const IN_PROGRESS_LOOKBACK_MS = 12 * 60 * 60 * 1_000;
/** "Join meeting" acts on a meeting starting within this long. */
const JOIN_WINDOW_MS = 30 * 60 * 1_000;

function frontmatterDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
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
  private pollIntervalId: number | undefined;
  private statusBarEl: HTMLElement | undefined;
  private liveEvents: CalendarEvent[] = [];
  private lastFetchFailed = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon(
      "calendar-days",
      "Create note from calendar event",
      () => this.pickEventAndCreateNote()
    );
    this.addRibbonIcon("calendar-clock", "Open today's meetings", () => this.openSidebarView(TODAY_VIEW));
    this.addRibbonIcon("list-checks", "Open meeting action items", () => this.openSidebarView(ACTION_ITEMS_VIEW));
    this.addRibbonIcon("layout-dashboard", "Open meetings dashboard", () => this.openDashboard());

    this.addCommand({
      id: "create-note-from-event",
      name: "Create note from calendar event",
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

    this.addCommand({
      id: "join-meeting",
      name: "Join current or next meeting",
      callback: () => this.joinMeeting(),
    });

    this.addCommand({
      id: "open-meetings-dashboard",
      name: "Open meetings dashboard",
      callback: () => this.openDashboard(),
    });

    this.registerView(ACTION_ITEMS_VIEW, (leaf) => new ActionItemsView(leaf, () => this.settings.noteFolder));
    this.registerView(TODAY_VIEW, (leaf) => new TodayView(leaf, {
      loadToday: () => this.loadTodayEvents(),
      notedEventIds: () => new Set(findNotesByEventId(this.app, this.settings.noteFolder).keys()),
      openNote: (event) => this.openNoteForEvent(event),
    }));

    this.addCommand({
      id: "open-action-items",
      name: "Open meeting action items",
      callback: () => this.openSidebarView(ACTION_ITEMS_VIEW),
    });

    this.addCommand({
      id: "open-today",
      name: "Open today's meetings",
      callback: () => this.openSidebarView(TODAY_VIEW),
    });

    this.addSettingTab(new GoogleCalendarSettingTab(this.app, this));

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("cal-notes-status");
    this.statusBarEl.setAttribute("aria-label", "Open the meeting note and join");
    this.statusBarEl.onClickEvent(() => this.joinMeeting());
    this.registerInterval(window.setInterval(() => this.updateStatusBar(), 30_000));
    this.updateStatusBar();

    this.startupTimeoutId = window.setTimeout(() => this.runStartupSweep(), 5_000);
    this.restartPolling();
  }

  /** Current time; a method so tests can pin it. */
  now(): Date {
    return new Date();
  }

  /** (Re)start the background poll with the current interval setting. */
  restartPolling(): void {
    if (this.pollIntervalId !== undefined) window.clearInterval(this.pollIntervalId);
    this.pollIntervalId = window.setInterval(
      () => this.autoCreateUpcomingNotes(false),
      this.settings.pollIntervalMinutes * 60 * 1_000
    );
    this.registerInterval(this.pollIntervalId);
  }

  /** Show the meeting in progress or coming up next in the status bar. */
  updateStatusBar(): void {
    if (!this.statusBarEl) return;
    const meeting = this.settings.showStatusBar
      ? currentOrNextMeeting(this.liveEvents, this.now())
      : undefined;
    if (!meeting) {
      this.statusBarEl.setText("");
      this.statusBarEl.hide();
      return;
    }
    this.statusBarEl.setText(statusText(meeting, this.now()));
    this.statusBarEl.show();
  }

  /**
   * Open the note for the meeting in progress (or starting within 30 minutes),
   * creating it if needed, and open its join link.
   */
  async joinMeeting(): Promise<void> {
    if (!this.isConfigured()) {
      new Notice("Calendar Notes: Please configure your calendar in the plugin settings.");
      return;
    }
    const fetched = await this.fetchAndFilterEvents(true);
    if (!fetched) return;

    const meeting = meetingToJoin(fetched.live, this.now(), JOIN_WINDOW_MS);
    if (!meeting) {
      new Notice("Calendar Notes: No meeting in progress or starting in the next 30 minutes.");
      return;
    }

    await this.createAndOpenNote(meeting.event);
    const url = joinUrl(meeting.event);
    if (url) {
      window.open(url);
    } else {
      new Notice(`Calendar Notes: "${meeting.event.summary ?? "This meeting"}" has no join link.`);
    }
  }

  /** Open the meetings dashboard (a Bases file), creating it on first use. */
  async openDashboard(): Promise<void> {
    const folder = this.settings.noteFolder.trim() ? normalizePath(this.settings.noteFolder.trim()) : "";
    const path = normalizePath(folder ? `${folder}/${DASHBOARD_FILENAME}` : DASHBOARD_FILENAME);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
      file = await this.app.vault.create(path, DASHBOARD_CONTENT);
    }
    await this.app.workspace.getLeaf(false).openFile(file as TFile);
  }

  /** Show one of the plugin's sidebar views, opening it in the right sidebar if needed. */
  async openSidebarView(type: string): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(type)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** Today's meetings (midnight to midnight), filtered like the sync; null if the calendar can't be read. */
  async loadTodayEvents(): Promise<CalendarEvent[] | null> {
    if (!this.isConfigured()) return null;
    const now = this.now();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    try {
      const svc = await this.getCalendarService();
      const raw = await svc.listEventsInTimeWindow(dayStart, dayEnd);
      return this.markSelfAttendee(this.filterDeclinedEvents(this.filterOutAllDay(raw)));
    } catch (err) {
      console.warn("[CalendarNoteIntegration] Couldn't read today's meetings:", err);
      return null;
    }
  }

  /** Open the event's note, creating it first if it has none. */
  async openNoteForEvent(event: CalendarEvent): Promise<void> {
    const existing = findNotesByEventId(this.app, this.settings.noteFolder).get(event.id);
    if (existing) {
      await this.app.workspace.getLeaf(false).openFile(existing);
      return;
    }
    await this.createAndOpenNote(event);
  }

  /**
   * First sweep after Obsidian starts. After the plugin is installed or
   * upgraded it runs a rebuild, so notes in the window pick up the new
   * version's format and fixes; otherwise it is a normal refresh.
   */
  async runStartupSweep(): Promise<void> {
    const version = this.manifest.version;
    if (this.settings.lastRunVersion === version) {
      await this.refreshNotes(false);
      return;
    }
    if (await this.rebuildNotes(false)) {
      this.settings.lastRunVersion = version;
      await this.saveSettings();
    }
  }

  onunload(): void {
    if (this.startupTimeoutId !== undefined) {
      window.clearTimeout(this.startupTimeoutId);
    }
    if (this.pollIntervalId !== undefined) {
      window.clearInterval(this.pollIntervalId);
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
    if (typeof merged.linkAttendees !== "boolean") {
      merged.linkAttendees = DEFAULT_SETTINGS.linkAttendees;
    }
    if (typeof merged.showStatusBar !== "boolean") {
      merged.showStatusBar = DEFAULT_SETTINGS.showStatusBar;
    }
    if (typeof merged.dailyNoteLink !== "boolean") {
      merged.dailyNoteLink = DEFAULT_SETTINGS.dailyNoteLink;
    }
    if (typeof merged.templatePath !== "string") {
      merged.templatePath = DEFAULT_SETTINGS.templatePath;
    }
    if (typeof merged.lastRunVersion !== "string") {
      merged.lastRunVersion = DEFAULT_SETTINGS.lastRunVersion;
    }

    // Sanitize enum field
    if (!["before", "after"].includes(merged.datePosition)) {
      merged.datePosition = DEFAULT_SETTINGS.datePosition;
    }

    // Sanitize processedEventIds
    if (!Array.isArray(merged.processedEventIds)) {
      merged.processedEventIds = [];
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
        "Not authenticated. Please sign in via Settings → Calendar Note Integration - Apple-iCal-Google."
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
      // At least yesterday, so meetings still in progress are included.
      const daysBack  = this.settings.includePastEvents ? this.settings.daysBack : 1;
      // Cover both the event picker's range and the auto-create window.
      const daysAhead = Math.max(this.settings.daysAhead, Math.ceil(this.settings.hoursInAdvance / 24) + 1);
      return CalendarService.fromApple(calendarFilter, daysBack, daysAhead);
    }
    return CalendarService.fromIcal(decrypt(this.settings.icalUrl));
  }

  // ---------------------------------------------------------------------------
  // NoteOptions builder
  // ---------------------------------------------------------------------------

  private async getNoteOptions(verbose: boolean): Promise<NoteOptions> {
    return {
      noteFolder: this.settings.noteFolder,
      includeEventNotes: this.settings.includeEventNotes,
      linkAttendees: this.settings.linkAttendees,
      datePosition: this.settings.datePosition,
      dailyNote: this.settings.dailyNoteLink ? this.getDailyNoteConfig() : undefined,
      template: await this.loadTemplate(verbose),
    };
  }

  /** Read the template note, or return undefined to use the built-in template. */
  private async loadTemplate(verbose: boolean): Promise<string | undefined> {
    const path = this.settings.templatePath.trim();
    if (!path) return undefined;
    const normalized = normalizePath(path.endsWith(".md") ? path : `${path}.md`);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) return this.app.vault.read(file);

    console.warn(`[CalendarNoteIntegration] Template "${normalized}" not found; using the built-in template.`);
    if (verbose) new Notice(`Calendar Notes: template "${normalized}" not found — using the built-in format.`);
    return undefined;
  }

  /** Daily-note format and folder from Obsidian's Daily Notes core plugin, if set. */
  getDailyNoteConfig(): DailyNoteConfig {
    type DailyNotesPlugin = { enabled?: boolean; instance?: { options?: { format?: string; folder?: string } } };
    const internal = (this.app as unknown as {
      internalPlugins?: { getPluginById?: (id: string) => DailyNotesPlugin | null };
    }).internalPlugins;
    const options = internal?.getPluginById?.("daily-notes")?.instance?.options;
    return {
      format: options?.format?.trim() || "YYYY-MM-DD",
      folder: options?.folder?.trim() ?? "",
    };
  }

  // ---------------------------------------------------------------------------
  // All-day event filter
  // ---------------------------------------------------------------------------

  /** Remove all-day events — they have only `start.date`, no `start.dateTime`. */
  private filterOutAllDay(events: CalendarEvent[]): CalendarEvent[] {
    return events.filter((e) => !!e.start.dateTime);
  }

  /**
   * Remove events the user has explicitly declined.
   * The user's attendee entry is the one the calendar flags as `self`, or the
   * one matching selfEmail. Events where the user is not listed are kept.
   */
  private filterDeclinedEvents(events: CalendarEvent[]): CalendarEvent[] {
    const selfEmail = this.settings.selfEmail.trim().toLowerCase();
    return events.filter((event) => {
      if (!event.attendees || event.attendees.length === 0) return true;
      const self = event.attendees.find(
        (a) => a.self === true || (!!selfEmail && a.email.toLowerCase() === selfEmail)
      );
      return !self || self.responseStatus !== "declined";
    });
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

  /** Maximum number of processed event IDs to retain. */
  private static readonly MAX_PROCESSED_IDS = 5_000;
  /** Trim target when the cap is exceeded. */
  private static readonly TRIM_PROCESSED_IDS = 4_000;

  /**
   * Fetch and filter events for the configured time window, and refresh the
   * status bar. Returns null if not configured or if the fetch fails. A
   * failed background fetch shows one notice until a fetch succeeds again.
   */
  private async fetchAndFilterEvents(verbose: boolean): Promise<FetchResult | null> {
    if (!this.isConfigured()) return null;

    const now = this.now();
    const timeMin = this.settings.includePastEvents
      ? new Date(now.getTime() - this.settings.daysBack * 24 * 60 * 60 * 1_000)
      : now;
    const timeMax = new Date(
      now.getTime() + this.settings.hoursInAdvance * 60 * 60 * 1_000
    );
    const fetchMin = new Date(Math.min(timeMin.getTime(), now.getTime() - IN_PROGRESS_LOOKBACK_MS));

    let raw: CalendarEvent[];
    let queriedCalendars: string[] | undefined;
    let fetchedIds: Set<string> | undefined;
    try {
      const svc = await this.getCalendarService();
      raw = await svc.listEventsInTimeWindow(fetchMin, timeMax);
      queriedCalendars = svc.queriedCalendars();
      fetchedIds = svc.fetchedEventIds();
    } catch (err) {
      if (verbose) {
        new Notice(`Calendar Notes: ${safeErrorMessage(err)}`);
      } else if (!this.lastFetchFailed) {
        new Notice(`Calendar Notes: couldn't read your calendar — ${safeErrorMessage(err)}`, 10_000);
      }
      this.lastFetchFailed = true;
      return null;
    }
    this.lastFetchFailed = false;

    let filtered = this.filterOutAllDay(raw);
    filtered = this.filterDeclinedEvents(filtered);
    filtered = this.markSelfAttendee(filtered);

    const live = filtered.filter((e) => !e.cancelled);
    this.liveEvents = live;
    this.updateStatusBar();

    return {
      events: filtered.filter((e) => new Date(e.start.dateTime ?? "") >= timeMin),
      live,
      seenIds: fetchedIds ?? new Set(raw.map((e) => e.id)),
      queriedCalendars,
      timeMin,
      timeMax,
    };
  }

  /**
   * Mark notes whose meeting has disappeared from the calendar. Only notes
   * that start inside the window just fetched and belong to a calendar that
   * was read are considered, so a deselected or renamed calendar never marks
   * its notes removed.
   */
  private async markRemovedMeetings(fetched: FetchResult, notesById: Map<string, TFile>): Promise<number> {
    if (!fetched.queriedCalendars) return 0;
    const calendars = new Set(fetched.queriedCalendars);
    let removed = 0;
    for (const [id, file] of notesById) {
      if (fetched.seenIds.has(id)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || fm.status === "removed" || fm.status === "cancelled") continue;
      if (typeof fm.calendar !== "string" || !calendars.has(fm.calendar)) continue;
      const start = frontmatterDate(fm.start);
      if (!start || start < fetched.timeMin || start > fetched.timeMax) continue;
      try {
        if (await markNoteRemoved(this.app, file)) removed++;
      } catch (err) {
        console.warn("[CalendarNoteIntegration] Failed to mark note removed:", err);
      }
    }
    return removed;
  }

  /** Trim processedEventIds if it exceeds the cap, then persist. */
  private async trimAndSaveProcessedIds(): Promise<void> {
    if (this.settings.processedEventIds.length > GoogleCalendarPlugin.MAX_PROCESSED_IDS) {
      this.settings.processedEventIds =
        this.settings.processedEventIds.slice(-GoogleCalendarPlugin.TRIM_PROCESSED_IDS);
    }
    await this.saveSettings();
  }

  /**
   * Bring notes in line with the calendar for every event in the window.
   *
   *  - A note whose `calendar_event_id` matches the event has its calendar
   *    details (managed properties and the "Meeting details" callout) updated,
   *    and is renamed if the meeting moved to another day.
   *  - Otherwise a note is created, unless the event was already processed
   *    (its note was deliberately deleted) and `recreateDeleted` is false, or
   *    the event is cancelled.
   *  - A note file already at the event's path (created before IDs were stored
   *    in notes) is adopted without being modified.
   *
   * Returns false if the calendar could not be read.
   */
  private async syncNotes(verbose: boolean, recreateDeleted: boolean): Promise<boolean> {
    const fetched = await this.fetchAndFilterEvents(verbose);
    if (!fetched) return false;
    const events = fetched.events;

    const processedSet = new Set(this.settings.processedEventIds);
    const markProcessed = (id: string) => {
      if (processedSet.has(id)) return;
      processedSet.add(id);
      this.settings.processedEventIds.push(id);
    };
    const options = await this.getNoteOptions(verbose);
    const notesById = findNotesByEventId(this.app, options.noteFolder);
    let created = 0;
    let updated = 0;

    for (const event of events) {
      try {
        const existing = notesById.get(event.id);
        if (existing) {
          const series = await seriesOptions(this.app, notesById, event, false);
          if (await syncNoteFile(this.app, existing, event, { ...options, ...series })) updated++;
          markProcessed(event.id);
          continue;
        }
        if (event.cancelled) continue;
        if (processedSet.has(event.id) && !recreateDeleted) continue;
        if (this.app.vault.getAbstractFileByPath(resolveNoteFilePath(event, options)) instanceof TFile) {
          markProcessed(event.id);
          continue;
        }
        const series = await seriesOptions(this.app, notesById, event, true);
        const result = await createNoteFile(this.app, event, { ...options, ...series });
        notesById.set(event.id, result.file);
        if (result.wasCreated) created++;
        markProcessed(event.id);
      } catch (err) {
        console.warn("[CalendarNoteIntegration] Failed to sync note for event:", err);
      }
    }

    const removed = await this.markRemovedMeetings(fetched, notesById);

    await this.trimAndSaveProcessedIds();

    const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? "s" : ""}`;
    const parts = [
      ...(created > 0 ? [`created ${plural(created, "note")}`] : []),
      ...(updated > 0 ? [`updated ${plural(updated, "note")}`] : []),
      ...(removed > 0 ? [`marked ${plural(removed, "note")} removed from calendar`] : []),
    ];
    if (parts.length > 0) {
      const message = parts.join(", ");
      new Notice(`Calendar Notes: ${message.charAt(0).toUpperCase()}${message.slice(1)}.`, verbose ? undefined : 4_000);
    } else if (verbose) {
      new Notice("Calendar Notes: All notes are up to date.");
    }
    return true;
  }

  /**
   * Refresh: create notes for new events and update existing notes. Notes the
   * user deleted are not recreated. Used by the poller and the Refresh button.
   */
  async refreshNotes(verbose: boolean): Promise<boolean> {
    return this.syncNotes(verbose, false);
  }

  /**
   * Rebuild: like refresh, but also recreates notes that were deleted.
   * Used by the Rebuild button and after an upgrade.
   */
  async rebuildNotes(verbose: boolean): Promise<boolean> {
    return this.syncNotes(verbose, true);
  }

  /** Delegates to refreshNotes — background poller and startup sweep entry point. */
  async autoCreateUpcomingNotes(verbose: boolean): Promise<void> {
    await this.refreshNotes(verbose);
  }

  // ---------------------------------------------------------------------------
  // Interactive commands
  // ---------------------------------------------------------------------------

  async pickEventAndCreateNote(): Promise<void> {
    if (!this.isConfigured()) {
      new Notice(
        "Calendar Notes: Please configure your connection in " +
          "Settings → Calendar Note Integration - Apple-iCal-Google."
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

      events = this.filterOutAllDay(events).filter((e) => !e.cancelled);
      events = this.filterDeclinedEvents(events);

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
      new Notice(`Calendar Notes: ${safeErrorMessage(err)}`);
    }
  }

  async createNoteForNextEvent(): Promise<void> {
    if (!this.isConfigured()) {
      new Notice(
        "Calendar Notes: Please configure your connection in " +
          "Settings → Calendar Note Integration - Apple-iCal-Google."
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

      events = this.filterOutAllDay(events).filter((e) => !e.cancelled);
      events = this.filterDeclinedEvents(events);

      if (events.length === 0) {
        new Notice("No upcoming events found.");
        return;
      }

      events = this.markSelfAttendee(events);
      await this.createAndOpenNote(events[0]);
    } catch (err) {
      loadingNotice.hide();
      new Notice(`Calendar Notes: ${safeErrorMessage(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Note creation helper
  // ---------------------------------------------------------------------------

  private async createAndOpenNote(event: CalendarEvent): Promise<void> {
    try {
      const options = await this.getNoteOptions(true);
      const series = await seriesOptions(this.app, findNotesByEventId(this.app, options.noteFolder), event, true);
      const { file } = await createNoteFile(this.app, event, { ...options, ...series });
      await this.app.workspace.getLeaf(false).openFile(file as TFile);
      new Notice(`Note ready: ${file.name}`);
    } catch (err) {
      new Notice(
        `Calendar Notes: Failed to create note — ${safeErrorMessage(err)}`
      );
    }
  }
}
