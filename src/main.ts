/**
 * @file main.ts
 * @description Entry point for Meeting Notes for Apple Calendar.
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

import { MarkdownView, normalizePath, Notice, Plugin, TFile } from "obsidian";
import {
  candidateRecordings,
  listRecordings,
  readTranscript,
  Recording,
  RecordingSuggestModal,
  TranscriptConfirmModal,
  type MeetingTime,
  type TranscriptProposal,
} from "./krisp";
import {
  applyReply,
  copyText,
  DECISIONS_SECTIONS,
  DEFAULT_INSTRUCTIONS,
  parseReply,
  TRANSCRIPT_SECTIONS,
  type ApplyResult,
  type MeetingInfo,
} from "./assistant";
import { appendToSection, continuityItems, sectionText } from "./sections";
import { isSkipped } from "./skipRules";
import { ActionItemsView, ACTION_ITEMS_VIEW, localDate, parseTaskMeta } from "./actionItems";
import { addDays, buildTracker, TRACKER_FILENAME, type TrackerMeeting } from "./tracker";
import { isoWeek, newReview, refreshReview, REVIEW_FOLDER, reviewBody, reviewFilename } from "./weeklyReview";
import { addMissingViews, DASHBOARD_CONTENT, DASHBOARD_FILENAME, DASHBOARD_VIEW_NAMES } from "./dashboard";
import { buildInsights, INSIGHTS_FILENAME } from "./insights";
import { accountBody, ACCOUNTS_FOLDER, newAccountNote, refreshAccount } from "./accounts";
import { newSeriesNote, refreshSeries, SERIES_FOLDER, seriesBody } from "./series";
import { canonicalEventId } from "./appleCalendarApi";
import { TodayView, TODAY_VIEW, type NoteAction } from "./todayView";
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
  builtInTemplate,
  createNoteFile,
  findDuplicateNotes,
  findNotesByEventId,
  findSeriesNotes,
  isSkippedStatus,
  safeFilename,
  seriesId,
  setSeriesLink,
  joinUrl,
  doneTasks,
  markNoteRemoved,
  openTasks,
  resolveNoteFilePath,
  seriesOptions,
  setFrontmatterValue,
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
  /** Filtered events from the whole date range that start outside the window (e.g. a meeting moved to later in the week). */
  outsideWindow: CalendarEvent[];
  /** Meetings you declined, from the whole date range. */
  declined: CalendarEvent[];
  /** Calendars the fetch covered; undefined when the source can't tell. */
  queriedCalendars?: string[];
  timeMin: Date;
  timeMax: Date;
}

/** How far back to look for meetings that are still in progress. */
const IN_PROGRESS_LOOKBACK_MS = 12 * 60 * 60 * 1_000;
/** "Join meeting" acts on a meeting starting within this long. */
const JOIN_WINDOW_MS = 30 * 60 * 1_000;
/** A duplicate-notes warning from a background sync closes after this long; one from Refresh stays until clicked. */
const DUPLICATE_NOTICE_MS = 20_000;
/** Automatic Krisp import looks at meetings that ended within this long. */
const KRISP_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1_000;

function frontmatterDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

/** A frontmatter value as a list of non-empty strings (a single string counts as one). */
function frontmatterList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim());
}

/** A person's name from an attendee property: `[[Name]]`, `Name <email>` or a bare email. */
function personName(value: string): { name: string; email?: string } {
  const email = value.match(/<([^>]+)>/)?.[1]?.trim();
  const name = value.replace(/<[^>]*>/, "").replace(/^\[\[|\]\]$/g, "").replace(/\|.*$/, "").trim();
  return { name: name || email || value, email: email ?? (/^\S+@\S+$/.test(name) ? name : undefined) };
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
  /** Duplicate-note cases already pointed out this session (sorted paths joined by |). */
  private warnedDuplicates = new Set<string>();
  /** Notes whose transcript offer was declined; not offered again until Obsidian restarts. */
  private readonly dismissedTranscripts = new Set<string>();
  private transcriptOfferOpen = false;
  /** Header icons added to meeting notes' views, so they can be removed again. */
  private readonly noteActions = new Map<MarkdownView, HTMLElement[]>();

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
    this.addRibbonIcon("gauge", "Open meeting tracker", () => this.openTracker());
    this.addRibbonIcon("calendar-check", "Open this week's review", () => this.openWeeklyReview(0));
    this.addRibbonIcon("trending-up", "Open meeting insights", () => this.openInsights());

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
      id: "open-series-note",
      name: "Open series note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!this.isRecurringMeetingNote(file)) return false;
        if (!checking) void this.openSeriesNoteForFile(file as TFile);
        return true;
      },
    });

    this.addCommand({
      id: "open-meetings-dashboard",
      name: "Open meetings dashboard",
      callback: () => this.openDashboard(),
    });

    this.registerView(ACTION_ITEMS_VIEW, (leaf) => new ActionItemsView(leaf));
    this.registerView(TODAY_VIEW, (leaf) => new TodayView(leaf, {
      loadDay: (day) => this.loadDayEvents(day),
      notedEventIds: () => new Set(findNotesByEventId(this.app).keys()),
      openNote: (event) => this.openNoteForEvent(event),
      noteAction: (event, action) => this.meetingNoteAction(event, action),
      openSeries: (event) => this.openSeriesNote(event.id, event.summary?.trim() || "Untitled Event"),
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

    this.addCommand({
      id: "open-meeting-tracker",
      name: "Open meeting tracker",
      callback: () => this.openTracker(),
    });

    this.addCommand({
      id: "open-meeting-insights",
      name: "Open meeting insights",
      callback: () => this.openInsights(),
    });

    this.addCommand({
      id: "open-account-overview",
      name: "Open account overview",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const account = file ? this.app.metadataCache.getFileCache(file)?.frontmatter?.account : undefined;
        if (typeof account !== "string" || !account.trim()) return false;
        if (!checking) void this.openAccountOverview(account.trim());
        return true;
      },
    });

    this.addCommand({
      id: "open-weekly-review",
      name: "Open this week's review",
      callback: () => this.openWeeklyReview(0),
    });

    this.addCommand({
      id: "open-last-weekly-review",
      name: "Open last week's review",
      callback: () => this.openWeeklyReview(-1),
    });

    this.addCommand({
      id: "import-krisp-transcript",
      name: "Import Krisp transcript into this note",
      callback: () => this.withActiveNote((file) => this.importKrispTranscript(file)),
    });

    this.addCommand({
      id: "copy-gemini-prompt",
      name: "Copy meeting for AI assistant",
      callback: () => this.withActiveNote((file) => this.copyForAssistant(file)),
    });

    this.addCommand({
      id: "add-gemini-reply",
      name: "Add AI reply to this meeting",
      callback: () => this.withActiveNote((file) => this.addAssistantReply(file)),
    });

    const refreshActions = () => this.updateNoteActions();
    this.registerEvent(this.app.workspace.on("file-open", refreshActions));
    this.registerEvent(this.app.workspace.on("layout-change", refreshActions));
    this.registerEvent(this.app.metadataCache.on("changed", refreshActions));
    this.app.workspace.onLayoutReady(refreshActions);
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openTodayOnStartup) void this.showTodayInBackground();
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

  /** Every meeting note's open items, decisions and AI metadata, for the tracker, insights and overviews. */
  async trackerMeetings(): Promise<TrackerMeeting[]> {
    const meetings: TrackerMeeting[] = [];
    const selfEmail = this.settings.selfEmail.trim().toLowerCase();
    for (const [id, file] of findNotesByEventId(this.app)) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const content = await this.app.vault.cachedRead(file);
      const start = frontmatterDate(fm.start) ?? frontmatterDate(fm.date);
      const end = frontmatterDate(fm.end);
      const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
      const attendees = frontmatterList(fm.attendees).map(personName);
      const self = new Set(attendees.filter((a) => selfEmail && a.email?.toLowerCase() === selfEmail).map((a) => a.name.toLowerCase()));
      const people = [...new Map(
        [...attendees.map((a) => a.name), ...frontmatterList(fm.speakers)]
          .filter((n) => !self.has(n.toLowerCase()) && !n.includes("@"))
          .map((n) => [n.toLowerCase(), n])
      ).values()];
      meetings.push({
        path: file.path.replace(/\.md$/, ""),
        title: text(fm.title) ?? file.basename,
        date: start ? localDate(start) : "",
        account: text(fm.account),
        category: text(fm.meeting_category),
        openItems: openTasks(content).map((t) => parseTaskMeta(t.text)),
        doneItems: doneTasks(content).map((t) => parseTaskMeta(t.text)),
        decisions: sectionText(content, DECISIONS_SECTIONS)
          .split("\n")
          .map((l) => l.replace(/^\s*[-*+]\s+/, "").trim())
          .filter(Boolean),
        skipped: isSkippedStatus(fm.status),
        status: text(fm.status),
        id,
        minutes: start && end && end > start ? Math.round((end.getTime() - start.getTime()) / 60_000) : undefined,
        sentiment: text(fm.sentiment),
        outcome: text(fm.outcome),
        keyTopics: frontmatterList(fm.key_topics),
        organizations: frontmatterList(fm.organizations),
        people,
        summarized: fm.ai_summarized !== undefined && fm.ai_summarized !== null && fm.ai_summarized !== "",
        continuity: continuityItems(content),
      });
    }
    return meetings;
  }

  /** The note folder, normalized; "" = vault root. */
  private noteFolderPath(): string {
    return this.settings.noteFolder.trim() ? normalizePath(this.settings.noteFolder.trim()) : "";
  }

  /** Folder for the tracker, dashboard and weekly reviews; an empty setting means the note folder. */
  private hubFolderPath(): string {
    return this.settings.hubFolder.trim() ? normalizePath(this.settings.hubFolder.trim()) : this.noteFolderPath();
  }

  /**
   * Move the tracker, dashboard, weekly reviews and series notes from the note folder into
   * the Meeting Hub folder, keeping links to them. A file already at its
   * destination is left where it is.
   */
  async moveHubFiles(): Promise<void> {
    const from = this.noteFolderPath();
    const to = this.hubFolderPath();
    if (from === to) {
      new Notice("Calendar Notes: The Meeting Hub folder is the note folder — set a different folder first.");
      return;
    }
    const inFolder = (folder: string, name: string) => normalizePath(folder ? `${folder}/${name}` : name);
    const subfolders = [REVIEW_FOLDER, SERIES_FOLDER, ACCOUNTS_FOLDER].map((name) => `${inFolder(from, name)}/`);
    const sources = this.app.vault.getAllLoadedFiles().filter(
      (f): f is TFile =>
        f instanceof TFile &&
        (f.path === inFolder(from, TRACKER_FILENAME) ||
          f.path === inFolder(from, DASHBOARD_FILENAME) ||
          f.path === inFolder(from, INSIGHTS_FILENAME) ||
          subfolders.some((folder) => f.path.startsWith(folder)))
    );

    let moved = 0;
    const skipped: string[] = [];
    for (const file of sources) {
      const dest = inFolder(to, from ? file.path.slice(from.length + 1) : file.path);
      if (this.app.vault.getAbstractFileByPath(dest)) {
        skipped.push(file.name);
        continue;
      }
      await this.ensureFolder(dest.slice(0, dest.lastIndexOf("/")));
      await this.app.fileManager.renameFile(file, dest);
      moved++;
    }

    const parts = [
      moved > 0 ? `Moved ${moved} file${moved !== 1 ? "s" : ""} to ${to || "the vault root"}.` : "Nothing to move.",
      ...(skipped.length > 0 ? [`Left ${skipped.join(", ")} in place — already in the Meeting Hub folder.`] : []),
    ];
    new Notice(`Calendar Notes: ${parts.join(" ")}`);
  }

  /** Create a folder and any missing folders above it. */
  private async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const part of path.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  /**
   * Open the weekly review for this week (`weeksAgo` 0) or an earlier one,
   * creating it — and its folder — if needed. An existing review has only
   * the plugin's part refreshed; the user's own writing is kept.
   */
  async openWeeklyReview(weeksAgo: number): Promise<void> {
    const now = this.now();
    const today = localDate(now);
    const week = isoWeek(addDays(today, weeksAgo * 7));
    const body = reviewBody(
      await this.trackerMeetings(),
      week,
      today,
      `${today} ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    );
    const base = this.hubFolderPath();
    const folder = normalizePath(base ? `${base}/${REVIEW_FOLDER}` : REVIEW_FOLDER);
    const path = normalizePath(`${folder}/${reviewFilename(week)}`);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.process(file, (content) => refreshReview(content, body));
    } else {
      await this.ensureFolder(folder);
      file = await this.app.vault.create(path, newReview(body, week));
    }
    await this.app.workspace.getLeaf(false).openFile(file as TFile);
  }

  /** Rebuild the Meeting Tracker note in the Meeting Hub folder and open it. */
  async openTracker(): Promise<void> {
    const now = this.now();
    const content = buildTracker(
      await this.trackerMeetings(),
      localDate(now),
      `${localDate(now)} ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    );
    const folder = this.hubFolderPath();
    const path = normalizePath(folder ? `${folder}/${TRACKER_FILENAME}` : TRACKER_FILENAME);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.process(file, () => content);
    } else {
      if (folder) await this.ensureFolder(folder);
      file = await this.app.vault.create(path, content);
    }
    await this.app.workspace.getLeaf(false).openFile(file as TFile);
  }

  /**
   * Open the series note of a recurring meeting, creating it in the Meeting
   * Hub's Series folder if needed. Its plugin part is rebuilt from the
   * occurrences' notes, and each occurrence note is linked back to it.
   */
  async openSeriesNote(eventId: string, title: string): Promise<void> {
    const id = seriesId(canonicalEventId(eventId));
    if (!id) {
      new Notice("Calendar Notes: This isn't a recurring meeting, so it has no series note.");
      return;
    }
    const now = this.now();
    const occurrences = (await this.trackerMeetings()).filter((m) => m.id && seriesId(m.id) === id);
    const body = seriesBody(occurrences, `${localDate(now)} ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`, localDate(now));

    let file: TFile | undefined = findSeriesNotes(this.app).get(id);
    if (file) {
      await this.app.vault.process(file, (content) => refreshSeries(content, body));
    } else {
      const base = this.hubFolderPath();
      const folder = normalizePath(base ? `${base}/${SERIES_FOLDER}` : SERIES_FOLDER);
      await this.ensureFolder(folder);
      const name = safeFilename(title);
      let path = normalizePath(`${folder}/${name}.md`);
      for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${name} (${n}).md`);
      file = await this.app.vault.create(path, newSeriesNote(title, id, body));
    }

    const notesById = findNotesByEventId(this.app);
    const seriesPath = file.path.replace(/\.md$/, "");
    for (const m of occurrences) {
      const note = m.id ? notesById.get(m.id) : undefined;
      if (!note) continue;
      const content = await this.app.vault.read(note);
      if (setSeriesLink(content, seriesPath) !== content) {
        await this.app.vault.process(note, (c) => setSeriesLink(c, seriesPath));
      }
    }
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  /** Open the series note of the recurring meeting whose note is `file`. */
  async openSeriesNoteForFile(file: TFile): Promise<void> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const id = typeof fm?.calendar_event_id === "string" ? fm.calendar_event_id : "";
    await this.openSeriesNote(id, typeof fm?.title === "string" && fm.title.trim() ? fm.title.trim() : file.basename);
  }

  /** "YYYY-MM-DD h:mm AM", for a generated note's Updated line. */
  private updatedStamp(): string {
    const now = this.now();
    return `${localDate(now)} ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }

  /** Account overview notes in the vault, by account name (lower case). */
  private findAccountNotes(): Map<string, TFile> {
    const byName = new Map<string, TFile>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.type !== "meeting-account" || typeof fm.account !== "string" || !fm.account.trim()) continue;
      const key = fm.account.trim().toLowerCase();
      if (!byName.has(key)) byName.set(key, file);
    }
    return byName;
  }

  /**
   * Rebuild the plugin's part of the overview note of each account in
   * `accounts` (creating missing ones in the Meeting Hub's Accounts folder),
   * and return each account's note path without `.md`, by lower-case name.
   */
  private async updateAccountNotes(meetings: TrackerMeeting[], accounts: string[]): Promise<Map<string, string>> {
    const today = localDate(this.now());
    const updated = this.updatedStamp();
    const existing = this.findAccountNotes();
    const paths = new Map<string, string>();
    for (const account of accounts) {
      const key = account.toLowerCase();
      const body = accountBody(meetings.filter((m) => m.account?.trim().toLowerCase() === key), today, updated);
      let file = existing.get(key);
      if (file) {
        await this.app.vault.process(file, (content) => refreshAccount(content, body));
      } else {
        const base = this.hubFolderPath();
        const folder = normalizePath(base ? `${base}/${ACCOUNTS_FOLDER}` : ACCOUNTS_FOLDER);
        await this.ensureFolder(folder);
        const name = safeFilename(account);
        let path = normalizePath(`${folder}/${name}.md`);
        for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${name} (${n}).md`);
        file = await this.app.vault.create(path, newAccountNote(account, body));
        existing.set(key, file);
      }
      paths.set(key, file.path.replace(/\.md$/, ""));
    }
    return paths;
  }

  /** Open an account's overview note, rebuilding it first. */
  async openAccountOverview(account: string): Promise<void> {
    const paths = await this.updateAccountNotes(await this.trackerMeetings(), [account]);
    const file = this.app.vault.getAbstractFileByPath(`${paths.get(account.toLowerCase())}.md`);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
  }

  /**
   * Rebuild the Meeting Insights note in the Meeting Hub folder, and the
   * overview note of every account it lists, then open it.
   */
  async openInsights(): Promise<void> {
    const meetings = await this.trackerMeetings();
    const accounts = [...new Map(
      meetings.filter((m) => m.account?.trim()).sort((a, b) => b.date.localeCompare(a.date))
        .map((m) => [m.account!.trim().toLowerCase(), m.account!.trim()])
    ).values()];
    const paths = await this.updateAccountNotes(meetings, accounts);
    const content = buildInsights(meetings, localDate(this.now()), this.updatedStamp(), (account) => {
      const path = paths.get(account.toLowerCase());
      return path ? `[[${path}|${account.replace(/[[\]|#^]/g, " ").trim()}]]` : account;
    });
    const folder = this.hubFolderPath();
    const path = normalizePath(folder ? `${folder}/${INSIGHTS_FILENAME}` : INSIGHTS_FILENAME);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.process(file, () => content);
    } else {
      if (folder) await this.ensureFolder(folder);
      file = await this.app.vault.create(path, content);
    }
    await this.app.workspace.getLeaf(false).openFile(file as TFile);
  }

  /**
   * Open the meetings dashboard (a Bases file), creating it on first use.
   * Built-in views added since the user's copy was made are added to it,
   * each only once.
   */
  async openDashboard(): Promise<void> {
    const folder = this.hubFolderPath();
    const path = normalizePath(folder ? `${folder}/${DASHBOARD_FILENAME}` : DASHBOARD_FILENAME);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const offered = this.settings.dashboardViewsAdded;
      await this.app.vault.process(file, (content) => addMissingViews(content, offered));
    } else {
      if (folder) await this.ensureFolder(folder);
      file = await this.app.vault.create(path, DASHBOARD_CONTENT);
    }
    if (DASHBOARD_VIEW_NAMES.some((name) => !this.settings.dashboardViewsAdded.includes(name))) {
      this.settings.dashboardViewsAdded = [...DASHBOARD_VIEW_NAMES];
      await this.saveSettings();
    }
    await this.app.workspace.getLeaf(false).openFile(file as TFile);
  }

  /** Show one of the plugin's sidebar views, opening it in the right sidebar if needed. */
  /** Open Today's meetings in the right sidebar without taking focus, unless it is already open. */
  async showTodayInBackground(): Promise<void> {
    if (this.app.workspace.getLeavesOfType(TODAY_VIEW).length > 0) return;
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) await leaf.setViewState({ type: TODAY_VIEW, active: false });
  }

  async openSidebarView(type: string): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(type)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** The meetings on the day starting at `dayStart` (midnight to midnight), filtered like the sync; null if the calendar can't be read. */
  async loadDayEvents(dayStart: Date): Promise<CalendarEvent[] | null> {
    if (!this.isConfigured()) return null;
    const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
    try {
      const svc = await this.getCalendarService();
      const raw = await svc.listEventsInTimeWindow(dayStart, dayEnd);
      return this.markSelfAttendee(this.filterDeclinedEvents(this.filterOutAllDay(raw)));
    } catch (err) {
      console.warn("[CalendarNoteIntegration] Couldn't read the day's meetings:", err);
      return null;
    }
  }

  /** A follow-up step from the Today panel, run on the meeting's note. */
  async meetingNoteAction(event: CalendarEvent, action: NoteAction): Promise<void> {
    const file = findNotesByEventId(this.app).get(event.id);
    if (!file) {
      new Notice("Calendar Notes: This meeting has no note yet — click Create note first.");
      return;
    }
    if (action === "transcript") await this.importKrispTranscript(file);
    else if (action === "copy") await this.copyForAssistant(file);
    else await this.addAssistantReply(file);
  }

  /** Open the event's note, creating it first if it has none. */
  async openNoteForEvent(event: CalendarEvent): Promise<void> {
    const existing = findNotesByEventId(this.app).get(event.id);
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

  /**
   * Show one-click icons in the header of every open meeting note (a note
   * with a calendar_event_id): import the Krisp transcript, copy the meeting
   * for an AI assistant, and add the assistant's reply. Other notes get none.
   */
  updateNoteActions(): void {
    const views = new Set<MarkdownView>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView) views.add(leaf.view);
    }
    for (const [view, icons] of this.noteActions) {
      if (views.has(view) && this.isMeetingNote(view.file)) continue;
      icons.forEach((icon) => icon.remove());
      this.noteActions.delete(view);
    }
    for (const view of views) {
      if (this.noteActions.has(view) || !this.isMeetingNote(view.file)) continue;
      const run = (action: (file: TFile) => Promise<void>) => () => {
        if (view.file) void action.call(this, view.file);
      };
      // addAction puts each new icon to the left of the previous one.
      this.noteActions.set(view, [
        view.addAction("clipboard-paste", "Add AI reply to this meeting", run(this.addAssistantReply)),
        view.addAction("clipboard-copy", "Copy meeting for AI assistant", run(this.copyForAssistant)),
        view.addAction("file-audio", "Import Krisp transcript into this note", run(this.importKrispTranscript)),
        ...(this.isRecurringMeetingNote(view.file)
          ? [view.addAction("repeat", "Open series note", run(this.openSeriesNoteForFile))]
          : []),
      ]);
    }
  }

  private isRecurringMeetingNote(file: TFile | null): boolean {
    const id = file ? this.app.metadataCache.getFileCache(file)?.frontmatter?.calendar_event_id : undefined;
    return typeof id === "string" && seriesId(id) !== undefined;
  }

  private isMeetingNote(file: TFile | null): file is TFile {
    const id = file ? this.app.metadataCache.getFileCache(file)?.frontmatter?.calendar_event_id : undefined;
    return typeof id === "string" && id.length > 0;
  }

  onunload(): void {
    for (const icons of this.noteActions.values()) icons.forEach((icon) => icon.remove());
    this.noteActions.clear();
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
    merged.syncDaysAhead = clamp(
      Number(merged.syncDaysAhead) || DEFAULT_SETTINGS.syncDaysAhead, 1, 90
    );
    if (typeof merged.renameOnTitleChange !== "boolean") {
      merged.renameOnTitleChange = DEFAULT_SETTINGS.renameOnTitleChange;
    }
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
    if (typeof merged.openTodayOnStartup !== "boolean") {
      merged.openTodayOnStartup = DEFAULT_SETTINGS.openTodayOnStartup;
    }
    if (typeof merged.dailyNoteLink !== "boolean") {
      merged.dailyNoteLink = DEFAULT_SETTINGS.dailyNoteLink;
    }
    if (typeof merged.hubFolder !== "string") {
      merged.hubFolder = DEFAULT_SETTINGS.hubFolder;
    }
    if (typeof merged.templatePath !== "string") {
      merged.templatePath = DEFAULT_SETTINGS.templatePath;
    }
    if (typeof merged.lastRunVersion !== "string") {
      merged.lastRunVersion = DEFAULT_SETTINGS.lastRunVersion;
    }
    merged.dashboardViewsAdded = Array.isArray(merged.dashboardViewsAdded)
      ? merged.dashboardViewsAdded.filter((v): v is string => typeof v === "string")
      : [];

    const sections = (typeof stored.noteSections === "object" && stored.noteSections !== null
      ? stored.noteSections : {}) as Record<string, unknown>;
    merged.noteSections = { ...DEFAULT_SETTINGS.noteSections };
    for (const key of Object.keys(merged.noteSections) as Array<keyof typeof merged.noteSections>) {
      if (typeof sections[key] === "boolean") merged.noteSections[key] = sections[key] as boolean;
    }
    for (const key of ["skipTitles", "krispFolder", "aiInstructions"] as const) {
      if (typeof merged[key] !== "string") merged[key] = DEFAULT_SETTINGS[key];
    }
    for (const key of ["skipSolo", "krispAutoImport", "aiIncludeInstructions", "aiSaveProperties"] as const) {
      if (typeof merged[key] !== "boolean") merged[key] = DEFAULT_SETTINGS[key];
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
        "Not authenticated. Please sign in via Settings → Meeting Notes for Apple Calendar."
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
      // Cover the event picker's range, the auto-create window and the range existing notes are kept in sync for.
      const daysAhead = Math.max(
        this.settings.daysAhead,
        this.settings.syncDaysAhead,
        Math.ceil(this.settings.hoursInAdvance / 24) + 1
      );
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
      template: (await this.loadTemplate(verbose)) ?? builtInTemplate(this.settings.noteSections),
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
    return events.filter((event) => !this.isDeclined(event));
  }

  private isDeclined(event: CalendarEvent): boolean {
    const selfEmail = this.settings.selfEmail.trim().toLowerCase();
    const self = event.attendees?.find(
      (a) => a.self === true || (!!selfEmail && a.email.toLowerCase() === selfEmail)
    );
    return self?.responseStatus === "declined";
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
    let all: CalendarEvent[] | undefined;
    try {
      const svc = await this.getCalendarService();
      raw = await svc.listEventsInTimeWindow(fetchMin, timeMax);
      queriedCalendars = svc.queriedCalendars();
      all = svc.fetchedEvents();
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

    const filter = (events: CalendarEvent[]) =>
      this.markSelfAttendee(this.filterDeclinedEvents(this.filterOutAllDay(events)));
    const filtered = filter(raw);

    const live = filtered.filter((e) => !e.cancelled);
    this.liveEvents = live;
    this.updateStatusBar();

    const events = filtered.filter((e) => new Date(e.start.dateTime ?? "") >= timeMin);
    const inWindow = new Set(events.map((e) => e.id));
    return {
      events,
      live,
      seenIds: new Set((all ?? raw).map((e) => e.id)),
      outsideWindow: all ? filter(all).filter((e) => !inWindow.has(e.id)) : [],
      declined: this.markSelfAttendee(this.filterOutAllDay(all ?? raw)).filter((e) => this.isDeclined(e)),
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
   *    and is renamed if the meeting moved to another day. This also covers
   *    notes of meetings fetched outside the window, so a meeting moved to
   *    later in the week is renamed straight away, and notes of meetings you
   *    declined, which are marked declined.
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
    const notesById = findNotesByEventId(this.app);
    const seriesNotes = findSeriesNotes(this.app);
    const skipRules = { titles: this.settings.skipTitles, solo: this.settings.skipSolo };
    let created = 0;
    let updated = 0;
    const blocked: Array<[TFile, string]> = [];
    const syncExisting = async (file: TFile, event: CalendarEvent, declined: boolean) => {
      const series = await seriesOptions(this.app, notesById, event, false, seriesNotes);
      const result = await syncNoteFile(this.app, file, event, {
        ...options,
        ...series,
        declined,
        renameOnTitleChange: this.settings.renameOnTitleChange,
      });
      if (result.changed) updated++;
      if (result.blockedBy) blocked.push([file, result.blockedBy]);
    };

    for (const event of events) {
      try {
        const existing = notesById.get(event.id);
        if (existing) {
          await syncExisting(existing, event, false);
          markProcessed(event.id);
          continue;
        }
        if (event.cancelled || isSkipped(event, skipRules)) continue;
        if (processedSet.has(event.id) && !recreateDeleted) continue;
        if (this.app.vault.getAbstractFileByPath(resolveNoteFilePath(event, options)) instanceof TFile) {
          markProcessed(event.id);
          continue;
        }
        const series = await seriesOptions(this.app, notesById, event, true, seriesNotes);
        const result = await createNoteFile(this.app, event, { ...options, ...series });
        notesById.set(event.id, result.file);
        if (result.wasCreated) created++;
        markProcessed(event.id);
      } catch (err) {
        console.warn("[CalendarNoteIntegration] Failed to sync note for event:", err);
      }
    }

    const existingOnly = [
      ...fetched.outsideWindow.map((event) => ({ event, declined: false })),
      ...fetched.declined.map((event) => ({ event, declined: true })),
    ];
    for (const { event, declined } of existingOnly) {
      const existing = notesById.get(event.id);
      if (!existing) continue;
      try {
        await syncExisting(existing, event, declined);
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
    this.warnAboutDuplicates(blocked, verbose);
    await this.offerTranscripts();
    return true;
  }

  /**
   * Point out notes that are for the same meeting, and notes that couldn't be
   * renamed because another note has the new name, with links to each note,
   * in one notice. In the background each case is shown once per session and
   * the notice closes by itself; `verbose` (Refresh) shows all and keeps it open.
   */
  private warnAboutDuplicates(blocked: Array<[TFile, string]>, verbose: boolean): void {
    const fix = " Copy what you need into one and delete the other.";
    const cases: Array<{ key: string; parts: Array<string | TFile> }> = [];
    for (const files of findDuplicateNotes(this.app)) {
      const parts: Array<string | TFile> = [`Calendar Notes: ${files.length} notes are for the same meeting: `];
      files.forEach((file, i) => parts.push(...(i > 0 ? [", "] : []), file));
      parts.push(`.${fix.replace("the other", files.length > 2 ? "the others" : "the other")}`);
      cases.push({ key: files.map((f) => f.path).sort().join("|"), parts });
    }
    for (const [file, path] of blocked) {
      const other = this.app.vault.getAbstractFileByPath(path);
      if (!(other instanceof TFile) || cases.some((c) => c.parts.includes(file) && c.parts.includes(other))) continue;
      cases.push({
        key: [file.path, path].sort().join("|"),
        parts: [`Calendar Notes: `, file, ` should be renamed to match its meeting, but `, other, ` already has that name.${fix}`],
      });
    }
    const shown = cases.filter(({ key }) => verbose || !this.warnedDuplicates.has(key));
    if (shown.length === 0) return;
    for (const { key } of shown) this.warnedDuplicates.add(key);
    const text = shown.map(({ parts }) => parts.map((p) => (typeof p === "string" ? p : p.basename)).join("")).join("\n");
    const notice = new Notice(text, verbose ? 0 : DUPLICATE_NOTICE_MS);
    notice.messageEl.empty();
    shown.forEach(({ parts }, i) => {
      const line = notice.messageEl.createDiv();
      for (const part of i > 0 && typeof parts[0] === "string" ? [parts[0].replace(/^Calendar Notes: /, ""), ...parts.slice(1)] : parts) {
        if (typeof part === "string") {
          line.createSpan({ text: part });
        } else {
          line
            .createEl("a", { text: part.basename, href: "#" })
            .addEventListener("click", (e) => {
              e.preventDefault();
              void this.app.workspace.getLeaf(false).openFile(part);
            });
        }
      }
    });
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
          "Settings → Meeting Notes for Apple Calendar."
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
          "Settings → Meeting Notes for Apple Calendar."
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
      const series = await seriesOptions(this.app, findNotesByEventId(this.app), event, true);
      const { file } = await createNoteFile(this.app, event, { ...options, ...series });
      await this.app.workspace.getLeaf(false).openFile(file as TFile);
      new Notice(`Note ready: ${file.name}`);
    } catch (err) {
      new Notice(
        `Calendar Notes: Failed to create note — ${safeErrorMessage(err)}`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Krisp transcripts and the AI assistant round trip
  // ---------------------------------------------------------------------------

  private withActiveNote(run: (file: TFile) => Promise<void>): void {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("Calendar Notes: Open a meeting note first.");
      return;
    }
    void run(file);
  }

  /** Title and times of a meeting note, from its properties; undefined without a start. */
  private noteMeeting(file: TFile): MeetingTime | undefined {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const start = frontmatterDate(fm?.start);
    if (!start) return undefined;
    const end = frontmatterDate(fm?.end) ?? start;
    return { title: typeof fm?.title === "string" ? fm.title : file.basename, start, end };
  }

  /** Recording folders already imported into a note. */
  private usedRecordings(): Set<string> {
    const used = new Set<string>();
    for (const file of findNotesByEventId(this.app).values()) {
      const name = this.app.metadataCache.getFileCache(file)?.frontmatter?.krisp_recording;
      if (typeof name === "string") used.add(name);
    }
    return used;
  }

  /** Fill the note's Transcript section from the recording; false if the transcript was empty. */
  private async writeTranscript(file: TFile, recording: Recording): Promise<boolean> {
    const lines = await readTranscript(recording);
    if (lines.length === 0) return false;
    await this.app.vault.process(file, (content) =>
      setFrontmatterValue(appendToSection(content, TRANSCRIPT_SECTIONS, lines), "krisp_recording", recording.name)
    );
    return true;
  }

  /** Import the chosen recordings into their notes, skipping notes whose Transcript has text by now. */
  async importTranscripts(picks: Array<{ file: TFile; recording: Recording }>): Promise<number> {
    let imported = 0;
    for (const { file, recording } of picks) {
      try {
        if (sectionText(await this.app.vault.read(file), TRANSCRIPT_SECTIONS)) continue;
        if (await this.writeTranscript(file, recording)) imported++;
        else new Notice(`Calendar Notes: The recording "${recording.title}" has no transcript text yet.`);
      } catch (err) {
        new Notice(`Calendar Notes: Couldn't import the transcript — ${safeErrorMessage(err)}`);
      }
    }
    if (imported > 0) new Notice(`Calendar Notes: Imported ${imported} Krisp transcript${imported !== 1 ? "s" : ""}.`);
    return imported;
  }

  private async readRecordings(): Promise<Recording[] | undefined> {
    const folder = this.settings.krispFolder.trim();
    try {
      return await listRecordings(folder);
    } catch (err) {
      new Notice(`Calendar Notes: Couldn't read the Krisp folder — ${safeErrorMessage(err)}`);
      return undefined;
    }
  }

  async importKrispTranscript(file: TFile): Promise<void> {
    if (!this.settings.krispFolder.trim()) {
      new Notice("Calendar Notes: Set your Krisp folder in the plugin settings first.");
      return;
    }
    if (sectionText(await this.app.vault.read(file), TRANSCRIPT_SECTIONS)) {
      new Notice("Calendar Notes: This note's Transcript section already has text. Clear it to import again.");
      return;
    }
    const recordings = await this.readRecordings();
    if (!recordings) return;
    if (recordings.length === 0) {
      new Notice(`Calendar Notes: No Krisp recordings found in ${this.settings.krispFolder}.`);
      return;
    }

    const pickAny = () =>
      new RecordingSuggestModal(this.app, recordings, (recording) => void this.importTranscripts([{ file, recording }])).open();
    const meeting = this.noteMeeting(file);
    const used = this.usedRecordings();
    const candidates = meeting ? candidateRecordings(recordings.filter((r) => !used.has(r.name)), meeting) : [];
    if (!meeting || candidates.length === 0) {
      pickAny();
      return;
    }
    new TranscriptConfirmModal(
      this.app,
      [{ file, meeting, candidates }],
      (picks) => void this.importTranscripts(picks),
      () => undefined,
      pickAny
    ).open();
  }

  /**
   * Meetings that ended in the last 2 days with an empty Transcript and at
   * least one candidate recording, leaving out any dismissed this session.
   */
  async transcriptProposals(): Promise<TranscriptProposal<TFile>[]> {
    const now = this.now();
    const since = new Date(now.getTime() - KRISP_LOOKBACK_MS);
    const ended = [...findNotesByEventId(this.app).values()]
      .filter((file) => !this.dismissedTranscripts.has(file.path))
      .map((file) => ({ file, meeting: this.noteMeeting(file) }))
      .filter((n): n is { file: TFile; meeting: MeetingTime } =>
        !!n.meeting && n.meeting.end <= now && n.meeting.end >= since)
      .sort((a, b) => a.meeting.start.getTime() - b.meeting.start.getTime());
    if (ended.length === 0) return [];

    let recordings: Recording[];
    try {
      recordings = await listRecordings(this.settings.krispFolder, since);
    } catch (err) {
      console.warn("[CalendarNoteIntegration] Couldn't read the Krisp folder:", err);
      return [];
    }
    const used = this.usedRecordings();
    const free = recordings.filter((r) => !used.has(r.name));
    const proposals: TranscriptProposal<TFile>[] = [];
    for (const { file, meeting } of ended) {
      const candidates = candidateRecordings(free, meeting);
      if (candidates.length === 0) continue;
      if (sectionText(await this.app.vault.read(file), TRANSCRIPT_SECTIONS)) continue;
      proposals.push({ file, meeting, candidates });
    }
    return proposals;
  }

  /** With automatic import on, ask to import any transcripts found; never imports without confirmation. */
  async offerTranscripts(): Promise<void> {
    if (!this.settings.krispAutoImport || !this.settings.krispFolder.trim() || this.transcriptOfferOpen) return;
    const proposals = await this.transcriptProposals();
    if (proposals.length === 0) return;
    this.transcriptOfferOpen = true;
    new TranscriptConfirmModal(
      this.app,
      proposals,
      (picks) => {
        this.transcriptOfferOpen = false;
        void this.importTranscripts(picks);
      },
      (files) => {
        this.transcriptOfferOpen = false;
        for (const file of files) this.dismissedTranscripts.add(file.path);
      }
    ).open();
  }

  /** The meeting's calendar details for the copied block, from the note's properties. */
  private meetingInfo(file: TFile): MeetingInfo {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const meeting = this.noteMeeting(file);
    const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const day = meeting?.start ?? frontmatterDate(fm?.date);
    const date = typeof fm?.date === "string" ? fm.date : day
      ? `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
      : "";
    const listed: unknown = fm?.attendees;
    const attendees = (Array.isArray(listed) ? listed : [])
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.replace(/\[\[|\]\]/g, "").replace(/\s*<[^>]*>$/, "").trim());
    return {
      title: meeting?.title ?? file.basename,
      date,
      time: meeting ? `${time(meeting.start)} – ${time(meeting.end)}` : "",
      attendees,
    };
  }

  /** What Copy meeting for AI assistant puts on the clipboard; undefined if there is nothing to send. */
  async assistantCopyText(file: TFile): Promise<string | undefined> {
    const instructions = this.settings.aiIncludeInstructions
      ? this.settings.aiInstructions.trim() || DEFAULT_INSTRUCTIONS
      : undefined;
    return copyText(await this.app.vault.read(file), this.meetingInfo(file), instructions);
  }

  async copyForAssistant(file: TFile): Promise<void> {
    const text = await this.assistantCopyText(file);
    if (!text) {
      new Notice("Calendar Notes: Add notes or a transcript to this meeting first.");
      return;
    }
    await navigator.clipboard.writeText(text);
    new Notice(
      "Calendar Notes: Meeting copied. Paste it into your AI assistant, copy its whole reply, " +
        "then run Add AI reply to this meeting.",
      8_000
    );
  }

  /** File an AI assistant's reply into the note; false if the text isn't a reply the plugin understands. */
  async applyAssistantReply(file: TFile, text: string): Promise<boolean> {
    const reply = parseReply(text);
    if (!reply) {
      new Notice(
        "Calendar Notes: The clipboard doesn't hold an AI reply the plugin understands — it needs " +
          "a summary, decisions or next steps. Copy the assistant's whole reply and try again."
      );
      return false;
    }
    let result: ApplyResult | undefined;
    await this.app.vault.process(file, (content) => {
      result = applyReply(content, reply, this.settings.aiSaveProperties, localDate(this.now()));
      return result.content;
    });
    const plural = (n: number, word: string) => `${n} new ${word}${n !== 1 ? "s" : ""}`;
    new Notice(
      `Calendar Notes: ${reply.summary.length > 0 ? "Updated the summary; added" : "Added"} ` +
        `${plural(result?.decisions ?? 0, "decision")} and ${plural(result?.actionItems ?? 0, "next step")}.`
    );
    return true;
  }

  async addAssistantReply(file: TFile): Promise<void> {
    await this.applyAssistantReply(file, await navigator.clipboard.readText());
  }
}
