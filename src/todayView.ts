/**
 * @file todayView.ts
 * @description The "Today's meetings" sidebar view: every timed meeting on
 * today's calendar, with buttons to open (or create) its note and to join.
 */

import { ItemView, WorkspaceLeaf } from "obsidian";
import type { CalendarEvent } from "./calendarApi";
import { joinUrl } from "./noteCreator";

export const TODAY_VIEW = "calendar-notes-today";

const RELOAD_MS = 5 * 60_000;
const TICK_MS = 60_000;

export type MeetingState = "done" | "now" | "upcoming";

export interface TodayRow {
  event: CalendarEvent;
  start: Date;
  end: Date;
  state: MeetingState;
}

/** Today's timed, non-cancelled meetings in start order, marked done / now / upcoming. */
export function todayRows(events: CalendarEvent[], now: Date): TodayRow[] {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const rows: TodayRow[] = [];
  for (const event of events) {
    if (event.cancelled || !event.start.dateTime) continue;
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime ?? event.start.dateTime);
    if (isNaN(start.getTime()) || start >= dayEnd || end <= dayStart) continue;
    const state: MeetingState = end <= now ? "done" : start <= now ? "now" : "upcoming";
    rows.push({ event, start, end, state });
  }
  return rows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** What the view needs from the plugin. */
export interface TodayHost {
  /** Today's meetings from the calendar, or null if it couldn't be read. */
  loadToday(): Promise<CalendarEvent[] | null>;
  /** IDs of events that already have a note. */
  notedEventIds(): Set<string>;
  openNote(event: CalendarEvent): Promise<void>;
}

const clock = (date: Date) =>
  date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

export class TodayView extends ItemView {
  private events: CalendarEvent[] | null = [];

  constructor(leaf: WorkspaceLeaf, private readonly host: TodayHost) {
    super(leaf);
  }

  getViewType(): string {
    return TODAY_VIEW;
  }

  getDisplayText(): string {
    return "Today's meetings";
  }

  getIcon(): string {
    return "calendar-clock";
  }

  async onOpen(): Promise<void> {
    this.registerInterval(window.setInterval(() => this.reload(), RELOAD_MS));
    this.registerInterval(window.setInterval(() => this.render(), TICK_MS));
    this.registerEvent(this.app.vault.on("create", () => this.render()));
    this.registerEvent(this.app.vault.on("delete", () => this.render()));
    await this.reload();
  }

  async reload(): Promise<void> {
    this.events = await this.host.loadToday();
    this.render();
  }

  render(): void {
    const now = new Date();
    const el = this.contentEl;
    el.empty();
    el.addClass("cal-notes-today");

    const header = el.createDiv({ cls: "cal-notes-header" });
    header.createEl("h4", {
      text: now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    });
    const refresh = header.createEl("button", { text: "Refresh" });
    refresh.addEventListener("click", () => this.reload());

    if (this.events === null) {
      el.createDiv({ cls: "cal-notes-empty", text: "Couldn't read your calendar. Check the plugin's settings." });
      return;
    }
    const rows = todayRows(this.events, now);
    if (rows.length === 0) {
      el.createDiv({ cls: "cal-notes-empty", text: "No meetings today." });
      return;
    }

    const noted = this.host.notedEventIds();
    for (const row of rows) {
      const item = el.createDiv({ cls: `cal-notes-today-item is-${row.state}` });
      const when = item.createDiv({ cls: "cal-notes-meeting-date" });
      when.setText(`${clock(row.start)} – ${clock(row.end)}`);
      if (row.state === "now") when.createSpan({ cls: "cal-notes-badge", text: "Now" });

      const title = item.createEl("a", { cls: "cal-notes-meeting-title", text: row.event.summary?.trim() || "Untitled Event" });
      title.addEventListener("click", () => this.host.openNote(row.event));

      const actions = item.createDiv({ cls: "cal-notes-actions" });
      const hasNote = noted.has(row.event.id);
      const noteButton = actions.createEl("button", { text: hasNote ? "Open note" : "Create note" });
      noteButton.addEventListener("click", () => this.host.openNote(row.event));
      const url = joinUrl(row.event);
      if (url && row.state !== "done") {
        const join = actions.createEl("button", { cls: "mod-cta", text: "Join" });
        join.addEventListener("click", () => window.open(url));
      }
    }
  }
}
